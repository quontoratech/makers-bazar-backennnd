import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource } from 'typeorm';

import { AddReviewRewardWallet1787671200000 } from '../migrations/1787671200000-add-review-reward-wallet';
import { eligibleReviewRewards } from '../plugins/marketplace/modules/review/services/review-reward-policy';

async function main() {
    const policy = { productReviewPoints: 1, imageBonusPoints: 2, videoBonusPoints: 3, vendorReviewPoints: 4 };
    assert.deepEqual(Object.fromEntries(eligibleReviewRewards('PRODUCT', [], policy)), { PRODUCT_REVIEW: 1 });
    assert.deepEqual(Object.fromEntries(eligibleReviewRewards('PRODUCT', ['IMAGE', 'IMAGE', 'VIDEO'], policy)), {
        PRODUCT_REVIEW: 1,
        IMAGE_BONUS: 4,
        VIDEO_BONUS: 3,
    });
    assert.deepEqual(Object.fromEntries(eligibleReviewRewards('VENDOR', ['IMAGE', 'VIDEO'], policy)), { VENDOR_REVIEW: 4 });
    assert.deepEqual(Object.fromEntries(eligibleReviewRewards('DELIVERY', [], policy)), {});

    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-review-rewards-'));
    const database = path.join(directory, 'review-rewards.sqlite');
    const dataSource = new DataSource({ type: 'better-sqlite3', database });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    const migration = new AddReviewRewardWallet1787671200000();
    try {
        await migration.up(queryRunner);
        for (const table of [
            'marketplace_review_reward_settings',
            'marketplace_review_reward_grant',
            'marketplace_reward_wallet_transaction',
        ]) {
            assert(await queryRunner.hasTable(table), `Migration did not create ${table}`);
        }

        const grantTable = await queryRunner.getTable('marketplace_review_reward_grant');
        assert(grantTable?.indices.some(index => index.name === 'IDX_review_reward_grant_component' && index.isUnique));
        const walletTable = await queryRunner.getTable('marketplace_reward_wallet_transaction');
        assert(walletTable?.indices.some(index => index.name === 'IDX_reward_wallet_event' && index.isUnique));

        await queryRunner.query(`
            INSERT INTO marketplace_reward_wallet_transaction
                (createdAt, updatedAt, eventKey, customerId, customerUserId, customerName, reviewId, orderCode,
                 reviewTargetType, component, type, points, reason, grantId)
            VALUES
                (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'credit-1', '1', '10', 'QA Customer', '100', 'ORDER-1',
                 'PRODUCT', 'PRODUCT_REVIEW', 'CREDIT', 5, 'Verified product review', '1000'),
                (CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'reversal-1', '1', '10', 'QA Customer', '100', 'ORDER-1',
                 'PRODUCT', 'PRODUCT_REVIEW', 'REVERSAL', -5, 'Verified product review reversed', '1000')
        `);
        const balanceRows = await queryRunner.query(`
            SELECT SUM(points) AS balance FROM marketplace_reward_wallet_transaction WHERE customerUserId = '10'
        `) as Array<{ balance: number }>;
        const balance = balanceRows[0]?.balance;
        assert.notEqual(balance, undefined);
        assert.equal(Number(balance), 0, 'Credit and reversal must net to zero');

        await migration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_reward_wallet_transaction'));
        assert(!await queryRunner.hasTable('marketplace_review_reward_grant'));
        assert(!await queryRunner.hasTable('marketplace_review_reward_settings'));
        console.log(JSON.stringify({ policyCases: 4, tables: 3, uniqueGuards: 2, reversalBalance: Number(balance), roundTrip: 'PASS' }, null, 2));
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
