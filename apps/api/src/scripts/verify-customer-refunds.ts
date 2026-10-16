import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource } from 'typeorm';

import { AddCustomerRefunds1787689200000 } from '../migrations/1787689200000-add-customer-refunds';
import { AddPartialCustomerRefunds1789003600000 } from '../migrations/1789003600000-add-partial-customer-refunds';
import { calculateCustomerRefundAmounts } from '../plugins/marketplace/modules/finance/customer-refund-policy';

const cancelled = calculateCustomerRefundAmounts({
    orderStatus: 'CANCELLED',
    productAmount: 200_000,
    deliveryAmount: 45_000,
    marketplaceFundingAmount: 200,
});
assert.deepEqual(cancelled, {
    refundScope: 'FULL_WITH_DELIVERY',
    productAmount: 200_000,
    customerPaidProductAmount: 199_800,
    deliveryAmount: 45_000,
    marketplaceFundingAmount: 200,
    cashAmount: 244_800,
    grossAmount: 245_000,
});

const deliveredRefund = calculateCustomerRefundAmounts({
    orderStatus: 'REFUNDED',
    productAmount: 200_000,
    deliveryAmount: 45_000,
    marketplaceFundingAmount: 200,
});
assert.equal(deliveredRefund.refundScope, 'PRODUCT_ONLY');
assert.equal(deliveredRefund.deliveryAmount, 0);
assert.equal(deliveredRefund.cashAmount, 199_800);
assert.equal(deliveredRefund.grossAmount, 200_000);
assert.throws(() => calculateCustomerRefundAmounts({
    orderStatus: 'REJECTED',
    productAmount: -1,
    deliveryAmount: 0,
    marketplaceFundingAmount: 0,
}), /Product amount/);

async function verifyMigration() {
    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-customer-refunds-'));
    const dataSource = new DataSource({ type: 'better-sqlite3', database: path.join(directory, 'refunds.sqlite') });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    try {
        const migration = new AddCustomerRefunds1787689200000();
        await migration.up(queryRunner);
        assert(await queryRunner.hasTable('marketplace_customer_refund'));
        const table = await queryRunner.getTable('marketplace_customer_refund');
        assert(table?.indices.some(index => index.name === 'IDX_customer_refund_seller_order' && index.isUnique));
        assert(table?.findColumnByName('cashAmount'));
        assert(table?.findColumnByName('transactionReference'));
        const partialMigration = new AddPartialCustomerRefunds1789003600000();
        await partialMigration.up(queryRunner);
        const upgraded = await queryRunner.getTable('marketplace_customer_refund');
        assert(upgraded?.findColumnByName('supportCaseId'));
        assert(upgraded?.findColumnByName('returnItems'));
        assert(upgraded?.indices.some(index => index.name === 'IDX_customer_refund_seller_order' && !index.isUnique));
        assert(upgraded?.indices.some(index => index.name === 'IDX_customer_refund_support_case' && index.isUnique));
        await partialMigration.down(queryRunner);
        await migration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_customer_refund'));
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

void verifyMigration()
    .then(() => console.log('Customer refund policy and migration checks passed.'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
