import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddRewardRedemption1787685600000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_reward_redemption_settings',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'scopeKey', type: 'varchar', default: "'GLOBAL'" },
                { name: 'enabled', type: 'boolean', default: true },
                { name: 'minimumWalletBalance', type: 'integer', default: 100 },
                { name: 'coinsPerPkr', type: 'integer', default: 10 },
                { name: 'updatedByUserId', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndex('marketplace_reward_redemption_settings', new TableIndex({
            name: 'IDX_reward_redemption_settings_scope',
            columnNames: ['scopeKey'],
            isUnique: true,
        }));

        await queryRunner.createTable(new Table({
            name: 'marketplace_reward_redemption',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'orderId', type: 'varchar' },
                { name: 'orderCode', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'customerName', type: 'varchar' },
                { name: 'coins', type: 'integer' },
                { name: 'amount', type: 'integer' },
                { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                { name: 'status', type: 'varchar', default: "'RESERVED'" },
                { name: 'reservedAt', type: timestampType },
                { name: 'appliedAt', type: timestampType, isNullable: true },
                { name: 'reversedAt', type: timestampType, isNullable: true },
                { name: 'reversalReason', type: 'text', isNullable: true },
                { name: 'allocations', type: 'text', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_reward_redemption', [
            new TableIndex({ name: 'IDX_reward_redemption_order', columnNames: ['orderId'], isUnique: true }),
            new TableIndex({ name: 'IDX_reward_redemption_order_code', columnNames: ['orderCode'] }),
            new TableIndex({ name: 'IDX_reward_redemption_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_reward_redemption_user', columnNames: ['customerUserId'] }),
            new TableIndex({ name: 'IDX_reward_redemption_status', columnNames: ['status'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_reward_redemption', true);
        await queryRunner.dropTable('marketplace_reward_redemption_settings', true);
    }
}
