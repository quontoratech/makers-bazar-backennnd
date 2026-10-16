import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddPurchaseRewardRules1787682000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_purchase_reward_rule',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'name', type: 'varchar' },
                { name: 'scope', type: 'varchar' },
                { name: 'targetId', type: 'varchar', isNullable: true },
                { name: 'targetCode', type: 'varchar', isNullable: true },
                { name: 'targetName', type: 'varchar', isNullable: true },
                { name: 'pointsPerUnit', type: 'integer', default: 0 },
                { name: 'priority', type: 'integer', default: 0 },
                { name: 'status', type: 'varchar', default: "'ACTIVE'" },
                { name: 'startsAt', type: timestampType, isNullable: true },
                { name: 'endsAt', type: timestampType, isNullable: true },
                { name: 'description', type: 'text', isNullable: true },
                { name: 'updatedByUserId', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_purchase_reward_rule', [
            new TableIndex({ name: 'IDX_purchase_reward_rule_scope', columnNames: ['scope'] }),
            new TableIndex({ name: 'IDX_purchase_reward_rule_target_id', columnNames: ['targetId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_rule_target_code', columnNames: ['targetCode'] }),
            new TableIndex({ name: 'IDX_purchase_reward_rule_status', columnNames: ['status'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_purchase_reward_grant',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'orderId', type: 'varchar' },
                { name: 'orderCode', type: 'varchar' },
                { name: 'sellerOrderCode', type: 'varchar' },
                { name: 'orderLineId', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'customerName', type: 'varchar' },
                { name: 'productId', type: 'varchar' },
                { name: 'productName', type: 'varchar' },
                { name: 'vendorId', type: 'varchar', isNullable: true },
                { name: 'vendorName', type: 'varchar', isNullable: true },
                { name: 'categoryId', type: 'varchar', isNullable: true },
                { name: 'categoryCode', type: 'varchar', isNullable: true },
                { name: 'categoryName', type: 'varchar', isNullable: true },
                { name: 'ruleId', type: 'varchar' },
                { name: 'ruleName', type: 'varchar' },
                { name: 'ruleScope', type: 'varchar' },
                { name: 'quantity', type: 'integer' },
                { name: 'pointsPerUnit', type: 'integer' },
                { name: 'points', type: 'integer' },
                { name: 'active', type: 'boolean', default: true },
                { name: 'awardedAt', type: timestampType },
                { name: 'reversedAt', type: timestampType, isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_purchase_reward_grant', [
            new TableIndex({
                name: 'IDX_purchase_reward_grant_order_line',
                columnNames: ['orderId', 'orderLineId'],
                isUnique: true,
            }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_order', columnNames: ['orderId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_user', columnNames: ['customerUserId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_product', columnNames: ['productId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_vendor', columnNames: ['vendorId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_category', columnNames: ['categoryId'] }),
            new TableIndex({ name: 'IDX_purchase_reward_grant_rule', columnNames: ['ruleId'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_purchase_reward_grant', true);
        await queryRunner.dropTable('marketplace_purchase_reward_rule', true);
    }
}
