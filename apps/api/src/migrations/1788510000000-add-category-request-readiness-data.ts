import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddCategoryRequestReadinessData1788510000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumns('marketplace_vendor_category_request', [
            new TableColumn({ name: 'categoryData', type: 'text', isNullable: true }),
            new TableColumn({ name: 'kycData', type: 'text', isNullable: true }),
        ]);
        await queryRunner.addColumn('marketplace_vendor_category_request_document', new TableColumn({
            name: 'fieldKey',
            type: 'varchar',
            default: "'supportingDocuments'",
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('marketplace_vendor_category_request_document', 'fieldKey');
        await queryRunner.dropColumn('marketplace_vendor_category_request', 'kycData');
        await queryRunner.dropColumn('marketplace_vendor_category_request', 'categoryData');
    }
}
