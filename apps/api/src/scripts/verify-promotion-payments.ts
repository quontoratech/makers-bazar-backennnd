import { RequestContext, TransactionalConnection, VendureEntity } from '@vendure/core';
import assert from 'node:assert/strict';
import 'reflect-metadata';
import Stripe from 'stripe';
import { DataSource, PrimaryGeneratedColumn } from 'typeorm';
import { MarketplacePromotionPayment } from '../plugins/marketplace/modules/promotion/entities/marketplace-promotion-payment.entity';
import { MarketplacePromotionRequest } from '../plugins/marketplace/modules/promotion/entities/marketplace-promotion-request.entity';
import { MarketplacePromotionSettings } from '../plugins/marketplace/modules/promotion/entities/marketplace-promotion-settings.entity';
import { PromotionCardGateway } from '../plugins/marketplace/modules/promotion/services/promotion-card-gateway.service';
import { PromotionFinanceService } from '../plugins/marketplace/modules/promotion/services/promotion-finance.service';
import { PromotionService } from '../plugins/marketplace/modules/promotion/services/promotion.service';
import { VendorProfile } from '../plugins/marketplace/modules/vendor/entities/vendor-profile.entity';

async function main() {
    // Vendure normally applies its ID strategy during bootstrap; this test uses only an in-memory data source.
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    const source = new DataSource({
        type: 'better-sqlite3',
        database: ':memory:',
        synchronize: true,
        entities: [MarketplacePromotionPayment, MarketplacePromotionRequest, MarketplacePromotionSettings],
    });
    await source.initialize();
    const connection = {
        getRepository: (_ctx: RequestContext, entity: any) =>
            entity === VendorProfile
                ? {
                      findOne: async ({ where }: any) => ({
                          id: where.channelId === 'other' ? '22' : '11',
                          status: 'APPROVED',
                          paused: false,
                          enforcementStatus: 'ACTIVE',
                      }),
                  }
                : source.getRepository(entity),
    } as unknown as TransactionalConnection;
    const ctx = { activeUserId: '1', channelId: 'vendor' } as unknown as RequestContext;
    const other = { activeUserId: '2', channelId: 'other' } as unknown as RequestContext;
    const finance = new PromotionFinanceService(connection);
    const sessions = new Map<string, Stripe.Checkout.Session>();
    let creates = 0;
    let refundedAmount = 10000;
    const gateway = {
        configured: true,
        create: async (request: MarketplacePromotionRequest, key: string) => {
            const session = {
                id: `cs_test_qa${++creates}`,
                mode: 'payment',
                status: 'open',
                payment_status: 'unpaid',
                amount_total: request.amount,
                currency: 'pkr',
                client_reference_id: String(request.id),
                metadata: {
                    promotionRequestId: String(request.id),
                    vendorProfileId: request.vendorProfileId,
                    paymentKey: key,
                },
                url: 'https://checkout.stripe.com/c/pay/qa',
                payment_intent: null,
            } as unknown as Stripe.Checkout.Session;
            sessions.set(session.id, session);
            return session;
        },
        retrieve: async (id: string) => {
            const session = sessions.get(id);
            assert(session);
            return session;
        },
        expire: async (id: string) => {
            const session = sessions.get(id);
            assert(session);
            session.status = 'expired';
            return session;
        },
        charge: async () => ({ id: 'ch_qa', payment_intent: 'pi_qa1', amount_refunded: refundedAmount }),
    } as unknown as PromotionCardGateway;
    const promotions = new PromotionService(connection, gateway, finance);
    const requests = source.getRepository(MarketplacePromotionRequest);
    const payments = source.getRepository(MarketplacePromotionPayment);
    let counter = 0;
    const newRequest = (extra: Partial<MarketplacePromotionRequest> = {}) =>
        requests.save(
            new MarketplacePromotionRequest({
                code: `QA-${++counter}`,
                targetType: 'PRODUCT',
                productId: '1',
                productName: 'QA listing',
                productSlug: 'qa',
                vendorProfileId: '11',
                vendorName: 'QA vendor',
                categoryCode: 'digital',
                categoryName: 'Digital',
                placement: 'HOME',
                startsAt: new Date(),
                endsAt: new Date(Date.now() + 86400000),
                durationDays: 1,
                pricePerDay: 50000,
                amount: 50000,
                currencyCode: 'PKR',
                rateScope: 'GLOBAL',
                submittedAt: new Date(),
                status: 'PENDING_PAYMENT',
                paymentStatus: 'UNPAID',
                paymentDueAt: new Date(Date.now() + 86400000),
                priority: 0,
                ...extra,
            }),
        );
    try {
        const unpaid = await newRequest({ status: 'PENDING_REVIEW' });
        await assert.rejects(() => promotions.createCardCheckout(ctx, unpaid.id), /not awaiting payment/i);
        const request = await newRequest();
        await assert.rejects(() => promotions.createCardCheckout(other, request.id));
        await promotions.createCardCheckout(ctx, request.id);
        await promotions.createCardCheckout(ctx, request.id);
        assert.equal(creates, 1, 'Repeated clicks reuse checkout');
        assert.equal(await payments.count(), 1);
        assert.equal((await finance.summary(ctx)).netRevenue, 0);
        await assert.rejects(
            () => promotions.submitPayment(ctx, { id: request.id, paymentReference: 'bank-qa' }),
            /open card checkout/i,
        );
        await assert.rejects(() => promotions.cancelMine(ctx, request.id), /open card checkout/i);
        const session = sessions.get('cs_test_qa1')!;
        assert.equal((await promotions.syncCardCheckout(ctx, session.id)).paymentStatus, 'UNPAID');
        const foreignRequest = await requests.findOne({ where: { id: request.id, vendorProfileId: '22' } });
        assert.equal(foreignRequest, null);
        await assert.rejects(() => promotions.syncCardCheckout(other, session.id));
        await assert.rejects(() => promotions.syncCardCheckout(ctx, 'cs_test_missing'), /not available/i);
        session.status = 'complete';
        session.payment_status = 'paid';
        session.payment_intent = {
            id: 'pi_qa1',
            status: 'succeeded',
            latest_charge: {
                id: 'ch_qa',
                amount_refunded: 0,
                payment_method_details: { card: { brand: 'visa', last4: '4242' } },
            },
        } as Stripe.PaymentIntent;
        session.amount_total = 1;
        await assert.rejects(() => promotions.syncCardCheckout(ctx, session.id), /does not match/i);
        assert.equal((await finance.summary(ctx)).netRevenue, 0);
        session.amount_total = request.amount;
        session.currency = 'usd';
        await assert.rejects(() => promotions.syncCardCheckout(ctx, session.id), /does not match/i);
        session.currency = 'pkr';
        session.metadata!.promotionRequestId = 'other';
        await assert.rejects(() => promotions.syncCardCheckout(ctx, session.id), /does not match/i);
        session.metadata!.promotionRequestId = String(request.id);
        assert.equal((await promotions.syncCardCheckout(ctx, session.id)).status, 'PAYMENT_VERIFIED');
        const event = { type: 'checkout.session.completed', data: { object: session } } as Stripe.Event;
        await promotions.handleCardEvent(ctx, event);
        await promotions.handleCardEvent(ctx, event);
        assert.equal(
            (await finance.summary(ctx)).netRevenue,
            request.amount,
            'Webhook replay cannot duplicate income',
        );
        const record = await payments.findOneByOrFail({ checkoutSessionId: session.id });
        assert.equal(record.cardLast4, '4242');
        assert.equal(record.cardBrand, 'visa');
        assert(!Object.keys(record).some(key => /cvv|cardNumber|expiry/i.test(key)));
        await promotions.handleCardEvent(ctx, {
            type: 'charge.refunded',
            data: { object: { id: 'ch_qa' } },
        } as Stripe.Event);
        assert.equal((await finance.summary(ctx)).netRevenue, 40000);
        assert.equal((await requests.findOneByOrFail({ id: request.id })).status, 'CANCELLED');
        await promotions.handleCardEvent(ctx, event);
        assert.equal((await finance.summary(ctx)).netRevenue, 40000);
        const abandoned = await newRequest();
        await promotions.createCardCheckout(ctx, abandoned.id);
        await promotions.cancelCardCheckout(ctx, abandoned.id);
        assert.equal(
            (await payments.findOneByOrFail({ checkoutSessionId: 'cs_test_qa2' })).status,
            'EXPIRED',
        );
        const manual = await promotions.submitPayment(ctx, {
            id: abandoned.id,
            paymentReference: 'bank-qa',
            paymentNote: 'QA',
        });
        await promotions.reviewRequest(ctx, { id: manual.id, status: 'PAYMENT_VERIFIED' });
        await requests.update(manual.id, { status: 'EXPIRED' });
        assert.equal(
            (await finance.summary(ctx)).netRevenue,
            90000,
            'Expired placements retain received revenue',
        );
        await finance.summary(ctx);
        assert.equal(await payments.count(), 3, 'Legacy sync does not duplicate records');
        const duplicate = await newRequest();
        await assert.rejects(
            () => promotions.submitPayment(ctx, { id: duplicate.id, paymentReference: 'bank-qa' }),
            /already been used/i,
        );
        refundedAmount = request.amount;
        await promotions.handleCardEvent(ctx, {
            type: 'charge.refunded',
            data: { object: { id: 'ch_qa' } },
        } as Stripe.Event);
        assert.equal((await finance.summary(ctx)).netRevenue, 50000);
        assert.equal((await payments.findOneByOrFail({ checkoutSessionId: session.id })).status, 'REFUNDED');
        await promotions.handleCardEvent(ctx, event);
        assert.equal((await finance.summary(ctx)).netRevenue, 50000);
        const cancelled = await newRequest();
        await promotions.createCardCheckout(ctx, cancelled.id);
        await requests.update(cancelled.id, { status: 'CANCELLED' });
        const lateSession = sessions.get('cs_test_qa3')!;
        lateSession.payment_status = 'paid';
        lateSession.status = 'complete';
        lateSession.payment_intent = {
            id: 'pi_qa3',
            status: 'succeeded',
            latest_charge: { id: 'ch_qa3', amount_refunded: 0 },
        } as Stripe.PaymentIntent;
        assert.equal((await promotions.syncCardCheckout(ctx, lateSession.id)).status, 'CANCELLED');
        assert.equal((await finance.summary(ctx)).netRevenue, 100000);
        const previousKey = process.env.PROMOTION_STRIPE_SECRET_KEY;
        const previousSecret = process.env.PROMOTION_STRIPE_WEBHOOK_SECRET;
        try {
            process.env.PROMOTION_STRIPE_SECRET_KEY = 'sk_test_local_signature_only';
            process.env.PROMOTION_STRIPE_WEBHOOK_SECRET = 'whsec_local_signature_only';
            const signingGateway = new PromotionCardGateway();
            const payload = JSON.stringify({
                id: 'evt_qa',
                object: 'event',
                type: 'checkout.session.expired',
                data: { object: { id: session.id } },
            });
            const stripe = new Stripe(process.env.PROMOTION_STRIPE_SECRET_KEY);
            const header = stripe.webhooks.generateTestHeaderString({
                payload,
                secret: process.env.PROMOTION_STRIPE_WEBHOOK_SECRET,
            });
            assert.equal(signingGateway.event(Buffer.from(payload), header).id, 'evt_qa');
            assert.throws(() => signingGateway.event(Buffer.from(payload + ' '), header), /signature/i);
            assert.throws(
                () => signingGateway.event(Buffer.from(payload), 't=1,v1=invalid'),
                /signature|timestamp/i,
            );
        } finally {
            if (previousKey === undefined) delete process.env.PROMOTION_STRIPE_SECRET_KEY;
            else process.env.PROMOTION_STRIPE_SECRET_KEY = previousKey;
            if (previousSecret === undefined) delete process.env.PROMOTION_STRIPE_WEBHOOK_SECRET;
            else process.env.PROMOTION_STRIPE_WEBHOOK_SECRET = previousSecret;
        }
        console.log(
            'PASS: card ownership, checkout reuse, amount validation, unpaid/replayed events, masked card details, refunds, manual history, revenue, and signed webhook validation (no real charges)',
        );
    } finally {
        await source.destroy();
    }
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
