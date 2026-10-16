import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
    CustomerService,
    Order,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { IsNull, Not } from 'typeorm';

import { requireActiveUserId } from '../../../shared/ownership';
import { MarketplaceDigitalDownloadGrant } from '../entities/marketplace-digital-download-grant.entity';
import { MarketplaceDigitalFile } from '../entities/marketplace-digital-file.entity';
import { DigitalFileSecurityService } from './digital-file-security.service';

interface DownloadGrantResult {
    url: string;
    expiresAt: Date;
    fileName: string;
}

@Injectable()
export class MarketplaceDigitalDownloadService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
        private fileSecurity: DigitalFileSecurityService,
    ) {}

    async requestGrant(ctx: RequestContext, fileId: string): Promise<DownloadGrantResult> {
        const activeUserId = requireActiveUserId(ctx);
        const customer = await this.customerService.findOneByUserId(ctx, activeUserId);
        if (!customer) throw new Error('A customer account is required to download this file');

        const file = await this.connection.getRepository(ctx, MarketplaceDigitalFile).findOne({
            where: { id: fileId },
        });
        if (!file || !file.isPrivate || file.integrityStatus !== 'VALID') {
            throw new Error('This download is not available');
        }
        const now = new Date();
        if (file.expiresAt && file.expiresAt <= now) throw new Error('This download has expired');

        const order = await this.findEligibleOrder(ctx, String(customer.id), file.productId);
        if (!order) throw new Error('A settled, non-refunded order is required to download this file');
        const expiryDays = Number(file.metadata?.downloadExpiryDays ?? 0);
        if (Number.isInteger(expiryDays) && expiryDays > 0 && order.orderPlacedAt) {
            const customerExpiry = new Date(order.orderPlacedAt.getTime() + expiryDays * 86_400_000);
            if (customerExpiry <= now) throw new Error('The customer download period has expired');
        }

        if (file.downloadLimit != null) {
            const completedDownloads = await this.connection.getRepository(ctx, MarketplaceDigitalDownloadGrant).count({
                where: {
                    fileId: String(file.id),
                    customerId: String(customer.id),
                    orderId: String(order.id),
                    consumedAt: Not(IsNull()),
                },
            });
            if (completedDownloads >= file.downloadLimit) throw new Error('The download limit has been reached');
        }

        const token = randomBytes(32).toString('base64url');
        const ttlSeconds = this.grantTtlSeconds();
        const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
        await this.connection.getRepository(ctx, MarketplaceDigitalDownloadGrant).save(
            new MarketplaceDigitalDownloadGrant({
                fileId: String(file.id),
                customerId: String(customer.id),
                orderId: String(order.id),
                tokenHash: this.hashToken(token),
                expiresAt,
            }),
        );

        const apiUrl = (process.env.API_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
        return {
            url: `${apiUrl}/marketplace-downloads/${encodeURIComponent(token)}`,
            expiresAt,
            fileName: file.fileName,
        };
    }

    async consumeGrant(token: string) {
        if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error('The download link is invalid');
        const grantRepository = this.connection.rawConnection.getRepository(MarketplaceDigitalDownloadGrant);
        const grant = await grantRepository.findOne({ where: { tokenHash: this.hashToken(token) } });
        if (!grant || grant.consumedAt || grant.expiresAt <= new Date()) throw new Error('The download link is invalid or expired');

        const file = await this.connection.rawConnection.getRepository(MarketplaceDigitalFile).findOne({
            where: { id: grant.fileId },
        });
        if (!file || !file.isPrivate || file.integrityStatus !== 'VALID') {
            throw new Error('The download is no longer available');
        }
        if (file.expiresAt && file.expiresAt <= new Date()) throw new Error('The download has expired');

        const updated = await grantRepository.createQueryBuilder()
            .update(MarketplaceDigitalDownloadGrant)
            .set({ consumedAt: new Date() })
            .where('id = :id', { id: grant.id })
            .andWhere('consumedAt IS NULL')
            .execute();
        if (updated.affected !== 1) throw new Error('The download link has already been used');

        return {
            file,
            filePath: await this.fileSecurity.resolveDownloadPath(file),
        };
    }

    private async findEligibleOrder(ctx: RequestContext, customerId: string, productId: string) {
        const orders = await this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .innerJoinAndSelect('order.lines', 'line')
            .innerJoin('line.productVariant', 'variant')
            .innerJoin('variant.product', 'product')
            .innerJoinAndSelect('order.payments', 'payment')
            .leftJoinAndSelect('payment.refunds', 'refund')
            .leftJoinAndSelect('order.sellerOrders', 'sellerOrder')
            .leftJoinAndSelect('sellerOrder.channels', 'sellerOrderChannel')
            .where('order.customerId = :customerId', { customerId })
            .andWhere('product.id = :productId', { productId })
            .andWhere('order.active = :active', { active: false })
            .andWhere('payment.state = :paymentState', { paymentState: 'Settled' })
            .orderBy('order.orderPlacedAt', 'DESC')
            .getMany();
        return orders.find(order => {
            if (/cancel|refund/i.test(String(order.state))) return false;
            const parentStatus = this.orderStatus(order);
            const productSellerChannelIds = new Set((order.lines ?? [])
                .map(line => line.sellerChannelId == null ? '' : String(line.sellerChannelId))
                .filter(Boolean));
            const matchingSellerOrders = (order.sellerOrders ?? []).filter(sellerOrder =>
                sellerOrder.channels.some(channel => productSellerChannelIds.has(String(channel.id))),
            );
            const deliveryStatuses = matchingSellerOrders.map(sellerOrder => this.orderStatus(sellerOrder));
            if (deliveryStatuses.length
                ? deliveryStatuses.some(status => !this.isDelivered(status))
                : !this.isDelivered(parentStatus)) return false;
            const settled = (order.payments ?? []).filter(payment => String(payment.state) === 'Settled');
            const settledAmount = settled.reduce((total, payment) => total + payment.amount, 0);
            const refundedAmount = settled.flatMap(payment => payment.refunds ?? [])
                .filter(refund => String(refund.state) !== 'Failed')
                .reduce((total, refund) => total + refund.total, 0);
            return settledAmount > refundedAmount;
        });
    }

    private orderStatus(order: Order) {
        return String((order.customFields as Record<string, unknown>)?.marketplaceStatus ?? '').toUpperCase();
    }

    private isDelivered(status: string) {
        return status === 'DELIVERED' || status === 'FULFILLED';
    }

    private hashToken(token: string) {
        return createHash('sha256').update(token).digest('hex');
    }

    private grantTtlSeconds() {
        const configured = Number(process.env.DIGITAL_DOWNLOAD_GRANT_TTL_SECONDS ?? 300);
        return Number.isInteger(configured) && configured >= 30 && configured <= 1800 ? configured : 300;
    }
}
