import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

const inquiryCategoryCodes = [
    'wedding-and-party/wedding-decor',
    'wedding-and-party/party-decorations',
    'wedding-and-party/birthday-decorations',
    'wedding-and-party/baby-shower',
    'wedding-and-party/bridal-shower',
    'wedding-and-party/engagement',
    'wedding-and-party/anniversary',
    'wedding-and-party/graduation',
];

export class AddListingInquiriesAndQuotes1787962800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.addColumn('marketplace_category', new TableColumn({
            name: 'chatEnabled', type: 'boolean', default: false,
        }));
        await queryRunner.createIndex('marketplace_category', new TableIndex({
            name: 'IDX_marketplace_category_chat_enabled', columnNames: ['chatEnabled'],
        }));
        await queryRunner.addColumn('order_line', new TableColumn({
            name: 'customFieldsMarketplacequoteid', type: 'varchar', isNullable: true,
        }));

        const conversation = await queryRunner.getTable('marketplace_chat_conversation');
        for (const name of ['sellerOrderId', 'sellerOrderCode', 'customerOrderId', 'customerOrderCode']) {
            const column = conversation?.findColumnByName(name);
            if (column && !column.isNullable) {
                const nullableColumn = column.clone();
                nullableColumn.isNullable = true;
                await queryRunner.changeColumn('marketplace_chat_conversation', column, nullableColumn);
            }
        }

        await queryRunner.createTable(new Table({
            name: 'marketplace_listing_quote',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'code', type: 'varchar' },
                { name: 'conversationId', type: 'varchar' },
                { name: 'productId', type: 'varchar' },
                { name: 'productVariantId', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'vendorId', type: 'varchar' },
                { name: 'vendorOwnerUserId', type: 'varchar' },
                { name: 'amount', type: 'integer' },
                { name: 'currencyCode', type: 'varchar', default: "'PKR'" },
                { name: 'description', type: 'text', default: "''" },
                { name: 'status', type: 'varchar', default: "'SENT'" },
                { name: 'validUntil', type: timestampType },
                { name: 'orderId', type: 'varchar', isNullable: true },
                { name: 'orderCode', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_listing_quote', [
            new TableIndex({ name: 'IDX_listing_quote_code', columnNames: ['code'], isUnique: true }),
            new TableIndex({ name: 'IDX_listing_quote_conversation', columnNames: ['conversationId'] }),
            new TableIndex({ name: 'IDX_listing_quote_product', columnNames: ['productId'] }),
            new TableIndex({ name: 'IDX_listing_quote_variant', columnNames: ['productVariantId'] }),
            new TableIndex({ name: 'IDX_listing_quote_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_listing_quote_customer_user', columnNames: ['customerUserId'] }),
            new TableIndex({ name: 'IDX_listing_quote_vendor', columnNames: ['vendorId'] }),
            new TableIndex({ name: 'IDX_listing_quote_vendor_user', columnNames: ['vendorOwnerUserId'] }),
            new TableIndex({ name: 'IDX_listing_quote_status', columnNames: ['status'] }),
            new TableIndex({ name: 'IDX_listing_quote_order', columnNames: ['orderId'] }),
        ]);

        const categoryCodes = inquiryCategoryCodes.map(code => `'${code}'`).join(', ');
        await queryRunner.query(
            `UPDATE "marketplace_category" SET "chatEnabled" = true WHERE "code" IN (${categoryCodes})`,
        );
        await queryRunner.query(
            `UPDATE "marketplace_category" SET "formTemplateId" = (SELECT "id" FROM "marketplace_form_template" WHERE "key" = 'service' LIMIT 1) WHERE "code" IN (${categoryCodes})`,
        );
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_listing_quote', true);
        await queryRunner.query(`DELETE FROM "marketplace_chat_attachment" WHERE "conversationId" IN (SELECT CAST("id" AS varchar) FROM "marketplace_chat_conversation" WHERE "conversationType" = 'LISTING_INQUIRY')`);
        await queryRunner.query(`DELETE FROM "marketplace_chat_message" WHERE "conversationId" IN (SELECT CAST("id" AS varchar) FROM "marketplace_chat_conversation" WHERE "conversationType" = 'LISTING_INQUIRY')`);
        await queryRunner.query(`DELETE FROM "marketplace_chat_read_state" WHERE "conversationId" IN (SELECT CAST("id" AS varchar) FROM "marketplace_chat_conversation" WHERE "conversationType" = 'LISTING_INQUIRY')`);
        await queryRunner.query(`DELETE FROM "marketplace_chat_conversation" WHERE "conversationType" = 'LISTING_INQUIRY'`);
        const conversation = await queryRunner.getTable('marketplace_chat_conversation');
        for (const name of ['sellerOrderId', 'sellerOrderCode', 'customerOrderId', 'customerOrderCode']) {
            const column = conversation?.findColumnByName(name);
            if (column?.isNullable) {
                const requiredColumn = column.clone();
                requiredColumn.isNullable = false;
                await queryRunner.changeColumn('marketplace_chat_conversation', column, requiredColumn);
            }
        }
        await queryRunner.dropColumn('order_line', 'customFieldsMarketplacequoteid');
        await queryRunner.dropColumn('marketplace_category', 'chatEnabled');
    }
}
