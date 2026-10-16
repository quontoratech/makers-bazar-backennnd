import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddVendorCategoryRequestCoreTypes1787678400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn('marketplace_vendor_category_request', new TableColumn({
            name: 'listingTypes',
            type: 'text',
            isNullable: true,
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('marketplace_vendor_category_request', 'listingTypes');
    }
}
