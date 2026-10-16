import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddMarketplaceReturnItems1789000000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns('support_case', [
            new TableColumn({ name: 'returnItems', type: 'text', isNullable: true }),
            new TableColumn({ name: 'sellerOrderStatusBeforeReturn', type: 'varchar', isNullable: true }),
        ]);
        await queryRunner.dropIndex('support_case', 'IDX_support_case_seller_order');
        await queryRunner.createIndex('support_case', new TableIndex({
            name: 'IDX_support_case_seller_order', columnNames: ['sellerOrderId'],
        }));
        await queryRunner.createIndex('support_case', new TableIndex({
            name: 'IDX_support_case_active_return', columnNames: ['sellerOrderId'], isUnique: true,
            where: `"sellerOrderId" IS NOT NULL AND "category" = 'RETURN_DISPUTE' AND "status" NOT IN ('RETURN_REJECTED', 'REFUNDED')`,
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropIndex('support_case', 'IDX_support_case_active_return');
        await queryRunner.dropIndex('support_case', 'IDX_support_case_seller_order');
        await queryRunner.createIndex('support_case', new TableIndex({
            name: 'IDX_support_case_seller_order', columnNames: ['sellerOrderId'], isUnique: true,
        }));
        await queryRunner.dropColumns('support_case', ['sellerOrderStatusBeforeReturn', 'returnItems']);
    }
}
