import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddMarketplaceCoupons1787955600000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_coupon',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'code', type: 'varchar' },
                { name: 'name', type: 'varchar' },
                { name: 'description', type: 'text', isNullable: true },
                { name: 'scope', type: 'varchar' },
                { name: 'targetId', type: 'varchar', isNullable: true },
                { name: 'targetCode', type: 'varchar', isNullable: true },
                { name: 'targetName', type: 'varchar', isNullable: true },
                { name: 'discountType', type: 'varchar' },
                { name: 'discountValue', type: 'float' },
                { name: 'maximumDiscount', type: 'integer', isNullable: true },
                { name: 'minimumSpend', type: 'integer', default: 0 },
                { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                { name: 'fundingSource', type: 'varchar', default: "'MARKETPLACE'" },
                { name: 'totalUsageLimit', type: 'integer', isNullable: true },
                { name: 'perCustomerUsageLimit', type: 'integer', default: 1 },
                { name: 'status', type: 'varchar', default: "'DRAFT'" },
                { name: 'startsAt', type: timestampType, isNullable: true },
                { name: 'endsAt', type: timestampType, isNullable: true },
                { name: 'createdByUserId', type: 'varchar', isNullable: true },
                { name: 'updatedByUserId', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_coupon', [
            new TableIndex({ name: 'IDX_marketplace_coupon_code', columnNames: ['code'], isUnique: true }),
            new TableIndex({ name: 'IDX_marketplace_coupon_scope', columnNames: ['scope'] }),
            new TableIndex({ name: 'IDX_marketplace_coupon_status', columnNames: ['status'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_coupon_redemption',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'couponId', type: 'varchar' },
                { name: 'couponCode', type: 'varchar' },
                { name: 'orderId', type: 'varchar' },
                { name: 'orderCode', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'customerName', type: 'varchar' },
                { name: 'eligibleSubtotal', type: 'integer' },
                { name: 'amount', type: 'integer' },
                { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                { name: 'fundingSource', type: 'varchar' },
                { name: 'status', type: 'varchar', default: "'RESERVED'" },
                { name: 'reservedAt', type: timestampType },
                { name: 'appliedAt', type: timestampType, isNullable: true },
                { name: 'reversedAt', type: timestampType, isNullable: true },
                { name: 'reversalReason', type: 'text', isNullable: true },
                { name: 'ruleSnapshot', type: 'text' },
                { name: 'allocations', type: 'text', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_coupon_redemption', [
            new TableIndex({ name: 'IDX_coupon_redemption_coupon', columnNames: ['couponId'] }),
            new TableIndex({ name: 'IDX_coupon_redemption_code', columnNames: ['couponCode'] }),
            new TableIndex({ name: 'IDX_coupon_redemption_order', columnNames: ['orderId'], isUnique: true }),
            new TableIndex({ name: 'IDX_coupon_redemption_order_code', columnNames: ['orderCode'] }),
            new TableIndex({ name: 'IDX_coupon_redemption_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_coupon_redemption_user', columnNames: ['customerUserId'] }),
            new TableIndex({ name: 'IDX_coupon_redemption_status', columnNames: ['status'] }),
        ]);
        if (await queryRunner.hasTable('marketplace_customer_refund')) {
            await queryRunner.addColumns('marketplace_customer_refund', [
                new TableColumn({ name: 'couponCode', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'couponDiscountAmount', type: 'integer', default: 0 }),
                new TableColumn({ name: 'couponFundingSource', type: 'varchar', isNullable: true }),
            ]);
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('marketplace_customer_refund')) {
            await queryRunner.dropColumn('marketplace_customer_refund', 'couponFundingSource');
            await queryRunner.dropColumn('marketplace_customer_refund', 'couponDiscountAmount');
            await queryRunner.dropColumn('marketplace_customer_refund', 'couponCode');
        }
        await queryRunner.dropTable('marketplace_coupon_redemption', true);
        await queryRunner.dropTable('marketplace_coupon', true);
    }
}
