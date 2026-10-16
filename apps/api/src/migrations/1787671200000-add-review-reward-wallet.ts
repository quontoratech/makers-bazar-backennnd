import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddReviewRewardWallet1787671200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_review_reward_settings',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'scopeKey', type: 'varchar', default: "'GLOBAL'" },
                { name: 'enabled', type: 'boolean', default: true },
                { name: 'productReviewPoints', type: 'integer', default: 1 },
                { name: 'imageBonusPoints', type: 'integer', default: 2 },
                { name: 'videoBonusPoints', type: 'integer', default: 2 },
                { name: 'vendorReviewPoints', type: 'integer', default: 1 },
                { name: 'updatedByUserId', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndex('marketplace_review_reward_settings', new TableIndex({
            name: 'IDX_review_reward_settings_scope',
            columnNames: ['scopeKey'],
            isUnique: true,
        }));

        await queryRunner.createTable(new Table({
            name: 'marketplace_review_reward_grant',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'reviewId', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'component', type: 'varchar' },
                { name: 'points', type: 'integer' },
                { name: 'active', type: 'boolean', default: true },
                { name: 'awardedAt', type: timestampType },
                { name: 'reversedAt', type: timestampType, isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_review_reward_grant', [
            new TableIndex({ name: 'IDX_review_reward_grant_review', columnNames: ['reviewId'] }),
            new TableIndex({ name: 'IDX_review_reward_grant_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_review_reward_grant_user', columnNames: ['customerUserId'] }),
            new TableIndex({
                name: 'IDX_review_reward_grant_component',
                columnNames: ['reviewId', 'component'],
                isUnique: true,
            }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_reward_wallet_transaction',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'eventKey', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'customerName', type: 'varchar' },
                { name: 'reviewId', type: 'varchar' },
                { name: 'orderCode', type: 'varchar' },
                { name: 'reviewTargetType', type: 'varchar' },
                { name: 'component', type: 'varchar' },
                { name: 'type', type: 'varchar' },
                { name: 'points', type: 'integer' },
                { name: 'reason', type: 'varchar' },
                { name: 'grantId', type: 'varchar' },
            ],
        }));
        await queryRunner.createIndices('marketplace_reward_wallet_transaction', [
            new TableIndex({ name: 'IDX_reward_wallet_event', columnNames: ['eventKey'], isUnique: true }),
            new TableIndex({ name: 'IDX_reward_wallet_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_reward_wallet_user', columnNames: ['customerUserId'] }),
            new TableIndex({ name: 'IDX_reward_wallet_review', columnNames: ['reviewId'] }),
            new TableIndex({ name: 'IDX_reward_wallet_grant', columnNames: ['grantId'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_reward_wallet_transaction', true);
        await queryRunner.dropTable('marketplace_review_reward_grant', true);
        await queryRunner.dropTable('marketplace_review_reward_settings', true);
    }
}
