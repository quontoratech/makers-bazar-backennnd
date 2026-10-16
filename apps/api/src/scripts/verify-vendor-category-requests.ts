import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource } from 'typeorm';

import { AddVendorCategoryRequests1787674800000 } from '../migrations/1787674800000-add-vendor-category-requests';
import { AddVendorCategoryRequestCoreTypes1787678400000 } from '../migrations/1787678400000-add-vendor-category-request-core-types';
import { AddCategoryRequestReadinessData1788510000000 } from '../migrations/1788510000000-add-category-request-readiness-data';
import {
    categories,
    sanitizeCategoryAccessAnswers,
    validateCategoryAccessAnswers,
} from '@marketplace/contracts/onboarding';
import {
    canonicalVendorCategory,
    vendorAllowedListingTypes,
} from '../plugins/marketplace/modules/catalog/vendor-category-access';

async function main() {
    const physical = vendorAllowedListingTypes(['Physical products']);
    assert(physical?.has('PHYSICAL_PRODUCT'));
    assert(!physical?.has('ARTISAN_PRODUCT'));
    assert(!physical?.has('FOOD_PRODUCT'));
    const expanded = vendorAllowedListingTypes([
        'Physical products',
        canonicalVendorCategory('ARTISAN_PRODUCT'),
        canonicalVendorCategory('FOOD_PRODUCT'),
    ]);
    assert(expanded?.has('PHYSICAL_PRODUCT'));
    assert(expanded?.has('ARTISAN_PRODUCT'));
    assert(expanded?.has('FOOD_PRODUCT'));
    assert.equal(canonicalVendorCategory('DIGITAL_PRODUCT'), 'Digital products');
    assert(categories.some(category => category.listingType === 'PHYSICAL_PRODUCT'));
    const readiness = sanitizeCategoryAccessAnswers({
        physical_brandName: 'Local Goods',
        physical_productCategory: 'Home decor',
        physical_productTypes: 'Decorative products',
        physical_sourcingModel: 'Own manufacturing',
        physical_manufacturingLocation: 'Karachi',
        physical_qualityControl: 'Every product is checked before packing.',
        physical_warrantyReturns: 'Returns are inspected and resolved within seven days.',
        businessType: 'Individual',
        idNumber: '42101-1234567-1',
        idFront: 'front-file',
        idBack: 'back-file',
    }, ['physical']);
    assert.deepEqual(validateCategoryAccessAnswers(readiness), {});

    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-vendor-category-requests-'));
    const database = path.join(directory, 'category-requests.sqlite');
    const dataSource = new DataSource({ type: 'better-sqlite3', database });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    const migration = new AddVendorCategoryRequests1787674800000();
    const coreTypesMigration = new AddVendorCategoryRequestCoreTypes1787678400000();
    const readinessMigration = new AddCategoryRequestReadinessData1788510000000();
    try {
        await migration.up(queryRunner);
        await coreTypesMigration.up(queryRunner);
        await readinessMigration.up(queryRunner);
        assert(await queryRunner.hasTable('marketplace_vendor_category_request'));
        assert(await queryRunner.hasTable('marketplace_vendor_category_request_document'));
        const requestTable = await queryRunner.getTable('marketplace_vendor_category_request');
        const documentTable = await queryRunner.getTable('marketplace_vendor_category_request_document');
        assert(requestTable?.indices.some(index => index.name === 'IDX_vendor_category_request_code' && index.isUnique));
        assert(requestTable?.indices.some(index => index.name === 'IDX_vendor_category_request_status'));
        assert(requestTable?.findColumnByName('listingTypes'));
        assert(documentTable?.indices.some(index => index.name === 'IDX_vendor_category_document_request'));
        assert(requestTable?.findColumnByName('categoryData'));
        assert(requestTable?.findColumnByName('kycData'));
        assert(documentTable?.findColumnByName('fieldKey'));

        await readinessMigration.down(queryRunner);
        assert(!(await queryRunner.getTable('marketplace_vendor_category_request'))?.findColumnByName('categoryData'));
        await coreTypesMigration.down(queryRunner);
        assert(!(await queryRunner.getTable('marketplace_vendor_category_request'))?.findColumnByName('listingTypes'));
        await migration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_vendor_category_request_document'));
        assert(!await queryRunner.hasTable('marketplace_vendor_category_request'));
        console.log(JSON.stringify({ permissionCases: 7, onboardingForms: categories.length, tables: 2, indexes: 3, readinessColumns: 3, roundTrip: 'PASS' }, null, 2));
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
