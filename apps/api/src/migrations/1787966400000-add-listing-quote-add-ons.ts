import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddListingQuoteAddOns1787966400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn('marketplace_listing_quote', new TableColumn({
            name: 'addOns',
            type: 'text',
            isNullable: true,
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('marketplace_listing_quote', 'addOns');
    }
}
