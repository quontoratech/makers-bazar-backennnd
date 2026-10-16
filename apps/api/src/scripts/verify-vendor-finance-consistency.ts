import assert from 'node:assert/strict';
import 'reflect-metadata';
import { Order, RequestContext, TransactionalConnection, VendureEntity } from '@vendure/core';
import { DataSource, EntityManager, PrimaryGeneratedColumn } from 'typeorm';
import { MarketplacePayoutBatch } from '../plugins/marketplace/modules/finance/entities/marketplace-payout-batch.entity';
import { MarketplacePayoutSettings } from '../plugins/marketplace/modules/finance/entities/marketplace-payout-settings.entity';
import { MarketplaceCommissionRule } from '../plugins/marketplace/modules/finance/entities/marketplace-commission-rule.entity';
import { MarketplaceCommissionRuleService } from '../plugins/marketplace/modules/finance/services/commission-rule.service';
import { PromotionCampaign } from '../plugins/marketplace/modules/promotion/entities/promotion-campaign.entity';
import { MarketplaceCouponService } from '../plugins/marketplace/modules/promotion/services/marketplace-coupon.service';
import { VendorProfile } from '../plugins/marketplace/modules/vendor/entities/vendor-profile.entity';
import { FinanceService } from '../plugins/marketplace/modules/finance/services/finance.service';
import { PromotionFinanceService } from '../plugins/marketplace/modules/promotion/services/promotion-finance.service';
import { payoutSchedulePeriod } from '../plugins/marketplace/modules/finance/payout-schedule';
import { marketplaceOrderCanReleaseEarnings, marketplaceEarningsAvailableAt } from '../plugins/marketplace/modules/finance/order-earnings-policy';
import { configuredReturnWindowDays } from '../plugins/marketplace/modules/support/return-policy';

import { PayoutLedgerEntry } from '../plugins/marketplace/modules/finance/entities/payout-ledger-entry.entity';
import { summarizeVendorLedger } from '../plugins/marketplace/modules/finance/ledger-summary';
import { VendorOverviewService } from '../plugins/marketplace/modules/overview/services/vendor-overview.service';

const entry = (
    kind: PayoutLedgerEntry['kind'],
    amount: number,
    status: PayoutLedgerEntry['status'] = 'AVAILABLE',
    orderId?: string,
    metadata?: PayoutLedgerEntry['metadata'],
) => ({ kind, amount, status, orderId, metadata }) as PayoutLedgerEntry;

const summary = summarizeVendorLedger([
    entry('SALE', 300_000, 'AVAILABLE', '6'),
    entry('COMMISSION', -15_000, 'AVAILABLE', '6'),
    entry('SALE', 700_000, 'AVAILABLE', '8'),
    entry('COMMISSION', -35_000, 'AVAILABLE', '8'),
    entry('SALE', 1_200_000, 'AVAILABLE', '13'),
    entry('COMMISSION', -60_000, 'AVAILABLE', '13'),
    entry('SALE', 1_300_000, 'AVAILABLE', '15'),
    entry('COMMISSION', -65_000, 'AVAILABLE', '15'),
    entry('SALE', 200_000, 'REVERSED', '2'),
    entry('COMMISSION', -10_000, 'REVERSED', '2'),
    entry('REFUND', -200_000, 'PAID', '2', { accountingEffect: 'INFORMATIONAL' }),
    entry('PAYOUT', -3_189_150, 'PAID'),
]);

assert.equal(summary.grossSales, 3_500_000);
assert.equal(summary.ledgeredSales, 4);
assert.equal(summary.commission, 175_000);
assert.equal(summary.fees, 0);
assert.equal(summary.netEarnings, 3_325_000);
assert.equal(Math.round(summary.commission / summary.grossSales * 10_000) / 100, 5);

const overviewPayouts = Object.create(VendorOverviewService.prototype) as {
    availablePayout(entries: PayoutLedgerEntry[]): number;
    pendingPayout(entries: PayoutLedgerEntry[]): number;
};
assert.equal(overviewPayouts.availablePayout([
    entry('SALE', 40_000, 'AVAILABLE'),
    entry('PAYOUT', -75_000, 'PAID'),
]), 0, 'Vendor overview must never display a negative available payout');
assert.equal(overviewPayouts.pendingPayout([
    entry('ADJUSTMENT', -5_000, 'ON_HOLD'),
]), 0, 'Vendor overview must never display a negative pending payout');

