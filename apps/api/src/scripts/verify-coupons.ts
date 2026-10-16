import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource, Table } from 'typeorm';

import { AddMarketplaceCoupons1787955600000 } from '../migrations/1787955600000-add-marketplace-coupons';
import { AddMarketplaceCouponRewards1787959200000 } from '../migrations/1787959200000-add-marketplace-coupon-rewards';
import { calculateCustomerRefundAmounts } from '../plugins/marketplace/modules/finance/customer-refund-policy';
import { PayoutLedgerEntry } from '../plugins/marketplace/modules/finance/entities/payout-ledger-entry.entity';
import { summarizeVendorLedger } from '../plugins/marketplace/modules/finance/ledger-summary';
import {
    allocateCouponByWeight,
    calculateCouponDiscount,
    couponCommissionBase,
    couponMatchesLine,
} from '../plugins/marketplace/modules/promotion/coupon-policy';

assert.equal(calculateCouponDiscount({
    eligibleSubtotal: 200_000,
    discountType: 'PERCENTAGE',
    discountValue: 10,
}), 20_000);
assert.equal(calculateCouponDiscount({
    eligibleSubtotal: 200_000,
    discountType: 'PERCENTAGE',
    discountValue: 10,
    maximumDiscount: 12_000,
}), 12_000);
assert.equal(calculateCouponDiscount({
    eligibleSubtotal: 5_000,
    discountType: 'FIXED',
    discountValue: 7_500,
}), 5_000);
assert.throws(() => calculateCouponDiscount({
    eligibleSubtotal: 5_000,
    discountType: 'PERCENTAGE',
    discountValue: 101,
}), /cannot exceed/);

const allocations = allocateCouponByWeight(10_001, [200_000, 100_000, 100_000]);
assert.deepEqual(allocations, [5_001, 2_500, 2_500]);
assert.equal(allocations.reduce((total, value) => total + value, 0), 10_001);

assert.equal(couponCommissionBase(200_000, 20_000, 'MARKETPLACE'), 200_000);
assert.equal(couponCommissionBase(200_000, 20_000, 'VENDOR'), 180_000);
assert.equal(Math.round(couponCommissionBase(200_000, 20_000, 'MARKETPLACE') * 0.05), 10_000);
assert.equal(Math.round(couponCommissionBase(200_000, 20_000, 'VENDOR') * 0.05), 9_000);

const campaignLine = {
    productId: '42',
    vendorId: '7',
    categoryId: '12',
    categoryCode: 'cakes',
    categoryName: 'Cakes',
    productSlug: 'dark-chocolate-cake',
};
const campaignSnapshot = {
    couponId: '1',
    code: 'CAKE10',
    name: 'Cake campaign',
    scope: 'CAMPAIGN' as const,
    discountType: 'PERCENTAGE' as const,
    discountValue: 10,
    minimumSpend: 0,
    fundingSource: 'MARKETPLACE' as const,
    campaignTarget: { categoryCodes: ['cakes', 'brownies'] },
};
assert(couponMatchesLine(campaignSnapshot, campaignLine));
assert(couponMatchesLine(
    { ...campaignSnapshot, campaignTarget: { categoryCode: 'food-and-beverages' } },
    { ...campaignLine, categoryCode: 'food-and-beverages/bakery' },
));
assert(!couponMatchesLine({ ...campaignSnapshot, campaignTarget: { productIds: ['99'] } }, campaignLine));
assert(couponMatchesLine({ ...campaignSnapshot, campaignOwnerType: 'VENDOR', campaignOwnerId: '7' }, campaignLine));
assert(!couponMatchesLine({ ...campaignSnapshot, campaignOwnerType: 'VENDOR', campaignOwnerId: '8' }, campaignLine));

const ledger = summarizeVendorLedger([
    new PayoutLedgerEntry({ kind: 'SALE', amount: 200_000, status: 'AVAILABLE', orderId: '1' }),
    new PayoutLedgerEntry({ kind: 'COMMISSION', amount: -9_000, status: 'AVAILABLE', orderId: '1' }),
    new PayoutLedgerEntry({ kind: 'COUPON_DISCOUNT', amount: -20_000, status: 'AVAILABLE', orderId: '1' }),
    new PayoutLedgerEntry({
        kind: 'COUPON_FUNDING',
        amount: 10_000,
        status: 'AVAILABLE',
        orderId: '2',
        metadata: { accountingEffect: 'INFORMATIONAL' },
    }),
]);
assert.equal(ledger.grossSales, 200_000);
assert.equal(ledger.commission, 9_000);
assert.equal(ledger.netEarnings, 171_000);

const refund = calculateCustomerRefundAmounts({
    orderStatus: 'CANCELLED',
    productAmount: 200_000,
    deliveryAmount: 45_000,
    marketplaceFundingAmount: 20_600,
});
assert.equal(refund.customerPaidProductAmount, 179_400);
assert.equal(refund.cashAmount, 224_400);

async function verifyMigration() {
    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-coupons-'));
    const dataSource = new DataSource({ type: 'better-sqlite3', database: path.join(directory, 'coupons.sqlite') });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    try {
        await queryRunner.createTable(new Table({
            name: 'marketplace_customer_refund',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }));
        const migration = new AddMarketplaceCoupons1787955600000();
        const rewardMigration = new AddMarketplaceCouponRewards1787959200000();
        await migration.up(queryRunner);
        await rewardMigration.up(queryRunner);
        assert(await queryRunner.hasTable('marketplace_coupon'));
        assert(await queryRunner.hasTable('marketplace_coupon_redemption'));
        const coupon = await queryRunner.getTable('marketplace_coupon');
        const redemption = await queryRunner.getTable('marketplace_coupon_redemption');
        const refundTable = await queryRunner.getTable('marketplace_customer_refund');
        assert(coupon?.indices.some(index => index.name === 'IDX_marketplace_coupon_code' && index.isUnique));
        assert(coupon?.indices.some(index => index.name === 'IDX_marketplace_coupon_purpose'));
        assert(coupon?.indices.some(index => index.name === 'IDX_marketplace_coupon_reward_recipient_id'));
        assert(coupon?.findColumnByName('purpose'));
        assert(coupon?.findColumnByName('rewardRecipientType'));
        assert(redemption?.indices.some(index => index.name === 'IDX_coupon_redemption_order' && index.isUnique));
        assert(refundTable?.findColumnByName('couponDiscountAmount'));
        await rewardMigration.down(queryRunner);
        const couponWithoutRewards = await queryRunner.getTable('marketplace_coupon');
        assert(!couponWithoutRewards?.findColumnByName('rewardRecipientId'));
        await migration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_coupon'));
        assert(!await queryRunner.hasTable('marketplace_coupon_redemption'));
        const restoredRefund = await queryRunner.getTable('marketplace_customer_refund');
        assert(!restoredRefund?.findColumnByName('couponDiscountAmount'));
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

void verifyMigration()
    .then(() => console.log('Coupon policy, accounting, refund, and migration checks passed.'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
