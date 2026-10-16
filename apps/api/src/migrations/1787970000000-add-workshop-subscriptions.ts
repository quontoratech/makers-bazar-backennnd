import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddWorkshopSubscriptions1787970000000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        if (await queryRunner.hasTable('marketplace_booking')) {
            if (!await queryRunner.hasColumn('marketplace_booking', 'billingModel')) {
                await queryRunner.addColumn('marketplace_booking', new TableColumn({
                    name: 'billingModel', type: 'varchar', default: "'ONE_TIME'",
                }));
            }
            if (!await queryRunner.hasColumn('marketplace_booking', 'paidAt')) {
                await queryRunner.addColumn('marketplace_booking', new TableColumn({
                    name: 'paidAt', type: timestampType, isNullable: true,
                }));
            }
            if (!await queryRunner.hasColumn('marketplace_booking', 'renewalReminderSentAt')) {
                await queryRunner.addColumn('marketplace_booking', new TableColumn({
                    name: 'renewalReminderSentAt', type: timestampType, isNullable: true,
                }));
            }
            const bookingTable = await queryRunner.getTable('marketplace_booking');
            if (bookingTable && !bookingTable.indices.some(index => index.name === 'IDX_marketplace_booking_billing_model')) {
                await queryRunner.createIndex('marketplace_booking', new TableIndex({
                    name: 'IDX_marketplace_booking_billing_model', columnNames: ['billingModel'],
                }));
            }
        }
        if (!await queryRunner.hasColumn('order_line', 'customFieldsMarketplacebookingid')) {
            await queryRunner.addColumn('order_line', new TableColumn({
                name: 'customFieldsMarketplacebookingid', type: 'varchar', isNullable: true,
            }));
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('order_line', 'customFieldsMarketplacebookingid')) {
            await queryRunner.dropColumn('order_line', 'customFieldsMarketplacebookingid');
        }
        if (await queryRunner.hasTable('marketplace_booking')) {
            for (const column of ['renewalReminderSentAt', 'paidAt', 'billingModel']) {
                if (await queryRunner.hasColumn('marketplace_booking', column)) {
                    await queryRunner.dropColumn('marketplace_booking', column);
                }
            }
        }
    }
}
