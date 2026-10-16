import 'reflect-metadata';
import assert from 'node:assert/strict';
import { Channel, Injector, Order, OrderService, Payment, PaymentMethod, RequestContext, TransactionalConnection, VendureEntity } from '@vendure/core';
import { OrderType } from '@vendure/common/lib/generated-types';
import { DataSource, EntityManager, EntitySchema, PrimaryGeneratedColumn } from 'typeorm';
import { multivendorPaymentMethodHandler as handler } from '../plugins/marketplace/modules/vendor/config/multivendor-payment-handler';
import { CompanyPaymentService } from '../plugins/marketplace/modules/vendor/services/company-payment.service';
import { MarketplacePayoutSettings } from '../plugins/marketplace/modules/finance/entities/marketplace-payout-settings.entity';
import { MarketplaceRewardRedemption } from '../plugins/marketplace/modules/review/entities/marketplace-reward-redemption.entity';
import { MarketplaceCouponRedemption } from '../plugins/marketplace/modules/promotion/entities/marketplace-coupon-redemption.entity';
import { BookingService } from '../plugins/marketplace/modules/booking/services/booking.service';
import { MarketplaceCommissionRuleService } from '../plugins/marketplace/modules/finance/services/commission-rule.service';
import { CONNECTED_PAYMENT_METHOD_CODE } from '../plugins/marketplace/constants';
import { marketplaceOrderPaymentIsSettled } from '../plugins/marketplace/modules/finance/order-earnings-policy';

