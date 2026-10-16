import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource, Table } from 'typeorm';

import { AddDynamicMarketplaceCatalog1787660400000 } from '../migrations/1787660400000-add-dynamic-marketplace-catalog';
import { AddCatalogDeliveryAndCapacity1787664000000 } from '../migrations/1787664000000-add-catalog-delivery-and-capacity';
import { AddWorkshopSubscriptions1787970000000 } from '../migrations/1787970000000-add-workshop-subscriptions';
import { AddSubscriptionClassLifecycle1788055200000 } from '../migrations/1788055200000-add-subscription-class-lifecycle';
import { AddWorkshopDayPassPrice1788141600000 } from '../migrations/1788141600000-add-workshop-day-pass-price';
import { AddVendorOnboarding1788350000000 } from '../migrations/1788350000000-add-vendor-onboarding';

async function main() {
    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-catalog-migrations-'));
    const database = path.join(directory, 'catalog.sqlite');
    const dataSource = new DataSource({ type: 'better-sqlite3', database });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    try {
        await new AddDynamicMarketplaceCatalog1787660400000().up(queryRunner);
        await queryRunner.createTable(
            new Table({
                name: 'marketplace_booking',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                    { name: 'createdAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
                    { name: 'updatedAt', type: 'datetime', default: 'CURRENT_TIMESTAMP' },
                ],
            }),
        );
        await queryRunner.createTable(
            new Table({
                name: 'order_line',
                columns: [
                    {
                        name: 'id',
                        type: 'integer',
                        isPrimary: true,
                        isGenerated: true,
                        generationStrategy: 'increment',
                    },
                ],
            }),
        );
        await new AddCatalogDeliveryAndCapacity1787664000000().up(queryRunner);
        await new AddWorkshopSubscriptions1787970000000().up(queryRunner);
        await new AddSubscriptionClassLifecycle1788055200000().up(queryRunner);
        await new AddWorkshopDayPassPrice1788141600000().up(queryRunner);
        await new AddVendorOnboarding1788350000000().up(queryRunner);
        const onboarding = await queryRunner.getTable('vendor_onboarding');
        assert(onboarding?.uniques.some(index => index.columnNames.includes('ownerUserId')));
        assert(await queryRunner.hasColumn('vendor_onboarding', 'version'));
        assert(await queryRunner.hasColumn('vendor_onboarding_file', 'storageKey'));
        assert(await queryRunner.hasColumn('vendor_onboarding_file', 'checksum'));
        await new AddVendorOnboarding1788350000000().down(queryRunner);
        assert(!(await queryRunner.hasTable('vendor_onboarding')));
        assert(!(await queryRunner.hasTable('vendor_onboarding_file')));

        const expectedTables = [
            'marketplace_form_template',
            'marketplace_category',
            'marketplace_category_field',
            'marketplace_listing_category',
            'marketplace_listing_field_value',
            'marketplace_service_package',
            'marketplace_availability_session',
            'marketplace_event_ticket_type',
            'marketplace_event_schedule_item',
            'marketplace_digital_file',
            'marketplace_digital_download_grant',
        ];
        for (const table of expectedTables)
            assert(await queryRunner.hasTable(table), `Migration did not create ${table}`);
        assert(await queryRunner.hasColumn('marketplace_booking', 'availabilitySessionId'));
        assert(await queryRunner.hasColumn('marketplace_booking', 'eventTicketTypeId'));
        assert(await queryRunner.hasColumn('marketplace_booking', 'billingModel'));
        assert(await queryRunner.hasColumn('marketplace_booking', 'paidAt'));
        assert(await queryRunner.hasColumn('marketplace_booking', 'renewalReminderSentAt'));
        assert(await queryRunner.hasColumn('order_line', 'customFieldsMarketplacebookingid'));
        assert(await queryRunner.hasColumn('marketplace_availability_session', 'earlyBirdEndsAt'));
        assert(await queryRunner.hasColumn('marketplace_availability_session', 'oneDayPrice'));
        assert(await queryRunner.hasColumn('marketplace_availability_session', 'scheduleType'));
        assert(await queryRunner.hasColumn('marketplace_booking', 'paymentStatus'));
        assert(await queryRunner.hasColumn('marketplace_booking', 'renewalToken'));
        assert(await queryRunner.hasColumn('order_line', 'customFieldsMarketplacerenewalbookingid'));
        const grant = await queryRunner.getTable('marketplace_digital_download_grant');
        assert(grant?.indices.some(index => index.name === 'IDX_marketplace_download_scope'));

        await new AddWorkshopDayPassPrice1788141600000().down(queryRunner);
        assert(!(await queryRunner.hasColumn('marketplace_availability_session', 'oneDayPrice')));
        await new AddSubscriptionClassLifecycle1788055200000().down(queryRunner);
        assert(!(await queryRunner.hasColumn('marketplace_booking', 'paymentStatus')));
        assert(!(await queryRunner.hasColumn('order_line', 'customFieldsMarketplacerenewalbookingid')));
        await new AddWorkshopSubscriptions1787970000000().down(queryRunner);
        assert(!(await queryRunner.hasColumn('marketplace_booking', 'billingModel')));
        assert(!(await queryRunner.hasColumn('marketplace_booking', 'paidAt')));
        assert(!(await queryRunner.hasColumn('marketplace_booking', 'renewalReminderSentAt')));
        assert(!(await queryRunner.hasColumn('order_line', 'customFieldsMarketplacebookingid')));
        await new AddCatalogDeliveryAndCapacity1787664000000().down(queryRunner);
        assert(!(await queryRunner.hasTable('marketplace_digital_download_grant')));
        assert(!(await queryRunner.hasColumn('marketplace_booking', 'availabilitySessionId')));
        assert(!(await queryRunner.hasColumn('marketplace_booking', 'eventTicketTypeId')));
        await queryRunner.dropTable('marketplace_booking');
        await queryRunner.dropTable('order_line');
        await new AddDynamicMarketplaceCatalog1787660400000().down(queryRunner);
        for (const table of expectedTables.slice(0, -1))
            assert(!(await queryRunner.hasTable(table)), `Migration did not remove ${table}`);

        console.log(
            JSON.stringify(
                {
                    createdTables: expectedTables.length,
                    subscriptionLifecycle: 'PASS',
                    vendorOnboarding: 'PASS',
                    roundTrip: 'PASS',
                },
                null,
                2,
            ),
        );
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
