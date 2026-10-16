import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddCustomerRefunds1787689200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_customer_refund',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'sellerOrderId', type: 'varchar' },
                { name: 'sellerOrderCode', type: 'varchar' },
                { name: 'customerOrderId', type: 'varchar' },
                { name: 'customerOrderCode', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerName', type: 'varchar' },
                { name: 'customerEmail', type: 'varchar' },
                { name: 'vendorId', type: 'varchar' },
                { name: 'vendorName', type: 'varchar' },
                { name: 'orderStatus', type: 'varchar' },
                { name: 'refundScope', type: 'varchar' },
                { name: 'productAmount', type: 'integer' },
                { name: 'customerPaidProductAmount', type: 'integer' },
                { name: 'deliveryAmount', type: 'integer', default: 0 },
                { name: 'marketplaceFundingAmount', type: 'integer', default: 0 },
                { name: 'rewardCoins', type: 'integer', default: 0 },
                { name: 'cashAmount', type: 'integer' },
                { name: 'grossAmount', type: 'integer' },
                { name: 'currencyCode', type: 'varchar', length: '3', default: "'PKR'" },
                { name: 'status', type: 'varchar', default: "'UNPAID'" },
                { name: 'method', type: 'varchar' },
                { name: 'accountHolderName', type: 'varchar' },
                { name: 'bankName', type: 'varchar', isNullable: true },
                { name: 'accountIdentifier', type: 'varchar' },
                { name: 'reason', type: 'text' },
                { name: 'requestedByUserId', type: 'varchar' },
                { name: 'paidByUserId', type: 'varchar', isNullable: true },
                { name: 'paidAt', type: timestampType, isNullable: true },
                { name: 'transactionReference', type: 'varchar', isNullable: true },
                { name: 'rejectedByUserId', type: 'varchar', isNullable: true },
                { name: 'rejectedAt', type: timestampType, isNullable: true },
                { name: 'decisionNote', type: 'text', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_customer_refund', [
            new TableIndex({ name: 'IDX_customer_refund_seller_order', columnNames: ['sellerOrderId'], isUnique: true }),
            new TableIndex({ name: 'IDX_customer_refund_seller_code', columnNames: ['sellerOrderCode'] }),
            new TableIndex({ name: 'IDX_customer_refund_customer_order', columnNames: ['customerOrderId'] }),
            new TableIndex({ name: 'IDX_customer_refund_customer_code', columnNames: ['customerOrderCode'] }),
            new TableIndex({ name: 'IDX_customer_refund_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_customer_refund_vendor', columnNames: ['vendorId'] }),
            new TableIndex({ name: 'IDX_customer_refund_status', columnNames: ['status'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_customer_refund', true);
    }
}