async function main() {
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    type PaymentFixture = Payment & { orderId: number };
    const paymentSchema = new EntitySchema<PaymentFixture>({ name: 'Payment', target: Payment, columns: {
        id: { type: Number, primary: true, generated: true }, createdAt: { type: Date, createDate: true }, updatedAt: { type: Date, updateDate: true },
        orderId: { type: Number }, amount: { type: Number }, method: { type: String }, state: { type: String },
        transactionId: { type: String, nullable: true }, metadata: { type: 'simple-json' },
    } });
    const source = await new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: true,
        entities: [paymentSchema, MarketplacePayoutSettings] }).initialize();
    type Context = RequestContext & { manager?: EntityManager };
    const customer = { activeUserId: 'customer', userHasPermissions: () => false } as unknown as Context;
    const admin = {
        activeUserId: 'finance', channelId: 'default-channel', _channel: { id: 'default-channel' },
        userHasPermissions: () => true,
        copy() { return Object.assign(Object.create(Object.getPrototypeOf(this)), this); },
    } as unknown as Context;
    const aggregate = { id: 1, code: 'CUSTOMER-ORDER', type: OrderType.Aggregate, state: 'PaymentAuthorized', active: false,
        totalWithTax: 10000, currencyCode: 'PKR', customFields: {}, payments: [] } as unknown as Order;
    const seller = { id: 2, code: 'SELLER-ORDER', type: OrderType.Seller, state: 'PaymentAuthorized', active: false,
        totalWithTax: 9000, currencyCode: 'PKR', aggregateOrder: aggregate, customFields: {}, lines: [], payments: [],
        channels: [{ id: 'seller-channel' }] } as unknown as Order;
    aggregate.sellerOrders = [seller];
    let rewards: any = { amount: 400, currencyCode: 'PKR', customerUserId: 'customer' };
    const coupon = { amount: 600, currencyCode: 'PKR', customerUserId: 'customer', fundingSource: 'VENDOR' };
    const connection = {
        getRepository(ctx: Context, entity: any) {
            const manager = ctx.manager ?? source.manager;
            if (entity === MarketplaceRewardRedemption) return { findOne: async () => rewards };
            if (entity === MarketplaceCouponRedemption) return { findOne: async () => coupon };
            if (entity === Channel) return { findOne: async ({ where }: any) => ({
                id: where.id,
                defaultShippingZone: { id: 'shipping-zone' },
                defaultTaxZone: { id: 'tax-zone' },
            }) };
            if (entity === Order) return { findOne: async ({ where }: any) => {
                aggregate.payments = await manager.getRepository(paymentSchema).find({ where: { orderId: 1 } });
                seller.payments = await manager.getRepository(paymentSchema).find({ where: { orderId: 2 } });
                return String(where.id) === '2' ? seller : String(where.id) === '1' ? aggregate : null;
            } };
            return manager.getRepository(entity);
        },
        withTransaction(ctx: Context, work: (ctx: Context) => Promise<unknown>) {
            return (ctx.manager ?? source.manager).transaction(manager => work({ ...ctx, manager } as Context));
        },
    } as unknown as TransactionalConnection;
    handler.init({ get: () => connection } as unknown as Injector);
    const method = {} as PaymentMethod;
    let bookingCalls = 0;
    let rejectBookings = false;
    let sellerSettlementChannel: string | undefined;
    const orderService = { settlePayment: async (ctx: Context, id: any) => {
        const nestedCtx = typeof ctx.copy === 'function' ? ctx.copy() as Context : ctx;
        assert.ok((nestedCtx as unknown as { _channel?: { id?: string } })._channel?.id,
            'Payment transition context copies must retain the active order channel');
        const repo = connection.getRepository(ctx, Payment);
        const payment = await repo.findOneByOrFail({ id });
        const order = (payment as PaymentFixture).orderId === 1 ? aggregate : seller;
        if (order.type === OrderType.Seller) sellerSettlementChannel = String((ctx as unknown as { _channel?: { id?: string } })._channel?.id ?? '');
        const result = await handler.settlePayment(ctx, order, payment, [], method);
        if (!result.success) throw new Error(result.errorMessage);
        await repo.update(id, { state: 'Settled' });
        return repo.findOneByOrFail({ id });
    } } as unknown as OrderService;
    const service = new CompanyPaymentService(connection, orderService, {
        confirmForSellerOrders: async () => { if (rejectBookings) throw new Error('Booking no longer payable'); bookingCalls++; },
    } as unknown as BookingService, { createLedgerEntriesForSellerOrder: async () => [] } as unknown as MarketplaceCommissionRuleService);
    const payments = source.getRepository(paymentSchema);
    try {
        await source.getRepository(MarketplacePayoutSettings).save(new MarketplacePayoutSettings({ holdingPeriodDays: 7, reservePercent: 0,
            minimumPayoutThreshold: 0, payoutSchedule: 'MANUAL', currencyCode: 'PKR', requireSeparateApproval: false }));
        const result = await handler.createPayment(customer, aggregate, 10000, [], {
            customerPayableAmount: 1, companyReceiptReference: 'forged', companyReceiptConfirmedAt: new Date().toISOString(),
        }, method);
        assert.equal(result.state, 'Authorized', 'Direct buy must work without pretending to collect money');
        assert.equal(result.metadata.customerPayableAmount, 9000, 'Amount comes only from server reservations');
        assert.equal(result.metadata.companyReceiptReference, undefined, 'Customer must not forge company confirmation');
        const customerPayment = await payments.save(payments.create({ ...result, orderId: 1, method: CONNECTED_PAYMENT_METHOD_CODE }));
        const sellerResult = await handler.createPayment(customer, seller, 9000, [], { connectedAccountId: 'untrusted' }, method);
        assert.equal(sellerResult.state, 'Authorized');
        assert.equal(sellerResult.metadata.source, 'COMPANY_HELD_ACCOUNTING', 'Seller payment is internal accounting; no vendor transfer occurs');
        const sellerPayment = await payments.save(payments.create({ ...sellerResult, orderId: 2, method: CONNECTED_PAYMENT_METHOD_CODE }));
        assert.equal((await handler.settlePayment(admin, aggregate, customerPayment, [], method)).success, false, 'Generic settlement cannot bypass receipt confirmation');
        assert.equal((await handler.settlePayment(admin, seller, sellerPayment, [], method)).success, false, 'Seller cannot settle before the company receives payment');
        rewards = { ...rewards, customerUserId: 'another-customer' };
        await assert.rejects(handler.createPayment(customer, aggregate, 10000, [], {}, method), /reservation/);
        rewards = { ...rewards, customerUserId: 'customer' };
        await assert.rejects(service.confirmReceipt(customer, 1, 9000, 'BANK-1'), /Only company/);
        await assert.rejects(service.confirmReceipt(admin, 1, 9000, ''), /reference/);
        await assert.rejects(service.confirmReceipt(admin, 1, 1, 'BANK-1'), /amount must match/);
        assert.equal(bookingCalls, 0);
        rejectBookings = true;
        await assert.rejects(service.confirmReceipt(admin, 1, 9000, 'BANK-1'), /Booking no longer/);
        assert.equal((await payments.findOneByOrFail({ id: customerPayment.id })).state, 'Authorized', 'Failed booking confirmation rolls receipt settlement back');
        rejectBookings = false;
        assert.equal((await service.confirmReceipt(admin, 1, 9000, 'BANK-1')).success, true);
        assert.equal((await payments.findOneByOrFail({ id: customerPayment.id })).state, 'Settled');
        assert.equal((await payments.findOneByOrFail({ id: sellerPayment.id })).state, 'Settled');
        assert.equal(sellerSettlementChannel, 'seller-channel', 'Seller accounting must settle in the vendor channel');
        assert.equal(bookingCalls, 1);
        await assert.rejects(service.confirmReceipt(admin, 1, 9000, 'BANK-1'), /already confirmed/);

        // Old simulated settlement must be reconciled from real evidence and server discount records.
        const legacyPayment = await payments.findOneByOrFail({ id: customerPayment.id });
        legacyPayment.transactionId = 'old-mock-id';
        legacyPayment.metadata = { customerPayableAmount: 1 };
        await payments.save(legacyPayment);
        await connection.getRepository(admin, Order).findOne({ where: { id: aggregate.id } });
        assert.equal(marketplaceOrderPaymentIsSettled(seller), false, 'Mock settled payments do not prove company receipt');
        await assert.rejects(service.confirmReceipt(admin, 1, 1, 'LEGACY-BANK-1'), /amount must match/);
        await service.confirmReceipt(admin, 1, 9000, 'LEGACY-BANK-1');
        await connection.getRepository(admin, Order).findOne({ where: { id: aggregate.id } });
        assert.equal(marketplaceOrderPaymentIsSettled(seller), true);
        assert.equal(bookingCalls, 1, 'Reconciling old receipts must not renew an already paid booking twice');
        console.log('Direct purchase checks passed: unpaid placement, server discounts, company-only receipt confirmation, amount/reference validation, atomic settlement, booking confirmation, legacy receipt reconciliation and replay protection.');
    } finally { await source.destroy(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
