import { MigrationInterface, QueryRunner, TableColumn, TableIndex } from 'typeorm';

export class AddSubscriptionClassLifecycle1788055200000 implements MigrationInterface {
    async up(queryRunner: QueryRunner): Promise<void> {
        const timestampType = queryRunner.connection.options.type === 'postgres' ? 'timestamp' : 'datetime';
        const jsonType = queryRunner.connection.options.type === 'postgres' ? 'text' : 'text';

        if (await queryRunner.hasTable('marketplace_availability_session')) {
            const columns: TableColumn[] = [
                new TableColumn({ name: 'name', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'scheduleType', type: 'varchar', default: "'ONE_TIME'" }),
                new TableColumn({ name: 'daysOfWeek', type: jsonType, isNullable: true }),
                new TableColumn({ name: 'startTime', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'endTime', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'price', type: 'integer', isNullable: true }),
                new TableColumn({ name: 'earlyBirdPrice', type: 'integer', isNullable: true }),
                new TableColumn({ name: 'earlyBirdEndsAt', type: timestampType, isNullable: true }),
                new TableColumn({ name: 'gracePeriodDays', type: 'integer', default: '5' }),
                new TableColumn({ name: 'isActive', type: 'boolean', default: '1' }),
            ];
            for (const column of columns) {
                if (!await queryRunner.hasColumn('marketplace_availability_session', column.name)) {
                    await queryRunner.addColumn('marketplace_availability_session', column);
                }
            }
            const sessionTable = await queryRunner.getTable('marketplace_availability_session');
            if (sessionTable && !sessionTable.indices.some(index => index.name === 'IDX_marketplace_session_schedule_type')) {
                await queryRunner.createIndex('marketplace_availability_session', new TableIndex({
                    name: 'IDX_marketplace_session_schedule_type', columnNames: ['scheduleType'],
                }));
            }
        }

        if (await queryRunner.hasTable('marketplace_booking')) {
            const columns: TableColumn[] = [
                new TableColumn({ name: 'paymentStatus', type: 'varchar', default: "'UNPAID'" }),
                new TableColumn({ name: 'agreedPrice', type: 'integer', isNullable: true }),
                new TableColumn({ name: 'subscriptionClassName', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'renewalToken', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'graceEndsAt', type: timestampType, isNullable: true }),
                new TableColumn({ name: 'lastRenewalOrderId', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'cancellationRequestedAt', type: timestampType, isNullable: true }),
                new TableColumn({ name: 'cancelledAt', type: timestampType, isNullable: true }),
                new TableColumn({ name: 'customerName', type: 'varchar', isNullable: true }),
                new TableColumn({ name: 'customerEmail', type: 'varchar', isNullable: true }),
            ];
            for (const column of columns) {
                if (!await queryRunner.hasColumn('marketplace_booking', column.name)) {
                    await queryRunner.addColumn('marketplace_booking', column);
                }
            }
            const bookingTable = await queryRunner.getTable('marketplace_booking');
            if (bookingTable && !bookingTable.indices.some(index => index.name === 'IDX_marketplace_booking_payment_status')) {
                await queryRunner.createIndex('marketplace_booking', new TableIndex({
                    name: 'IDX_marketplace_booking_payment_status', columnNames: ['paymentStatus'],
                }));
            }
            if (bookingTable && !bookingTable.indices.some(index => index.name === 'IDX_marketplace_booking_renewal_token')) {
                await queryRunner.createIndex('marketplace_booking', new TableIndex({
                    name: 'IDX_marketplace_booking_renewal_token', columnNames: ['renewalToken'], isUnique: true,
                }));
            }
        }

        if (await queryRunner.hasTable('order_line') && !await queryRunner.hasColumn('order_line', 'customFieldsMarketplacerenewalbookingid')) {
            await queryRunner.addColumn('order_line', new TableColumn({
                name: 'customFieldsMarketplacerenewalbookingid', type: 'varchar', isNullable: true,
            }));
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('order_line') && await queryRunner.hasColumn('order_line', 'customFieldsMarketplacerenewalbookingid')) {
            await queryRunner.dropColumn('order_line', 'customFieldsMarketplacerenewalbookingid');
        }
        if (await queryRunner.hasTable('marketplace_booking')) {
            for (const column of ['customerEmail', 'customerName', 'cancelledAt', 'cancellationRequestedAt', 'lastRenewalOrderId', 'graceEndsAt', 'renewalToken', 'subscriptionClassName', 'agreedPrice', 'paymentStatus']) {
                if (await queryRunner.hasColumn('marketplace_booking', column)) await queryRunner.dropColumn('marketplace_booking', column);
            }
        }
        if (await queryRunner.hasTable('marketplace_availability_session')) {
            for (const column of ['isActive', 'gracePeriodDays', 'earlyBirdEndsAt', 'earlyBirdPrice', 'price', 'endTime', 'startTime', 'daysOfWeek', 'scheduleType', 'name']) {
                if (await queryRunner.hasColumn('marketplace_availability_session', column)) await queryRunner.dropColumn('marketplace_availability_session', column);
            }
        }
    }
}
