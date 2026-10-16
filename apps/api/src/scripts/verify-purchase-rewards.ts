import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource, PrimaryGeneratedColumn } from 'typeorm';
import { Order, RequestContext, TransactionalConnection, VendureEntity } from '@vendure/core';

import { AddReviewRewardWallet1787671200000 } from '../migrations/1787671200000-add-review-reward-wallet';
import { AddPurchaseRewardRules1787682000000 } from '../migrations/1787682000000-add-purchase-reward-rules';
import { resolvePurchaseRewardRule } from '../plugins/marketplace/modules/review/services/purchase-reward-policy';
import { MarketplacePurchaseRewardGrant } from '../plugins/marketplace/modules/review/entities/marketplace-purchase-reward-grant.entity';
import { MarketplaceRewardWalletTransaction } from '../plugins/marketplace/modules/review/entities/marketplace-reward-wallet-transaction.entity';
import { MarketplacePurchaseRewardService } from '../plugins/marketplace/modules/review/services/marketplace-purchase-reward.service';

async function verifyPartialRewardReversals() {
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    const source = await new DataSource({ type: 'better-sqlite3', database: ':memory:',
        entities: [MarketplacePurchaseRewardGrant, MarketplaceRewardWalletTransaction], synchronize: true }).initialize();
    const connection = { getRepository: (_ctx: RequestContext, entity: typeof MarketplacePurchaseRewardGrant) =>
        source.getRepository(entity) } as unknown as TransactionalConnection;
    const service = new MarketplacePurchaseRewardService(connection);
    const ctx = {} as RequestContext;
    const order = { id: 'seller-1', code: 'SELLER-1' } as Order;
    try {
        const grant = await source.getRepository(MarketplacePurchaseRewardGrant).save(new MarketplacePurchaseRewardGrant({
            orderId: 'seller-1', orderCode: 'CUSTOMER-1', sellerOrderCode: 'SELLER-1', orderLineId: 'line-1',
            customerId: 'buyer-1', customerUserId: 'user-1', customerName: 'QA Buyer',
            productId: 'product-1', productName: 'Scarf', ruleId: 'rule-1', ruleName: 'Five coins',
            ruleScope: 'GLOBAL', quantity: 3, pointsPerUnit: 5, points: 15,
            active: true, awardedAt: new Date(),
        }));
        const wallet = source.getRepository(MarketplaceRewardWalletTransaction);
        await wallet.save(new MarketplaceRewardWalletTransaction({
            eventKey: 'purchase-credit', customerId: 'buyer-1', customerUserId: 'user-1',
            customerName: 'QA Buyer', reviewId: `purchase:${grant.id}`, orderCode: 'CUSTOMER-1',
            reviewTargetType: 'PURCHASE', component: 'PURCHASE_REWARD', type: 'CREDIT', points: 15,
            reason: 'Three scarves purchased', grantId: `purchase:${grant.id}`,
        }));
        await service.reverseForReturnedItems(ctx, order, 'case-1', [{ orderLineId: 'line-1', quantity: 1 }]);
        await service.reverseForReturnedItems(ctx, order, 'case-1', [{ orderLineId: 'line-1', quantity: 1 }]);
        assert.equal((await wallet.find({ where: { type: 'REVERSAL' } })).length, 1,
            'Retrying the same case must not reverse coins twice');
        assert.equal((await source.getRepository(MarketplacePurchaseRewardGrant).findOneByOrFail({ id: grant.id })).active, true);
        await service.reverseForSellerOrder(ctx, order);
        const transactions = await wallet.find();
        assert.equal(transactions.reduce((sum, item) => sum + item.points, 0), 0,
            'A later full reversal must deduct only the coins left after a partial return');
    } finally {
        await source.destroy();
    }
}

