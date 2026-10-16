import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class AddMarketplaceOrderChat1787692800000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.createTable(new Table({
            name: 'marketplace_chat_conversation',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'sellerOrderId', type: 'varchar' },
                { name: 'sellerOrderCode', type: 'varchar' },
                { name: 'customerOrderId', type: 'varchar' },
                { name: 'customerOrderCode', type: 'varchar' },
                { name: 'customerId', type: 'varchar' },
                { name: 'customerUserId', type: 'varchar' },
                { name: 'customerName', type: 'varchar' },
                { name: 'customerEmail', type: 'varchar' },
                { name: 'vendorId', type: 'varchar' },
                { name: 'vendorOwnerUserId', type: 'varchar' },
                { name: 'vendorName', type: 'varchar' },
                { name: 'status', type: 'varchar', default: "'OPEN'" },
                { name: 'lastMessageAt', type: timestampType },
                { name: 'lastMessagePreview', type: 'text' },
                { name: 'lastSenderRole', type: 'varchar' },
            ],
        }));
        await queryRunner.createIndices('marketplace_chat_conversation', [
            new TableIndex({ name: 'IDX_chat_conversation_seller_order', columnNames: ['sellerOrderId'], isUnique: true }),
            new TableIndex({ name: 'IDX_chat_conversation_seller_code', columnNames: ['sellerOrderCode'] }),
            new TableIndex({ name: 'IDX_chat_conversation_customer_order', columnNames: ['customerOrderId'] }),
            new TableIndex({ name: 'IDX_chat_conversation_customer_code', columnNames: ['customerOrderCode'] }),
            new TableIndex({ name: 'IDX_chat_conversation_customer', columnNames: ['customerId'] }),
            new TableIndex({ name: 'IDX_chat_conversation_customer_user', columnNames: ['customerUserId'] }),
            new TableIndex({ name: 'IDX_chat_conversation_vendor', columnNames: ['vendorId'] }),
            new TableIndex({ name: 'IDX_chat_conversation_vendor_user', columnNames: ['vendorOwnerUserId'] }),
            new TableIndex({ name: 'IDX_chat_conversation_status', columnNames: ['status'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_chat_message',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'conversationId', type: 'varchar' },
                { name: 'senderUserId', type: 'varchar', isNullable: true },
                { name: 'senderName', type: 'varchar' },
                { name: 'senderRole', type: 'varchar' },
                { name: 'kind', type: 'varchar', default: "'TEXT'" },
                { name: 'body', type: 'text' },
                { name: 'automated', type: 'boolean', default: false },
                { name: 'clientMessageId', type: 'varchar', isNullable: true },
                { name: 'metadata', type: 'text', isNullable: true },
            ],
        }));
        await queryRunner.createIndices('marketplace_chat_message', [
            new TableIndex({ name: 'IDX_chat_message_conversation', columnNames: ['conversationId'] }),
            new TableIndex({ name: 'IDX_chat_message_sender', columnNames: ['senderUserId'] }),
            new TableIndex({ name: 'IDX_chat_message_role', columnNames: ['senderRole'] }),
            new TableIndex({ name: 'IDX_chat_message_kind', columnNames: ['kind'] }),
            new TableIndex({ name: 'IDX_chat_message_timeline', columnNames: ['conversationId', 'createdAt'] }),
            new TableIndex({ name: 'IDX_chat_message_idempotency', columnNames: ['senderUserId', 'clientMessageId'], isUnique: true }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_chat_read_state',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'conversationId', type: 'varchar' },
                { name: 'userId', type: 'varchar' },
                { name: 'role', type: 'varchar' },
                { name: 'lastReadAt', type: timestampType },
            ],
        }));
        await queryRunner.createIndices('marketplace_chat_read_state', [
            new TableIndex({ name: 'IDX_chat_read_conversation', columnNames: ['conversationId'] }),
            new TableIndex({ name: 'IDX_chat_read_user', columnNames: ['userId'] }),
            new TableIndex({ name: 'IDX_chat_read_participant', columnNames: ['conversationId', 'userId'], isUnique: true }),
        ]);
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropTable('marketplace_chat_read_state', true);
        await queryRunner.dropTable('marketplace_chat_message', true);
        await queryRunner.dropTable('marketplace_chat_conversation', true);
    }
}
