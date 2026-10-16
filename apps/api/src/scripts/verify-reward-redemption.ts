import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource, PrimaryGeneratedColumn } from 'typeorm';
import { Order, RequestContext, TransactionalConnection, VendureEntity } from '@vendure/core';

import { AddRewardRedemption1787685600000 } from '../migrations/1787685600000-add-reward-redemption';
import { PayoutLedgerEntry } from '../plugins/marketplace/modules/finance/entities/payout-ledger-entry.entity';
import { summarizeVendorLedger } from '../plugins/marketplace/modules/finance/ledger-summary';
import { MarketplaceRewardRedemption } from '../plugins/marketplace/modules/review/entities/marketplace-reward-redemption.entity';
import { MarketplaceRewardWalletTransaction } from '../plugins/marketplace/modules/review/entities/marketplace-reward-wallet-transaction.entity';
import { MarketplaceRewardRedemptionService } from '../plugins/marketplace/modules/review/services/marketplace-reward-redemption.service';
import { MarketplaceCouponService } from '../plugins/marketplace/modules/promotion/services/marketplace-coupon.service';
import {
    allocateCoinsByWeight,
    customerFundedProductAmount,
    maximumRedeemableCoins,
    rewardCoinValueMinor,
    validateCoinsPerPkr,
} from '../plugins/marketplace/modules/review/services/reward-redemption-policy';

assert.equal(validateCoinsPerPkr(10), 10);
assert.equal(rewardCoinValueMinor(10), 10);
assert.throws(() => validateCoinsPerPkr(3), /divide 100 exactly/);

assert.equal(maximumRedeemableCoins(100, 10_000, 10), 100);
assert.equal(maximumRedeemableCoins(5_000, 10_000, 10), 1_000);
assert.equal(60 * rewardCoinValueMinor(10), 600);
assert.equal(10_000 - 60 * rewardCoinValueMinor(10), 9_400);
assert.equal(customerFundedProductAmount(200_000, 600), 199_400);
assert.notEqual(customerFundedProductAmount(200_000, 600), 189_400);

const allocations = allocateCoinsByWeight(60, [6_000, 4_000]);
assert.deepEqual(allocations, [36, 24]);
assert.equal(allocations.reduce((total, coins) => total + coins, 0), 60);
assert.deepEqual(allocateCoinsByWeight(1, [1, 1, 1]), [0, 0, 1]);

const ledger = summarizeVendorLedger([
    new PayoutLedgerEntry({ kind: 'SALE', amount: 10_000, status: 'AVAILABLE' }),
    new PayoutLedgerEntry({ kind: 'COMMISSION', amount: -500, status: 'AVAILABLE' }),
    new PayoutLedgerEntry({
        kind: 'REWARD_FUNDING',
        amount: 600,
        status: 'AVAILABLE',
        metadata: { accountingEffect: 'INFORMATIONAL' },
    }),
]);
assert.equal(ledger.grossSales, 10_000);
assert.equal(ledger.netEarnings, 9_500);

async function verifyMigration() {
    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-reward-redemption-'));
    const dataSource = new DataSource({ type: 'better-sqlite3', database: path.join(directory, 'reward.sqlite') });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    try {
        const migration = new AddRewardRedemption1787685600000();
        await migration.up(queryRunner);
        assert(await queryRunner.hasTable('marketplace_reward_redemption_settings'));
        assert(await queryRunner.hasTable('marketplace_reward_redemption'));
        const redemption = await queryRunner.getTable('marketplace_reward_redemption');
        assert(redemption?.indices.some(index => index.name === 'IDX_reward_redemption_order' && index.isUnique));
        await migration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_reward_redemption'));
        assert(!await queryRunner.hasTable('marketplace_reward_redemption_settings'));
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

async function verifyPartialCoinRestoration() {
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    const source = await new DataSource({ type: 'better-sqlite3', database: ':memory:',
        entities: [MarketplaceRewardRedemption, MarketplaceRewardWalletTransaction, PayoutLedgerEntry],
        synchronize: true }).initialize();
    const connection = { getRepository: (_ctx: RequestContext, entity: typeof MarketplaceRewardRedemption) =>
        source.getRepository(entity) } as unknown as TransactionalConnection;
    const service = new MarketplaceRewardRedemptionService(connection, {} as MarketplaceCouponService);
    const ctx = {} as RequestContext;
    const order = { id: 'seller-1', code: 'SELLER-1' } as Order;
    try {
        const redemption = await source.getRepository(MarketplaceRewardRedemption).save(new MarketplaceRewardRedemption({
            orderId: 'aggregate-1', orderCode: 'ORDER-1', customerId: 'buyer-1', customerUserId: 'user-1',
            customerName: 'QA Buyer', coins: 3, amount: 30, currencyCode: 'PKR', status: 'APPLIED',
            reservedAt: new Date(), allocations: [{ sellerOrderId: 'seller-1', sellerOrderCode: 'SELLER-1',
                vendorId: 'vendor-1', vendorName: 'QA Vendor', coins: 3, amount: 30,
                vendorGrossAmount: 100, customerFundedAmount: 70 }],
        }));
        const wallet = source.getRepository(MarketplaceRewardWalletTransaction);
        await wallet.save(new MarketplaceRewardWalletTransaction({
            eventKey: 'reward-redemption:original-debit', customerId: 'buyer-1', customerUserId: 'user-1',
            customerName: 'QA Buyer', reviewId: `redemption:${redemption.id}`, orderCode: 'ORDER-1',
            reviewTargetType: 'CHECKOUT', component: 'REWARD_REDEMPTION', type: 'DEBIT', points: -3,
            reason: 'Three coins redeemed', grantId: `redemption:${redemption.id}`,
        }));
        await service.restoreForReturnedItems(ctx, order, 'case-1', 1);
        await service.restoreForReturnedItems(ctx, order, 'case-1', 1);
        await service.restoreForReturnedItems(ctx, order, 'case-2', 1);
        await service.restoreForReturnedItems(ctx, order, 'case-3', 1);
        await service.restoreForReturnedItems(ctx, order, 'case-3', 1);
        assert.equal((await wallet.find()).reduce((sum, item) => sum + item.points, 0), 0);
        assert.equal((await wallet.find({ where: { type: 'CREDIT' } })).length, 3,
            'Each selected-item return restores coins exactly once');
        assert.equal((await source.getRepository(MarketplaceRewardRedemption).findOneByOrFail({ id: redemption.id })).status,
            'REVERSED');
    } finally {
        await source.destroy();
    }
}

void verifyMigration()
    .then(verifyPartialCoinRestoration)
    .then(() => console.log('Reward redemption policy, migration and partial restoration checks passed.'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