async function main() {
    const createdAt = new Date('2026-01-01T00:00:00.000Z');
    const rules = [
        { id: 'global', scope: 'GLOBAL' as const, priority: 0, createdAt, pointsPerUnit: 5 },
        { id: 'vendor', scope: 'VENDOR' as const, targetId: '4', priority: 0, createdAt, pointsPerUnit: 8 },
        { id: 'category-low', scope: 'CATEGORY' as const, targetCode: 'food', priority: 1, createdAt, pointsPerUnit: 10 },
        { id: 'category-high', scope: 'CATEGORY' as const, targetCode: 'food', priority: 2, createdAt, pointsPerUnit: 12 },
    ];
    assert.equal(resolvePurchaseRewardRule(rules, ['4'], new Set(['food']))?.id, 'category-high');
    assert.equal(resolvePurchaseRewardRule(rules, ['4'], new Set(['physical']))?.id, 'vendor');
    assert.equal(resolvePurchaseRewardRule(rules, ['9'], new Set(['physical']))?.id, 'global');

    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-purchase-rewards-'));
    const database = path.join(directory, 'purchase-rewards.sqlite');
    const dataSource = new DataSource({ type: 'better-sqlite3', database });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    const walletMigration = new AddReviewRewardWallet1787671200000();
    const purchaseMigration = new AddPurchaseRewardRules1787682000000();
    try {
        await walletMigration.up(queryRunner);
        await purchaseMigration.up(queryRunner);
        assert(await queryRunner.hasTable('marketplace_purchase_reward_rule'));
        assert(await queryRunner.hasTable('marketplace_purchase_reward_grant'));

        const grantTable = await queryRunner.getTable('marketplace_purchase_reward_grant');
        assert(grantTable?.indices.some(index => index.name === 'IDX_purchase_reward_grant_order_line' && index.isUnique));

        const insertGrant = `
            INSERT INTO marketplace_purchase_reward_grant
                (createdAt, updatedAt, orderId, orderCode, sellerOrderCode, orderLineId,
                 customerId, customerUserId, customerName, productId, productName, vendorId, vendorName,
                 categoryId, categoryCode, categoryName, ruleId, ruleName, ruleScope,
                 quantity, pointsPerUnit, points, active, awardedAt)
            VALUES
                (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'order-1', 'CUSTOMER-1', 'SELLER-1', 'line-1',
                 'customer-1', 'user-1', 'QA Customer', 'product-1', 'QA Product', 'vendor-1', 'QA Vendor',
                 'category-1', 'food', 'Food', 'rule-1', 'Food reward', 'CATEGORY',
                 2, 10, 20, 1, CURRENT_TIMESTAMP)
        `;
        await queryRunner.query(insertGrant);
        let duplicateBlocked = false;
        try {
            await queryRunner.query(insertGrant);
        } catch {
            duplicateBlocked = true;
        }
        assert(duplicateBlocked, 'The same order line must not receive two purchase grants');

        await queryRunner.query(`
            INSERT INTO marketplace_reward_wallet_transaction
                (createdAt, updatedAt, eventKey, customerId, customerUserId, customerName, reviewId,
                 orderCode, reviewTargetType, component, type, points, reason, grantId)
            VALUES
                (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'purchase-credit', 'customer-1', 'user-1', 'QA Customer',
                 'purchase:1', 'CUSTOMER-1', 'PURCHASE', 'PURCHASE_REWARD', 'CREDIT', 20,
                 'QA Product purchase reward', 'purchase:1'),
                (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'purchase-reversal', 'customer-1', 'user-1', 'QA Customer',
                 'purchase:1', 'CUSTOMER-1', 'PURCHASE', 'PURCHASE_REWARD', 'REVERSAL', -20,
                 'QA Product purchase reward reversed', 'purchase:1')
        `);
        const rows = await queryRunner.query(`
            SELECT SUM(points) AS balance
            FROM marketplace_reward_wallet_transaction
            WHERE customerUserId = 'user-1'
        `) as Array<{ balance: number }>;
        assert.equal(Number(rows[0]?.balance), 0, 'Purchase credit and refund reversal must net to zero');

        await purchaseMigration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_purchase_reward_grant'));
        assert(!await queryRunner.hasTable('marketplace_purchase_reward_rule'));
        assert(await queryRunner.hasTable('marketplace_reward_wallet_transaction'));
        await walletMigration.down(queryRunner);
        await verifyPartialRewardReversals();
        console.log(JSON.stringify({
            precedenceCases: 3,
            tables: 2,
            duplicateGrantBlocked: duplicateBlocked,
            reversalBalance: Number(rows[0]?.balance),
            roundTrip: 'PASS',
        }, null, 2));
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
