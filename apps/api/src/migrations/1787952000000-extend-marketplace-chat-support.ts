import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class ExtendMarketplaceChatSupport1787952000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        await queryRunner.addColumns('marketplace_chat_conversation', [
            new TableColumn({ name: 'conversationType', type: 'varchar', default: "'ORDER'" }),
            new TableColumn({ name: 'sourceId', type: 'varchar', isNullable: true }),
            new TableColumn({ name: 'sourceCode', type: 'varchar', isNullable: true }),
            new TableColumn({ name: 'closeAt', type: timestampType, isNullable: true }),
            new TableColumn({ name: 'closedAt', type: timestampType, isNullable: true }),
            new TableColumn({ name: 'closedReason', type: 'varchar', isNullable: true }),
        ]);
        await queryRunner.createIndices('marketplace_chat_conversation', [
            new TableIndex({ name: 'IDX_chat_conversation_type', columnNames: ['conversationType'] }),
            new TableIndex({ name: 'IDX_chat_conversation_source', columnNames: ['sourceId'] }),
        ]);

        await queryRunner.createTable(new Table({
            name: 'marketplace_chat_attachment',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                { name: 'conversationId', type: 'varchar' },
                { name: 'messageId', type: 'varchar', isNullable: true },
                { name: 'uploadedByUserId', type: 'varchar' },
                { name: 'name', type: 'varchar' },
                { name: 'mimeType', type: 'varchar' },
                { name: 'size', type: 'integer' },
                { name: 'storageKey', type: 'varchar' },
                { name: 'checksum', type: 'varchar' },
            ],
        }));
        await queryRunner.createIndices('marketplace_chat_attachment', [
            new TableIndex({ name: 'IDX_chat_attachment_conversation', columnNames: ['conversationId'] }),
            new TableIndex({ name: 'IDX_chat_attachment_message', columnNames: ['messageId'] }),
            new TableIndex({ name: 'IDX_chat_attachment_uploader', columnNames: ['uploadedByUserId'] }),
            new TableIndex({ name: 'IDX_chat_attachment_storage', columnNames: ['storageKey'], isUnique: true }),
            new TableIndex({ name: 'IDX_chat_attachment_message_timeline', columnNames: ['conversationId', 'messageId'] }),
        ]);

        await queryRunner.addColumn('marketplace_report', new TableColumn({
            name: 'supportConversationId', type: 'varchar', isNullable: true,
        }));
        await queryRunner.addColumn('marketplace_vendor_appeal', new TableColumn({
            name: 'supportConversationId', type: 'varchar', isNullable: true,
        }));
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn('marketplace_vendor_appeal', 'supportConversationId');
        await queryRunner.dropColumn('marketplace_report', 'supportConversationId');
        await queryRunner.dropTable('marketplace_chat_attachment', true);
        await queryRunner.dropColumns('marketplace_chat_conversation', [
            'closedReason', 'closedAt', 'closeAt', 'sourceCode', 'sourceId', 'conversationType',
        ]);
    }
}
