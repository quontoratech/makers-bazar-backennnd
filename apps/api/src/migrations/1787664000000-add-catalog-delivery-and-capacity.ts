import { MigrationInterface, QueryRunner, Table, TableColumn, TableIndex } from 'typeorm';

export class AddCatalogDeliveryAndCapacity1787664000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        if (!await queryRunner.hasTable('marketplace_digital_download_grant')) {
            await queryRunner.createTable(new Table({
                name: 'marketplace_digital_download_grant',
                columns: [
                    { name: 'id', type: 'integer', isPrimary: true, isGenerated: true, generationStrategy: 'increment' },
                    { name: 'createdAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: timestampType, default: 'CURRENT_TIMESTAMP' },
                    { name: 'fileId', type: 'varchar' },
                    { name: 'customerId', type: 'varchar' },
                    { name: 'orderId', type: 'varchar' },
                    { name: 'tokenHash', type: 'varchar', isUnique: true },
                    { name: 'expiresAt', type: timestampType },
                    { name: 'consumedAt', type: timestampType, isNullable: true },
                ],
            }));
            await queryRunner.createIndices('marketplace_digital_download_grant', [
                new TableIndex({ name: 'IDX_marketplace_download_file', columnNames: ['fileId'] }),
                new TableIndex({ name: 'IDX_marketplace_download_customer', columnNames: ['customerId'] }),
                new TableIndex({ name: 'IDX_marketplace_download_order', columnNames: ['orderId'] }),
                new TableIndex({ name: 'IDX_marketplace_download_expiry', columnNames: ['expiresAt'] }),
                new TableIndex({ name: 'IDX_marketplace_download_scope', columnNames: ['fileId', 'customerId', 'orderId'] }),
            ]);
        }

        if (await queryRunner.hasTable('marketplace_booking')) {
            if (!await queryRunner.hasColumn('marketplace_booking', 'availabilitySessionId')) {
                await queryRunner.addColumn('marketplace_booking', new TableColumn({
                    name: 'availabilitySessionId', type: 'varchar', isNullable: true,
                }));
            }
            if (!await queryRunner.hasColumn('marketplace_booking', 'eventTicketTypeId')) {
                await queryRunner.addColumn('marketplace_booking', new TableColumn({
                    name: 'eventTicketTypeId', type: 'varchar', isNullable: true,
                }));
            }
            const bookingTable = await queryRunner.getTable('marketplace_booking');
            if (bookingTable && !bookingTable.indices.some(index => index.name === 'IDX_marketplace_booking_session')) {
                await queryRunner.createIndex('marketplace_booking', new TableIndex({
                    name: 'IDX_marketplace_booking_session', columnNames: ['availabilitySessionId'],
                }));
            }
            if (bookingTable && !bookingTable.indices.some(index => index.name === 'IDX_marketplace_booking_ticket')) {
                await queryRunner.createIndex('marketplace_booking', new TableIndex({
                    name: 'IDX_marketplace_booking_ticket', columnNames: ['eventTicketTypeId'],
                }));
            }
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('marketplace_booking')) {
            if (await queryRunner.hasColumn('marketplace_booking', 'eventTicketTypeId')) {
                await queryRunner.dropColumn('marketplace_booking', 'eventTicketTypeId');
            }
            if (await queryRunner.hasColumn('marketplace_booking', 'availabilitySessionId')) {
                await queryRunner.dropColumn('marketplace_booking', 'availabilitySessionId');
            }
        }
        if (await queryRunner.hasTable('marketplace_digital_download_grant')) {
            await queryRunner.dropTable('marketplace_digital_download_grant', true);
        }
    }
}
