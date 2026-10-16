import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddDynamicMarketplaceCatalog1787660400000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        const entityColumns = [
            { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' as const },
            { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
            { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
        ];

        await queryRunner.createTable(new Table({
            name: 'marketplace_form_template',
            columns: [
                ...entityColumns,
                { name: 'key', type: 'varchar', isUnique: true },
                { name: 'name', type: 'varchar' },
                { name: 'listingType', type: 'varchar' },
                { name: 'version', type: 'integer', default: 1 },
                { name: 'isActive', type: 'boolean', default: true },
                { name: 'schema', type: 'text' },
            ],
        }));
        await queryRunner.createIndices('marketplace_form_template', [
            new TableIndex({ name: 'IDX_marketplace_form_template_listing_type', columnNames: ['listingType'] }),
            new TableIndex({ name: 'IDX_marketplace_form_template_active', columnNames: ['isActive'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_category',
            columns: [
                ...entityColumns,
                { name: 'code', type: 'varchar', isUnique: true },
                { name: 'slug', type: 'varchar' },
                { name: 'name', type: 'varchar' },
                { name: 'parentId', type: 'varchar', isNullable: true },
                { name: 'description', type: 'text', default: "''" },
                { name: 'icon', type: 'varchar', isNullable: true },
                { name: 'imageAssetId', type: 'varchar', isNullable: true },
                { name: 'sortOrder', type: 'integer', default: 0 },
                { name: 'isActive', type: 'boolean', default: true },
                { name: 'formTemplateId', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_category', [
            new TableIndex({ name: 'IDX_marketplace_category_parent', columnNames: ['parentId'] }),
            new TableIndex({ name: 'IDX_marketplace_category_active', columnNames: ['isActive'] }),
            new TableIndex({ name: 'IDX_marketplace_category_template', columnNames: ['formTemplateId'] }),
            new TableIndex({ name: 'UQ_marketplace_category_parent_slug', columnNames: ['parentId', 'slug'], isUnique: true }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_category_field',
            columns: [
                ...entityColumns,
                { name: 'categoryId', type: 'varchar' },
                { name: 'fieldKey', type: 'varchar' },
                { name: 'label', type: 'varchar' },
                { name: 'inputType', type: 'varchar' },
                { name: 'required', type: 'boolean', default: false },
                { name: 'section', type: 'varchar', default: "'Details'" },
                { name: 'helpText', type: 'text', isNullable: true },
                { name: 'placeholder', type: 'varchar', isNullable: true },
                { name: 'unit', type: 'varchar', isNullable: true },
                { name: 'options', type: 'text', isNullable: true },
                { name: 'validation', type: 'text', isNullable: true },
                { name: 'ui', type: 'text', isNullable: true },
                { name: 'condition', type: 'text', isNullable: true },
                { name: 'sortOrder', type: 'integer', default: 0 },
                { name: 'isActive', type: 'boolean', default: true },
                { name: 'overrideMode', type: 'varchar', default: "'REPLACE'" },
            ],
        }));
        await queryRunner.createIndices('marketplace_category_field', [
            new TableIndex({ name: 'IDX_marketplace_category_field_category', columnNames: ['categoryId'] }),
            new TableIndex({ name: 'UQ_marketplace_category_field_key', columnNames: ['categoryId', 'fieldKey'], isUnique: true }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_listing_category',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'categoryId', type: 'varchar' },
                { name: 'isPrimary', type: 'boolean', default: false },
            ],
        }));
        await queryRunner.createIndices('marketplace_listing_category', [
            new TableIndex({ name: 'IDX_marketplace_listing_category_product', columnNames: ['productId'] }),
            new TableIndex({ name: 'IDX_marketplace_listing_category_category', columnNames: ['categoryId'] }),
            new TableIndex({ name: 'UQ_marketplace_listing_category_pair', columnNames: ['productId', 'categoryId'], isUnique: true }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_listing_field_value',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'fieldKey', type: 'varchar' },
                { name: 'value', type: 'text' },
                { name: 'schemaVersion', type: 'integer', default: 1 },
            ],
        }));
        await queryRunner.createIndices('marketplace_listing_field_value', [
            new TableIndex({ name: 'IDX_marketplace_listing_value_product', columnNames: ['productId'] }),
            new TableIndex({ name: 'UQ_marketplace_listing_value_key', columnNames: ['productId', 'fieldKey'], isUnique: true }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_service_package',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'kind', type: 'varchar', default: "'PACKAGE'" },
                { name: 'name', type: 'varchar' },
                { name: 'description', type: 'text', isNullable: true },
                { name: 'inclusions', type: 'text', isNullable: true },
                { name: 'price', type: 'integer', default: 0 },
                { name: 'durationMinutes', type: 'integer', isNullable: true },
                { name: 'sortOrder', type: 'integer', default: 0 },
            ],
        }));
        await queryRunner.createIndex('marketplace_service_package', new TableIndex({ name: 'IDX_marketplace_service_package_product', columnNames: ['productId'] }));

        await queryRunner.createTable(new Table({
            name: 'marketplace_availability_session',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'startsAt', type: timestampType },
                { name: 'endsAt', type: timestampType },
                { name: 'capacity', type: 'integer' },
                { name: 'bookedCount', type: 'integer', default: 0 },
                { name: 'bookingDeadline', type: timestampType, isNullable: true },
                { name: 'recurrenceGroupId', type: 'varchar', isNullable: true },
            ],
        }));
        await queryRunner.createIndex('marketplace_availability_session', new TableIndex({ name: 'IDX_marketplace_availability_product', columnNames: ['productId'] }));

        await queryRunner.createTable(new Table({
            name: 'marketplace_event_ticket_type',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'name', type: 'varchar' },
                { name: 'price', type: 'integer' },
                { name: 'quantity', type: 'integer' },
                { name: 'soldCount', type: 'integer', default: 0 },
                { name: 'saleStartsAt', type: timestampType, isNullable: true },
                { name: 'saleEndsAt', type: timestampType, isNullable: true },
                { name: 'rules', type: 'text', isNullable: true },
                { name: 'sortOrder', type: 'integer', default: 0 },
            ],
        }));
        await queryRunner.createIndex('marketplace_event_ticket_type', new TableIndex({ name: 'IDX_marketplace_event_ticket_product', columnNames: ['productId'] }));

        await queryRunner.createTable(new Table({
            name: 'marketplace_event_schedule_item',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'name', type: 'varchar' },
                { name: 'startsAt', type: timestampType },
                { name: 'endsAt', type: timestampType },
                { name: 'personName', type: 'varchar', isNullable: true },
                { name: 'location', type: 'varchar', isNullable: true },
                { name: 'description', type: 'text', isNullable: true },
                { name: 'sortOrder', type: 'integer', default: 0 },
            ],
        }));
        await queryRunner.createIndex('marketplace_event_schedule_item', new TableIndex({ name: 'IDX_marketplace_event_schedule_product', columnNames: ['productId'] }));

        await queryRunner.createTable(new Table({
            name: 'marketplace_digital_file',
            columns: [
                ...entityColumns,
                { name: 'productId', type: 'varchar' },
                { name: 'kind', type: 'varchar', default: "'MAIN'" },
                { name: 'fileName', type: 'varchar' },
                { name: 'storageKey', type: 'varchar' },
                { name: 'mimeType', type: 'varchar' },
                { name: 'sizeBytes', type: 'integer' },
                { name: 'checksum', type: 'varchar', isNullable: true },
                { name: 'isPrivate', type: 'boolean', default: true },
                { name: 'scanStatus', type: 'varchar', default: "'PENDING'" },
                { name: 'integrityStatus', type: 'varchar', default: "'PENDING'" },
                { name: 'downloadLimit', type: 'integer', isNullable: true },
                { name: 'expiresAt', type: timestampType, isNullable: true },
                { name: 'metadata', type: 'text', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_digital_file', [
            new TableIndex({ name: 'IDX_marketplace_digital_file_product', columnNames: ['productId'] }),
            new TableIndex({ name: 'IDX_marketplace_digital_file_scan', columnNames: ['scanStatus'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_digital_file', true);
        await queryRunner.dropTable('marketplace_event_schedule_item', true);
        await queryRunner.dropTable('marketplace_event_ticket_type', true);
        await queryRunner.dropTable('marketplace_availability_session', true);
        await queryRunner.dropTable('marketplace_service_package', true);
        await queryRunner.dropTable('marketplace_listing_field_value', true);
        await queryRunner.dropTable('marketplace_listing_category', true);
        await queryRunner.dropTable('marketplace_category_field', true);
        await queryRunner.dropTable('marketplace_category', true);
        await queryRunner.dropTable('marketplace_form_template', true);
    }
}
