import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddMarketplaceReturnCases1788760000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.addColumns('support_case', [
            new TableColumn({ name: 'sellerOrderId', type: 'varchar', isNullable: true }),
            new TableColumn({ name: 'returnWindowDays', type: 'integer', isNullable: true }),
            new TableColumn({ name: 'returnDeadlineAt', type: timestampType, isNullable: true }),
            new TableColumn({ name: 'returnRequired', type: 'boolean', isNullable: true }),
            new TableColumn({ name: 'refundId', type: 'varchar', isNullable: true }),
            new TableColumn({ name: 'refundStatus', type: 'varchar', isNullable: true }),
            new TableColumn({ name: 'internalMessages', type: 'text', isNullable: true }),
        ]);
        await queryRunner.createIndex('support_case', new TableIndex({
            name: 'IDX_support_case_seller_order', columnNames: ['sellerOrderId'], isUnique: true,
        }));
        await queryRunner.addColumn('order', new TableColumn({
            name: 'customFieldsMarketplacedeliveredat', type: timestampType, isNullable: true,
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('order', 'customFieldsMarketplacedeliveredat');
        await queryRunner.dropIndex('support_case', 'IDX_support_case_seller_order');
        await queryRunner.dropColumns('support_case', [
            'internalMessages', 'refundStatus', 'refundId', 'returnRequired', 'returnDeadlineAt', 'returnWindowDays', 'sellerOrderId',
        ]);
    }
}
