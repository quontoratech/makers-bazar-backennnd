import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddCustomerManagement1787650200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_customer_consent_record',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'customerId', type: 'varchar' },
                { name: 'userId', type: 'varchar' },
                { name: 'type', type: 'varchar' },
                { name: 'granted', type: 'boolean' },
                { name: 'version', type: 'varchar', default: "'1.0'" },
                { name: 'source', type: 'varchar', default: "'CUSTOMER_REGISTRATION'" },
                { name: 'recordedAt', type: timestampType },
            ],
        }));
        await queryRunner.createIndices('marketplace_customer_consent_record', [
            new TableIndex({ name: 'IDX_customer_consent_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_customer_consent_user', columnNames: ['userId'] }),
            new TableIndex({ name: 'IDX_customer_consent_history', columnNames: ['customerId', 'type', 'recordedAt'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_customer_data_request',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'code', type: 'varchar', isUnique: true },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'customerEmail', type: 'varchar' },
                { name: 'type', type: 'varchar' },
                { name: 'status', type: 'varchar', default: "'SUBMITTED'" },
                { name: 'requestNote', type: 'text' },
                { name: 'correction', type: 'text', isNullable: true },
                { name: 'adminNote', type: 'text', isNullable: true },
                { name: 'requestedByUserId', type: 'varchar' },
                { name: 'handledByUserId', type: 'varchar', isNullable: true },
                { name: 'dueAt', type: timestampType },
                { name: 'completedAt', type: timestampType, isNullable: true },
                { name: 'exportGeneratedAt', type: timestampType, isNullable: true },
                { name: 'retentionReason', type: 'text', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_customer_data_request', [
            new TableIndex({ name: 'IDX_customer_request_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_customer_request_type', columnNames: ['type'] }),
            new TableIndex({ name: 'IDX_customer_request_status', columnNames: ['status'] }),
            new TableIndex({ name: 'IDX_customer_request_history', columnNames: ['customerId', 'createdAt'] }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_customer_data_request', true);
        await queryRunner.dropTable('marketplace_customer_consent_record', true);
    }
}
