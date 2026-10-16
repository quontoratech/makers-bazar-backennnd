import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddPaidMarketplacePromotions1788200000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        if (
            (await queryRunner.hasTable('promotion_campaign')) &&
            !(await queryRunner.hasColumn('promotion_campaign', 'maxPlacements'))
        ) {
            await queryRunner.addColumn(
                'promotion_campaign',
                new TableColumn({
                    name: 'maxPlacements',
                    type: 'integer',
                    default: '3',
                    isNullable: false,
                }),
            );
        }

        await queryRunner.createTable(
            new Table({
                name: 'marketplace_promotion_settings',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'key', type: 'varchar', default: "'default'", isUnique: true },
                    { name: 'homeSlots', type: 'integer', default: 3 },
                    { name: 'categorySlots', type: 'integer', default: 3 },
                    { name: 'paymentWindowHours', type: 'integer', default: 48 },
                    { name: 'paymentInstructions', type: 'text', default: "''" },
                ],
            }),
            true,
        );
        await queryRunner.createTable(
            new Table({
                name: 'marketplace_promotion_rate',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'scope', type: 'varchar' },
                    { name: 'placement', type: 'varchar', default: "'BOTH'" },
                    { name: 'vendorProfileId', type: 'varchar', isNullable: true },
                    { name: 'categoryId', type: 'varchar', isNullable: true },
                    { name: 'categoryCode', type: 'varchar', isNullable: true },
                    { name: 'campaignId', type: 'varchar', isNullable: true },
                    { name: 'pricePerDay', type: 'integer' },
                    { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                    { name: 'active', type: 'boolean', default: true },
                    { name: 'note', type: 'text', isNullable: true },
                ],
            }),
            true,
        );
        await queryRunner.createIndices('marketplace_promotion_rate', [
            new TableIndex({
                name: 'IDX_promotion_rate_scope_placement',
                columnNames: ['scope', 'placement'],
            }),
            new TableIndex({ name: 'IDX_promotion_rate_vendor', columnNames: ['vendorProfileId'] }),
            new TableIndex({ name: 'IDX_promotion_rate_category', columnNames: ['categoryId'] }),
            new TableIndex({ name: 'IDX_promotion_rate_campaign', columnNames: ['campaignId'] }),
        ]);

        await queryRunner.createTable(
            new Table({
                name: 'marketplace_promotion_request',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'code', type: 'varchar' },
                    { name: 'productId', type: 'varchar', isNullable: true },
                    { name: 'targetType', type: 'varchar', default: "'PRODUCT'" },
                    { name: 'productName', type: 'varchar' },
                    { name: 'productSlug', type: 'varchar' },
                    { name: 'vendorProfileId', type: 'varchar' },
                    { name: 'vendorName', type: 'varchar' },
                    { name: 'categoryId', type: 'varchar', isNullable: true },
                    { name: 'categoryCode', type: 'varchar' },
                    { name: 'categoryName', type: 'varchar' },
                    { name: 'placement', type: 'varchar' },
                    { name: 'campaignId', type: 'varchar', isNullable: true },
                    { name: 'campaignCode', type: 'varchar', isNullable: true },
                    { name: 'startsAt', type: timestampType },
                    { name: 'endsAt', type: timestampType },
                    { name: 'durationDays', type: 'integer' },
                    { name: 'pricePerDay', type: 'integer' },
                    { name: 'amount', type: 'integer' },
                    { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                    { name: 'rateScope', type: 'varchar' },
                    { name: 'status', type: 'varchar', default: "'PENDING_REVIEW'" },
                    { name: 'paymentStatus', type: 'varchar', default: "'UNPAID'" },
                    { name: 'paymentReference', type: 'varchar', isNullable: true },
                    { name: 'paymentNote', type: 'text', isNullable: true },
                    { name: 'adminNote', type: 'text', isNullable: true },
                    { name: 'submittedAt', type: timestampType },
                    { name: 'reviewedAt', type: timestampType, isNullable: true },
                    { name: 'reviewedByUserId', type: 'varchar', isNullable: true },
                    { name: 'paymentDueAt', type: timestampType, isNullable: true },
                    { name: 'paymentSubmittedAt', type: timestampType, isNullable: true },
                    { name: 'paymentVerifiedAt', type: timestampType, isNullable: true },
                    { name: 'paymentVerifiedByUserId', type: 'varchar', isNullable: true },
                    { name: 'approvedAt', type: timestampType, isNullable: true },
                    { name: 'priority', type: 'integer', default: 0 },
                ],
            }),
            true,
        );
        await queryRunner.createIndices('marketplace_promotion_request', [
            new TableIndex({ name: 'IDX_promotion_request_code', columnNames: ['code'], isUnique: true }),
            new TableIndex({ name: 'IDX_promotion_request_product', columnNames: ['productId'] }),
            new TableIndex({
                name: 'IDX_promotion_request_payment_reference',
                columnNames: ['paymentReference'],
                isUnique: true,
            }),
            new TableIndex({
                name: 'IDX_promotion_request_vendor_status',
                columnNames: ['vendorProfileId', 'status'],
            }),
            new TableIndex({
                name: 'IDX_promotion_request_status_dates',
                columnNames: ['status', 'startsAt', 'endsAt'],
            }),
            new TableIndex({
                name: 'IDX_promotion_request_placement_dates',
                columnNames: ['placement', 'categoryCode', 'startsAt', 'endsAt'],
            }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_promotion_request', true);
        await queryRunner.dropTable('marketplace_promotion_rate', true);
        await queryRunner.dropTable('marketplace_promotion_settings', true);
        if (
            (await queryRunner.hasTable('promotion_campaign')) &&
            (await queryRunner.hasColumn('promotion_campaign', 'maxPlacements'))
        ) {
            await queryRunner.dropColumn('promotion_campaign', 'maxPlacements');
        }
    }
}
