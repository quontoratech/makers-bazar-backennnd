import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddPartialCustomerRefunds1789003600000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const table = await queryRunner.getTable('marketplace_customer_refund');
        for (const index of table?.indices ?? []) {
            if (index.isUnique && index.columnNames.length === 1 && index.columnNames[0] === 'sellerOrderId') {
                await queryRunner.dropIndex('marketplace_customer_refund', index);
            }
        }
        await queryRunner.createIndex('marketplace_customer_refund', new TableIndex({
            name: 'IDX_customer_refund_seller_order', columnNames: ['sellerOrderId'],
        }));
        await queryRunner.addColumn('marketplace_customer_refund', new TableColumn({
            name: 'supportCaseId', type: 'varchar', isNullable: true,
        }));
        await queryRunner.addColumn('marketplace_customer_refund', new TableColumn({
            name: 'returnItems', type: 'text', isNullable: true,
        }));
        await queryRunner.createIndex('marketplace_customer_refund', new TableIndex({
            name: 'IDX_customer_refund_support_case', columnNames: ['supportCaseId'], isUnique: true,
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        const duplicates = await queryRunner.query(
            'SELECT "sellerOrderId" FROM "marketplace_customer_refund" GROUP BY "sellerOrderId" HAVING COUNT(*) > 1',
        ) as unknown[];
        if (duplicates.length) throw new Error('Cannot restore one refund per seller order after partial refunds have been created');
        await queryRunner.dropIndex('marketplace_customer_refund', 'IDX_customer_refund_support_case');
        await queryRunner.dropColumn('marketplace_customer_refund', 'returnItems');
        await queryRunner.dropColumn('marketplace_customer_refund', 'supportCaseId');
        await queryRunner.dropIndex('marketplace_customer_refund', 'IDX_customer_refund_seller_order');
        await queryRunner.createIndex('marketplace_customer_refund', new TableIndex({
            name: 'IDX_customer_refund_seller_order', columnNames: ['sellerOrderId'], isUnique: true,
        }));
    }
}
