import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddPromotionPayments1788300000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner) {
        const timestamp = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(
            new Table({
                name: 'marketplace_promotion_payment',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: timestamp, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: timestamp, default: 'CURRENT_TIMESTAMP' },
                    { name: 'key', type: 'varchar', isUnique: true },
                    { name: 'requestId', type: 'varchar' },
                    { name: 'vendorProfileId', type: 'varchar' },
                    { name: 'method', type: 'varchar' },
                    { name: 'status', type: 'varchar' },
                    { name: 'amount', type: 'integer' },
                    { name: 'refundedAmount', type: 'integer', default: 0 },
                    { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                    { name: 'reference', type: 'varchar', isNullable: true, isUnique: true },
                    { name: 'checkoutSessionId', type: 'varchar', isNullable: true, isUnique: true },
                    { name: 'cardBrand', type: 'varchar', isNullable: true },
                    { name: 'cardLast4', type: 'varchar', length: '4', isNullable: true },
                    { name: 'note', type: 'text', isNullable: true },
                    { name: 'verifiedAt', type: timestamp, isNullable: true },
                    { name: 'verifiedByUserId', type: 'varchar', isNullable: true },
                ],
            }),
            true,
        );
        await queryRunner.createIndices('marketplace_promotion_payment', [
            new TableIndex({ name: 'IDX_promotion_payment_request', columnNames: ['requestId'] }),
            new TableIndex({ name: 'IDX_promotion_payment_vendor', columnNames: ['vendorProfileId'] }),
            new TableIndex({ name: 'IDX_promotion_payment_verified', columnNames: ['verifiedAt'] }),
        ]);
        // Legacy references are imported by PromotionFinanceService with the same idempotent key in all environments.
    }

    async down(queryRunner: QueryRunner) {
        await queryRunner.dropTable('marketplace_promotion_payment', true);
    }
}
