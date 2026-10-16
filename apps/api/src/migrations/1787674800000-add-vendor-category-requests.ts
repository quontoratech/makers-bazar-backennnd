import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddVendorCategoryRequests1787674800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_vendor_category_request',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'code', type: 'varchar' },
                { name: 'vendorProfileId', type: 'varchar' },
                { name: 'vendorName', type: 'varchar' },
                { name: 'requestedCategoryId', type: 'varchar' },
                { name: 'requestedCategoryCode', type: 'varchar' },
                { name: 'requestedCategoryName', type: 'varchar' },
                { name: 'requestedCategoryBreadcrumb', type: 'text' },
                { name: 'listingType', type: 'varchar' },
                { name: 'businessReason', type: 'text' },
                { name: 'experience', type: 'text' },
                { name: 'fulfilmentPlan', type: 'text' },
                { name: 'complianceConfirmed', type: 'boolean', default: false },
                { name: 'status', type: 'varchar', default: "'PENDING'" },
                { name: 'submittedByUserId', type: 'varchar' },
                { name: 'submittedAt', type: timestampType },
                { name: 'reviewedByUserId', type: 'varchar', isNullable: true },
                { name: 'adminNote', type: 'text', isNullable: true },
                { name: 'reviewedAt', type: timestampType, isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_vendor_category_request', [
            new TableIndex({ name: 'IDX_vendor_category_request_code', columnNames: ['code'], isUnique: true }),
            new TableIndex({ name: 'IDX_vendor_category_request_vendor', columnNames: ['vendorProfileId'] }),
            new TableIndex({ name: 'IDX_vendor_category_request_category', columnNames: ['requestedCategoryId'] }),
            new TableIndex({ name: 'IDX_vendor_category_request_listing_type', columnNames: ['listingType'] }),
            new TableIndex({ name: 'IDX_vendor_category_request_status', columnNames: ['status'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_vendor_category_request_document',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'uploadedByUserId', type: 'varchar' },
                { name: 'requestId', type: 'varchar', isNullable: true },
                { name: 'assetId', type: 'varchar' },
                { name: 'name', type: 'varchar' },
                { name: 'preview', type: 'varchar' },
                { name: 'source', type: 'varchar' },
                { name: 'mimeType', type: 'varchar' },
                { name: 'documentType', type: 'varchar', default: "'SUPPORTING_DOCUMENT'" },
                { name: 'expiresAt', type: timestampType, isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_vendor_category_request_document', [
            new TableIndex({ name: 'IDX_vendor_category_document_user', columnNames: ['uploadedByUserId'] }),
            new TableIndex({ name: 'IDX_vendor_category_document_request', columnNames: ['requestId'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_vendor_category_request_document', true);
        await queryRunner.dropTable('marketplace_vendor_category_request', true);
    }
}
