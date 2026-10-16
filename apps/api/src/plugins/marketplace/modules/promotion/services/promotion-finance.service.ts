import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';
import { createHash } from 'node:crypto';
import { In } from 'typeorm';
import { MarketplacePromotionPayment } from '../entities/marketplace-promotion-payment.entity';
import { MarketplacePromotionRequest } from '../entities/marketplace-promotion-request.entity';
import { summarizePromotionPayments } from '../promotion-revenue';

@Injectable()
export class PromotionFinanceService {
    constructor(private connection: TransactionalConnection) {}

    async recordManual(ctx: RequestContext, request: MarketplacePromotionRequest) {
        if (!request.paymentReference) return;
        const repository = this.connection.getRepository(ctx, MarketplacePromotionPayment);
        const key =
            'manual-' +
            createHash('sha256').update(`${request.id}:${request.paymentReference}`).digest('hex');
        let payment = await repository.findOne({ where: { key } });
        const duplicate = await repository.findOne({ where: { reference: request.paymentReference } });
        if (duplicate && duplicate.key !== key)
            throw new Error('This payment reference has already been used');
        payment ??= new MarketplacePromotionPayment({
            key,
            requestId: String(request.id),
            vendorProfileId: request.vendorProfileId,
            method: 'MANUAL',
            amount: request.amount,
            currencyCode: request.currencyCode,
            reference: request.paymentReference,
            refundedAmount: 0,
        });
        payment.status =
            request.paymentStatus === 'VERIFIED'
                ? 'VERIFIED'
                : request.paymentStatus === 'REJECTED'
                  ? 'REJECTED'
                  : 'SUBMITTED';
        payment.note = request.paymentNote;
        payment.verifiedAt = request.paymentVerifiedAt;
        payment.verifiedByUserId = request.paymentVerifiedByUserId;
        return repository.save(payment);
    }

    async payments(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplacePromotionPayment);
        // Import historical references once for both schema-sync and migration-based deployments.
        const requests = await this.connection.getRepository(ctx, MarketplacePromotionRequest).find({
            where: { paymentStatus: In(['SUBMITTED', 'VERIFIED', 'REJECTED']) },
        });
        const existing = await repository.find();
        const recorded = new Set(existing.map(payment => `${payment.requestId}:${payment.reference ?? ''}`));
        for (const request of requests) {
            if (request.paymentReference && !recorded.has(`${request.id}:${request.paymentReference}`)) {
                const key =
                    'manual-' +
                    createHash('sha256').update(`${request.id}:${request.paymentReference}`).digest('hex');
                await repository
                    .createQueryBuilder()
                    .insert()
                    .values({
                        key,
                        requestId: String(request.id),
                        vendorProfileId: request.vendorProfileId,
                        method: 'MANUAL',
                        amount: request.amount,
                        currencyCode: request.currencyCode,
                        reference: request.paymentReference,
                        refundedAmount: 0,
                        status:
                            request.paymentStatus === 'VERIFIED'
                                ? 'VERIFIED'
                                : request.paymentStatus === 'REJECTED'
                                  ? 'REJECTED'
                                  : 'SUBMITTED',
                        createdAt: request.paymentSubmittedAt ?? request.createdAt,
                        verifiedAt: request.paymentVerifiedAt,
                        verifiedByUserId: request.paymentVerifiedByUserId,
                        note: request.paymentNote,
                    })
                    .orIgnore()
                    .execute();
            }
        }
        return repository.find({ order: { createdAt: 'DESC', id: 'DESC' } });
    }

    async summary(ctx: RequestContext, from?: Date, to?: Date) {
        return summarizePromotionPayments(await this.payments(ctx), from, to);
    }

    async dashboard(
        ctx: RequestContext,
        options: {
            skip?: number;
            take?: number;
            term?: string;
            status?: string;
            vendorProfileId?: string;
        } = {},
    ) {
        const payments = await this.payments(ctx);
        const requests = await this.connection.getRepository(ctx, MarketplacePromotionRequest).find();
        const requestMap = new Map(requests.map(request => [String(request.id), request]));
        const term = String(options.term ?? '')
            .trim()
            .toLowerCase();
        const items = payments
            .filter(
                payment =>
                    (!options.status || payment.status === options.status) &&
                    (!options.vendorProfileId || payment.vendorProfileId === options.vendorProfileId),
            )
            .map(payment => {
                const request = requestMap.get(payment.requestId);
                return {
                    ...payment,
                    requestCode: request?.code ?? '-',
                    vendorName: request?.vendorName ?? '-',
                    productName: request?.productName ?? '-',
                    placement: request?.placement ?? '-',
                    promotionStatus: request?.status ?? '-',
                    startsAt: request?.startsAt,
                    endsAt: request?.endsAt,
                };
            })
            .filter(
                payment =>
                    !term ||
                    [payment.requestCode, payment.vendorName, payment.productName, payment.reference]
                        .join(' ')
                        .toLowerCase()
                        .includes(term),
            );
        const skip = Math.max(0, Math.floor(options.skip ?? 0));
        const take = Math.min(100, Math.max(1, Math.floor(options.take ?? 50)));
        return {
            items: items.slice(skip, skip + take),
            totalItems: items.length,
            summary: summarizePromotionPayments(payments),
        };
    }
}