const completedBeforeStatusChange = {
    customFields: {
        marketplaceStatus: 'FULFILLED',
        marketplaceDeliveredAt: '2026-01-01T00:00:00.000Z',
        marketplaceStatusUpdatedAt: '2026-01-06T00:00:00.000Z',
    },
} as unknown as Order;
assert.equal(
    marketplaceEarningsAvailableAt(completedBeforeStatusChange, 7).toISOString(),
    new Date(Date.UTC(2026, 0, 1 + Math.max(7, configuredReturnWindowDays()))).toISOString(),
    'A later status change must not move the original customer appeal deadline',
);

console.log(JSON.stringify({
    grossSales: summary.grossSales,
    commission: summary.commission,
    netEarnings: summary.netEarnings,
    effectiveCommissionPercent: 5,
    result: 'PASS',
}, null, 2));

async function verifyPayoutFlow() {
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    const source = await new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: true,
        entities: [VendorProfile, PayoutLedgerEntry, MarketplacePayoutSettings, MarketplacePayoutBatch, MarketplaceCommissionRule, PromotionCampaign] }).initialize();
    const orders: Order[] = [];
    type TestContext = RequestContext & { manager?: EntityManager };
    const connection = {
        getRepository(ctx: TestContext, entity: any) {
            if (entity === Order) return { find: async () => orders };
            return (ctx.manager ?? source.manager).getRepository(entity);
        },
        withTransaction(ctx: TestContext, work: (ctx: TestContext) => Promise<unknown>) {
            return (ctx.manager ?? source.manager).transaction(manager => work({ ...ctx, manager } as TestContext));
        },
        getEntityOrThrow: async (ctx: TestContext, entity: any, id: any) =>
            entity === Order ? orders.find(order => String(order.id) === String(id))!
                : (ctx.manager ?? source.manager).getRepository(entity).findOneByOrFail({ id }),
    } as unknown as TransactionalConnection;
    const ctx = { activeUserId: 'creator', channelId: 'vendor-0' } as unknown as RequestContext;
    const approver = { ...ctx, activeUserId: 'approver' } as unknown as RequestContext;
    const finance = new FinanceService(connection, { summary: async () => ({ netRevenue: 0, refundedAmount: 0 }) } as unknown as PromotionFinanceService,
        { payoutHoldDays: 7, defaultCommissionPercent: 10, platformFeeSKU: 'FEE' });
    const commissions = new MarketplaceCommissionRuleService(connection,
        { payoutHoldDays: 7, defaultCommissionPercent: 10, platformFeeSKU: 'FEE' },
        { vendorFundedDiscountForSellerOrder: async () => undefined } as unknown as MarketplaceCouponService);
    const ledger = source.getRepository(PayoutLedgerEntry);
    const batches = source.getRepository(MarketplacePayoutBatch);
    try {
        await finance.updateSettings(ctx, { holdingPeriodDays: 10, reservePercent: 10, minimumPayoutThreshold: 0,
            payoutSchedule: 'WEEKLY', requireSeparateApproval: true });
        assert.equal((await finance.getSettings(ctx)).requireSeparateApproval, true, 'Reading settings must preserve approval policy');
        const vendors: VendorProfile[] = [];
        for (const [index, category] of ['PHYSICAL', 'FOOD', 'DIGITAL', 'SERVICE', 'WORKSHOP', 'EVENT'].entries()) {
            const vendor = await source.getRepository(VendorProfile).save(new VendorProfile({ slug: `vendor-${index}`, shopName: category,
                ownerFirstName: 'Test', ownerLastName: 'Vendor', ownerEmailAddress: `vendor-${index}@example.test`,
                status: 'APPROVED', channelId: `vendor-${index}`, enforcementStatus: 'ACTIVE', categories: [category],
                payoutAccount: { method: index % 2 ? 'JAZZCASH' : 'BANK_TRANSFER', accountHolderName: 'Test Vendor',
                    accountIdentifier: `0300123456${index}`, bankName: 'Test Bank', verificationStatus: 'VERIFIED', submittedAt: '2026-01-01' } }));
            vendors.push(vendor);
            const order = { id: `order-${index}`, code: `ORDER-${index}`, currencyCode: 'PKR', channels: [{ id: vendor.channelId }],
                lines: [{ id: `line-${index}`, discountedLinePriceWithTax: 10000, discountedLinePrice: 10000,
                    productVariant: { id: `variant-${index}`, product: { id: `product-${index}`, name: category,
                        customFields: { marketplaceMetadata: JSON.stringify({ categoryCode: category }) } } } }],
                totalWithTax: 10000, customFields: { marketplaceStatus: index < 2 ? 'DELIVERED' : 'FULFILLED',
                marketplaceStatusUpdatedAt: '2026-01-01T00:00:00Z' }, payments: [{ amount: 10000, state: 'Settled', refunds: [], metadata: {
                    source: 'MARKETPLACE_DIRECT_PURCHASE', collectionStatus: 'CONFIRMED', companyReceiptReference: `RECEIPT-${index}`, companyReceiptConfirmedAt: '2026-01-01',
                } }] } as unknown as Order;
            orders.push(order);
            assert(marketplaceOrderCanReleaseEarnings(order), `${category} paid completion must be supported`);
            const expectedReleaseAt = new Date(Date.UTC(2026, 0, 1 + Math.max(10, configuredReturnWindowDays()))).toISOString();
            assert.equal(marketplaceEarningsAvailableAt(order, 10).toISOString(), expectedReleaseAt);
            order.payments[0]!.state = 'Authorized';
            assert.equal((await commissions.createLedgerEntriesForSellerOrder(ctx, order)).length, 0, `${category} unpaid orders must not create earnings`);
            order.payments[0]!.state = 'Settled';
            const generated = await commissions.createLedgerEntriesForSellerOrder(ctx, order);
            assert.deepEqual(generated.map(row => [row.kind, row.amount]), [['SALE', 10000], ['COMMISSION', -1000]]);
            assert(generated.every(row => row.status === 'ON_HOLD' && row.availableAt?.toISOString() === expectedReleaseAt),
                'Ledger creation must respect both payout hold and the customer appeal window');
            assert.equal((await commissions.createLedgerEntriesForSellerOrder(ctx, order)).length, 2, 'Repeated completion must reuse existing ledger entries');
        }
        const batch = await finance.createPayoutBatch(ctx, {});
        assert.equal(batch.totalAmount, 6 * 8100, 'All categories receive the same hold, commission and reserve rules');
        await assert.rejects(finance.createPayoutBatch(ctx, {}), /No vendor balances/, 'Repeated batches must not drain the reserve or double pay');
        await assert.rejects(finance.approvePayoutBatch(ctx, { id: batch.id }), /different administrator/);
        await finance.approvePayoutBatch(approver, { id: batch.id });
        await assert.rejects(finance.processPayoutBatch(approver, { id: batch.id, status: 'PAID' }), /reference/);
        assert.equal((await batches.findOneByOrFail({ id: batch.id })).status, 'APPROVED');
        const first = String((await ledger.findOneByOrFail({ beneficiaryId: String(vendors[0]!.id), kind: 'PAYOUT' })).id);
        const second = String((await ledger.findOneByOrFail({ beneficiaryId: String(vendors[1]!.id), kind: 'PAYOUT' })).id);
        await assert.rejects(finance.processPayoutBatch(approver, { id: batch.id, status: 'PAID', payouts: [
            { payoutEntryId: first, status: 'PAID', externalReference: 'receipt-rollback' },
            { payoutEntryId: second, status: 'FAILED' },
        ] }), /failure reason/);
        assert.equal((await ledger.findOneByOrFail({ id: first })).status, 'APPROVED', 'Recipient writes must roll back together');
        await finance.processPayoutBatch(approver, { id: batch.id, status: 'PAID', payouts: [{ payoutEntryId: first, status: 'PAID', externalReference: 'bank-transfer-1' }] });
        await assert.rejects(finance.processPayoutBatch(approver, { id: batch.id, status: 'CANCELLED', reason: 'Unsafe cancellation' }), /paid recipient/);
        const partial = await finance.processPayoutBatch(approver, { id: batch.id, status: 'FAILED', reason: 'Remaining transfers rejected by bank' });
        assert.equal(partial.status, 'PARTIALLY_PAID');
        assert.equal((await ledger.findOneByOrFail({ id: first })).status, 'PAID', 'Failed recipients cannot release a completed payment');
        const view = await finance.myVendorFinance(ctx);
        assert.equal(view.payoutBatches[0]!.totalAmount, 8100);
        assert.deepEqual(view.payoutBatches[0]!.vendorIds, [String(vendors[0]!.id)]);
        assert.equal(view.payoutBatches[0]!.metadata, undefined, 'Vendor must not receive other recipients bank details');
        assert.equal(view.balance.reserveHeld, 900);
        assert.equal(view.balance.payableBalance, 0);

        // An account changed after batching must never redirect an already approved transfer.
        const next = await finance.createPayoutBatch(ctx, { vendorIds: [vendors[1]!.id] });
        const vendor = vendors[1]!;
        vendor.payoutAccount!.accountIdentifier = '03009876543';
        await source.getRepository(VendorProfile).save(vendor);
        await assert.rejects(finance.approvePayoutBatch(approver, { id: next.id }), /account changed/);
        await finance.processPayoutBatch(approver, { id: next.id, status: 'CANCELLED', reason: 'Updated account' });

        // A return after batch approval removes the order's available earnings before recording a transfer.
        const returnBatch = await finance.createPayoutBatch(ctx, { vendorIds: [vendors[2]!.id] });
        await finance.approvePayoutBatch(approver, { id: returnBatch.id });
        (orders[2]!.customFields as any).marketplaceStatus = 'RETURN_REQUESTED';
        await assert.rejects(finance.processPayoutBatch(approver, { id: returnBatch.id, status: 'PAID', externalReference: 'should-not-pay' }), /balance changed/);
        await finance.processPayoutBatch(approver, { id: returnBatch.id, status: 'CANCELLED', reason: 'Order under return review' });
        const held = await finance.vendorStatement(ctx, vendors[2]!.id);
        assert.equal(held.balance!.payableBalance, 0);
        assert.equal(held.balance!.onHoldBalance, 9000);

        const scheduled = await finance.prepareScheduledPayouts(ctx, new Date('2026-10-04'));
        assert.equal(scheduled.created, true);
        assert.equal((await finance.prepareScheduledPayouts(ctx, new Date('2026-10-04'))).created, false);
        assert.equal(payoutSchedulePeriod('WEEKLY', new Date('2026-10-04')), 'WEEKLY-2026-09-28');
        assert.equal(payoutSchedulePeriod('MONTHLY', new Date('2026-10-04')), 'MONTHLY-2026-10-01');
        assert.equal(payoutSchedulePeriod('MANUAL'), undefined);

        // Hundreds of historical activity rows must not truncate the vendor's balance.
        await ledger.save(Array.from({ length: 505 }, (_, i) => new PayoutLedgerEntry({ beneficiaryType: 'VENDOR', beneficiaryId: String(vendors[0]!.id),
            kind: 'ADJUSTMENT', amount: 1, currencyCode: 'PKR', status: 'AVAILABLE', availableAt: new Date(), reason: `History ${i}`,
            metadata: { source: 'MANUAL_FINANCE_ADJUSTMENT' } })));
        const history = await finance.myVendorFinance(ctx);
        assert.equal(history.entries.length, 500);
        assert.equal(history.balance.netEarnings, 9505, 'Balance must include more than the 500 visible ledger entries');
        const report = await finance.generateReport(ctx, { reportType: 'PAYOUT', vendorId: String(vendors[0]!.id) });
        assert.equal(report.rows.length, 1, 'Vendor reports must exclude batches for other vendors');
        assert.equal((report.rows[0] as { totalAmount: number }).totalAmount, 8100, 'Vendor reports must exclude other recipients from shared batches');
        const futureReport = await finance.generateReport(ctx, { reportType: 'PAYOUT', from: '2999-01-01', to: '2999-01-31' });
        assert.equal(futureReport.rows.length, 0, 'Payout reports must honor the date range');
        console.log('Payout integration checks passed: six vendor categories, reserves, approvals, receipt evidence, rollback, account changes, returns, partial batches, schedule and privacy.');
    } finally { await source.destroy(); }
}

void verifyPayoutFlow().catch(error => { console.error(error); process.exitCode = 1; });
