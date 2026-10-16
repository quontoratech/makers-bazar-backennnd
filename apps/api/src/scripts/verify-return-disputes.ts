import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { OrderType } from '@vendure/common/lib/generated-types';
import { Order, Permission, RequestContext, TransactionalConnection, VendureEntity } from '@vendure/core';
import { DataSource, PrimaryGeneratedColumn, Table } from 'typeorm';

import { AddMarketplaceReturnCases1788760000000 } from '../migrations/1788760000000-add-marketplace-return-cases';
import { AddMarketplaceReturnItems1789000000000 } from '../migrations/1789000000000-add-marketplace-return-items';
import { configuredReturnWindowDays, evaluateReturnWindow, returnSelectionCoversWholeOrder } from '../plugins/marketplace/modules/support/return-policy';
import { SupportCase } from '../plugins/marketplace/modules/support/entities/support-case.entity';
import { SupportService } from '../plugins/marketplace/modules/support/services/support.service';
import { MarketplaceOrderService } from '../plugins/marketplace/modules/order/services/marketplace-order.service';
import { VendorProfile } from '../plugins/marketplace/modules/vendor/entities/vendor-profile.entity';
import { MarketplaceCustomerRefund } from '../plugins/marketplace/modules/finance/entities/marketplace-customer-refund.entity';
import { MarketplaceCustomerRefundService } from '../plugins/marketplace/modules/finance/services/marketplace-customer-refund.service';
import { MarketplaceCommissionRuleService } from '../plugins/marketplace/modules/finance/services/commission-rule.service';
import { MarketplacePurchaseRewardService } from '../plugins/marketplace/modules/review/services/marketplace-purchase-reward.service';
import { MarketplaceRewardRedemptionService } from '../plugins/marketplace/modules/review/services/marketplace-reward-redemption.service';
import { MarketplacePayoutSettings } from '../plugins/marketplace/modules/finance/entities/marketplace-payout-settings.entity';
import { PayoutLedgerEntry } from '../plugins/marketplace/modules/finance/entities/payout-ledger-entry.entity';
import { proportionalReturnShare, returnedShare } from '../plugins/marketplace/modules/finance/partial-return-allocation';
import { MarketplaceRewardRedemption } from '../plugins/marketplace/modules/review/entities/marketplace-reward-redemption.entity';
import { MarketplaceCouponRedemption } from '../plugins/marketplace/modules/promotion/entities/marketplace-coupon-redemption.entity';

function verifyDeadlinePolicy() {
    assert.deepEqual([returnedShare(100, 3, 0, 1), returnedShare(100, 3, 1, 1),
        returnedShare(100, 3, 2, 1)], [33, 33, 34]);
    assert.deepEqual([proportionalReturnShare(100, 100, 0, 99),
        proportionalReturnShare(100, 100, 99, 1)], [99, 1],
    'Combined coupon and coin funding must not refund cash that the customer never paid');
    assert.equal(returnSelectionCoversWholeOrder([{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }], undefined), true);
    assert.equal(returnSelectionCoversWholeOrder([{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }], [
        { orderLineId: 'a', quantity: 2 }, { orderLineId: 'b', quantity: 1 },
    ]), true);
    assert.equal(returnSelectionCoversWholeOrder([{ id: 'a', quantity: 2 }, { id: 'b', quantity: 1 }], [
        { orderLineId: 'a', quantity: 1 }, { orderLineId: 'b', quantity: 1 },
    ]), false);
    const originalWindow = process.env.MARKETPLACE_RETURN_WINDOW_DAYS;
    try {
        process.env.MARKETPLACE_RETURN_WINDOW_DAYS = '7';
        assert.equal(configuredReturnWindowDays(), 7);
        process.env.MARKETPLACE_RETURN_WINDOW_DAYS = '14';
        assert.equal(configuredReturnWindowDays(), 14);
        process.env.MARKETPLACE_RETURN_WINDOW_DAYS = 'invalid';
        assert.equal(configuredReturnWindowDays(), 14);
    } finally {
        if (originalWindow === undefined) delete process.env.MARKETPLACE_RETURN_WINDOW_DAYS;
        else process.env.MARKETPLACE_RETURN_WINDOW_DAYS = originalWindow;
    }
    const deliveredAt = new Date('2026-01-01T10:00:00.000Z');
    for (const days of [7, 14] as const) {
        const deadline = new Date(deliveredAt.getTime() + days * 24 * 60 * 60 * 1000);
        const oneMillisecondBefore = new Date(deadline.getTime() - 1);
        const oneMillisecondAfter = new Date(deadline.getTime() + 1);

        const before = evaluateReturnWindow(deliveredAt, oneMillisecondBefore, days);
        const onDeadline = evaluateReturnWindow(deliveredAt, deadline, days);
        const after = evaluateReturnWindow(deliveredAt, oneMillisecondAfter, days);
        assert.equal(before.eligible, true, `${days}-day appeal before deadline`);
        assert.equal(onDeadline.eligible, true, `${days}-day appeal on deadline`);
        assert.equal(after.eligible, false, `${days}-day appeal after deadline`);
        assert.equal(before.deadlineAt?.getTime(), deadline.getTime());
        assert.equal(onDeadline.deadlineAt?.getTime(), deadline.getTime());
        assert.equal(after.deadlineAt?.getTime(), deadline.getTime());
    }
    const missingDelivery = evaluateReturnWindow(undefined, new Date(), 14);
    assert.equal(missingDelivery.eligible, false);
    assert.equal(missingDelivery.deadlineAt, undefined);
}

async function verifyMigration() {
    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-return-disputes-'));
    const dataSource = new DataSource({ type: 'better-sqlite3', database: path.join(directory, 'returns.sqlite') });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    try {
        await queryRunner.createTable(new Table({
            name: 'support_case',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'category', type: 'varchar' },
                { name: 'status', type: 'varchar' },
            ],
        }));
        await queryRunner.createTable(new Table({
            name: 'order',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }));
        const migration = new AddMarketplaceReturnCases1788760000000();
        await migration.up(queryRunner);
        const table = await queryRunner.getTable('support_case');
        for (const name of [
            'sellerOrderId', 'returnWindowDays', 'returnDeadlineAt', 'returnRequired',
            'refundId', 'refundStatus', 'internalMessages',
        ]) {
            assert(table?.findColumnByName(name), `Missing ${name} column`);
        }
        assert(table?.indices.some(index =>
            index.name === 'IDX_support_case_seller_order' && index.isUnique && index.columnNames.includes('sellerOrderId')));
        assert((await queryRunner.getTable('order'))?.findColumnByName('customFieldsMarketplacedeliveredat'));
        await queryRunner.query('INSERT INTO "support_case" ("id", "category", "status", "sellerOrderId") VALUES (1, ?, ?, ?)', [
            'RETURN_DISPUTE', 'OPEN', 'seller-order-1',
        ]);
        await assert.rejects(
            queryRunner.query('INSERT INTO "support_case" ("id", "category", "status", "sellerOrderId") VALUES (2, ?, ?, ?)', [
                'RETURN_DISPUTE', 'REFUNDED', 'seller-order-1',
            ]),
            /UNIQUE constraint failed/,
            'A seller order must not have duplicate return cases',
        );
        const selectionMigration = new AddMarketplaceReturnItems1789000000000();
        await selectionMigration.up(queryRunner);
        const selectedTable = await queryRunner.getTable('support_case');
        assert(selectedTable?.findColumnByName('returnItems'));
        assert(selectedTable?.findColumnByName('sellerOrderStatusBeforeReturn'));
        assert(selectedTable?.indices.some(index => index.name === 'IDX_support_case_seller_order' && !index.isUnique));
        assert(selectedTable?.indices.some(index => index.name === 'IDX_support_case_active_return' && index.isUnique));
        await assert.rejects(queryRunner.query(
            'INSERT INTO "support_case" ("id", "category", "status", "sellerOrderId") VALUES (2, ?, ?, ?)',
            ['RETURN_DISPUTE', 'OPEN', 'seller-order-1'],
        ), /UNIQUE constraint failed/, 'Two active appeals for one seller order must not race');
        await queryRunner.query('UPDATE "support_case" SET "status" = ? WHERE "id" = 1', ['REFUNDED']);
        await queryRunner.query('INSERT INTO "support_case" ("id", "category", "status", "sellerOrderId", "returnItems") VALUES (2, ?, ?, ?, ?)', [
            'RETURN_DISPUTE', 'OPEN', 'seller-order-1', JSON.stringify([{ orderLineId: 'line-a', quantity: 1 }]),
        ]);
        await queryRunner.query('DELETE FROM "support_case" WHERE "id" = 2');
        await selectionMigration.down(queryRunner);
        await migration.down(queryRunner);
        const restored = await queryRunner.getTable('support_case');
        assert(restored?.findColumnByName('id'));
        assert(!restored?.findColumnByName('sellerOrderId'));
        assert(!restored?.findColumnByName('internalMessages'));
        assert(!restored?.findColumnByName('returnItems'));
        assert(!(await queryRunner.getTable('order'))?.findColumnByName('customFieldsMarketplacedeliveredat'));
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

async function verifySupportCaseStorage() {
    // Vendure normally applies the id decorator during its bootstrap.
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    const source = await new DataSource({
        type: 'better-sqlite3', database: ':memory:', entities: [SupportCase], synchronize: true,
    }).initialize();
    try {
        const cases = source.getRepository(SupportCase);
        const item = await cases.save(new SupportCase({
            code: 'CASE-RETURN-QA', openedByUserId: 'customer-1',
            sellerOrderId: 'seller-order-1', orderId: 'aggregate-order-1',
            category: 'RETURN', subject: 'Wrong item', priority: 'NORMAL', status: 'OPEN',
            returnWindowDays: 14, returnDeadlineAt: new Date('2026-01-15T10:00:00.000Z'),
            returnRequired: true, sellerOrderStatusBeforeReturn: 'DELIVERED',
            returnItems: [{ orderLineId: 'line-1', quantity: 2, productName: 'QA item' }],
            messages: [], internalMessages: [],
        }));
        const reloaded = await cases.findOneByOrFail({ id: item.id });
        assert.equal(reloaded.sellerOrderId, 'seller-order-1');
        assert.equal(reloaded.returnDeadlineAt?.toISOString(), '2026-01-15T10:00:00.000Z');
        assert.deepEqual(reloaded.internalMessages, []);
        assert.deepEqual(reloaded.returnItems, [{ orderLineId: 'line-1', quantity: 2, productName: 'QA item' }]);
        assert.equal(reloaded.sellerOrderStatusBeforeReturn, 'DELIVERED');
    } finally {
        await source.destroy();
    }
}

async function verifyReturnLifecycle() {
    const source = await new DataSource({
        type: 'better-sqlite3', database: ':memory:', entities: [SupportCase], synchronize: true,
    }).initialize();
    const buyer = { id: 'buyer-1', firstName: 'QA', lastName: 'Customer', emailAddress: 'return-qa@example.test',
        user: { id: 'buyer-user-1' } };
    const vendor = { id: 'vendor-1', channelId: 'channel-1', ownerUserId: 'vendor-user-1', status: 'APPROVED',
        shopName: 'QA vendor' };
    const unrelatedVendor = { id: 'vendor-2', channelId: 'channel-2', ownerUserId: 'vendor-user-2', status: 'APPROVED',
        shopName: 'Other vendor' };
    const order = {
        id: 'seller-1', code: 'SELLER-RETURN-1', type: OrderType.Seller, active: false,
        customer: buyer, channels: [{ id: vendor.channelId }],
        lines: [{ id: 'physical-line-1', quantity: 2,
            productVariant: { name: 'Blue', sku: 'BLUE-1', product: { name: 'Blue scarf', customFields: { marketplaceType: 'PHYSICAL' } } } }],
        customFields: { marketplaceStatus: 'DELIVERED', marketplaceDeliveredAt: new Date(Date.now() - 86_400_000) },
    } as unknown as Order;
    const orders = new Map([[String(order.id), order]]);
    const statusHistory: string[] = [];
    const orderService = {
        async requestCustomerReturn(_ctx: RequestContext, id: string) {
            const target = orders.get(id);
            assert(target, 'Return must target an existing seller order');
            statusHistory.push('RETURN_REQUESTED');
            (target.customFields as Record<string, unknown>).marketplaceStatus = 'RETURN_REQUESTED';
        },
        async transitionReturnStatus(_ctx: RequestContext, id: string, status: string) {
            const target = orders.get(id);
            assert(target, 'Return transition must target an existing seller order');
            statusHistory.push(status);
            (target.customFields as Record<string, unknown>).marketplaceStatus = status;
        },
        async restoreAfterReturn(_ctx: RequestContext, id: string, status: string) {
            const target = orders.get(id);
            assert(target, 'Return restore must target an existing seller order');
            statusHistory.push(status);
            (target.customFields as Record<string, unknown>).marketplaceStatus = status;
        },
    } as unknown as MarketplaceOrderService;
    const connection = {
        withTransaction: async (ctx: RequestContext, work: (transactionCtx: RequestContext) => Promise<unknown>) => work(ctx),
        getRepository(_ctx: RequestContext, entity: unknown) {
            if (entity === MarketplacePayoutSettings) return {
                metadata: { findColumnWithPropertyName: () => ({ databaseName: 'holdingPeriodDays' }) },
                manager: { connection: { driver: { escape: (name: string) => `"${name}"` } } },
                createQueryBuilder: () => ({ update: () => ({ set: () => ({ execute: async () => ({ affected: 1 }) }) }) }),
            };
            if (entity === SupportCase) return source.getRepository(SupportCase);
            if (entity === VendorProfile) return {
                find: async () => [vendor, unrelatedVendor],
                findOne: async ({ where }: { where: Record<string, unknown> }) =>
                    [vendor, unrelatedVendor].find(item => Object.entries(where)
                        .every(([key, value]) => String((item as Record<string, unknown>)[key]) === String(value))) ?? null,
            };
            if (entity === Order) {
                const conditions: Record<string, unknown> = {};
                const builder = {
                    leftJoinAndSelect: () => builder,
                    where: (_sql: string, values: Record<string, unknown>) => { Object.assign(conditions, values); return builder; },
                    andWhere: (_sql: string, values: Record<string, unknown>) => { Object.assign(conditions, values); return builder; },
                    getOne: async () => {
                        const candidate = orders.get(String(conditions.id));
                        if (!candidate) return null;
                        if (conditions.userId && String(candidate.customer?.user?.id) !== String(conditions.userId)) return null;
                        if (conditions.type && candidate.type !== conditions.type) return null;
                        if (conditions.active !== undefined && candidate.active !== conditions.active) return null;
                        return candidate;
                    },
                };
                return { createQueryBuilder: () => builder };
            }
            throw new Error(`Unexpected repository ${String(entity)}`);
        },
    } as unknown as TransactionalConnection;
    const service = new SupportService(connection, orderService);
    const context = (activeUserId: string, superAdmin = false) => ({
        activeUserId,
        userHasPermissions: (permissions: Permission[]) => superAdmin && permissions.includes(Permission.SuperAdmin),
    }) as unknown as RequestContext;
    const customerCtx = context(buyer.user.id);
    const strangerCtx = context('another-customer');
    const vendorCtx = context(vendor.ownerUserId);
    const otherVendorCtx = context(unrelatedVendor.ownerUserId);
    const adminCtx = context('super-admin', true);
    try {
        assert.equal((await service.returnEligibility(customerCtx, order.id)).eligible, true);
        await assert.rejects(service.returnEligibility(strangerCtx, order.id));
        const firstInput = { sellerOrderId: order.id, reason: 'Wrong item arrived',
            items: [{ orderLineId: 'physical-line-1', quantity: 2 }] };
        await assert.rejects(service.openReturnCase(strangerCtx, firstInput));
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput, items: [] }), /Select at least one product/);
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput,
            items: [{ orderLineId: 'different-order-line', quantity: 1 }],
        }), /does not belong/);
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput,
            items: [{ orderLineId: 'physical-line-1', quantity: 3 }],
        }), /between 1 and 2/);
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput,
            items: [{ orderLineId: 'physical-line-1', quantity: 0 }],
        }), /between 1 and 2/);
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput,
            items: [{ orderLineId: 'physical-line-1', quantity: 1.5 }],
        }), /between 1 and 2/);
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput,
            items: [{ orderLineId: 'physical-line-1', quantity: 1 }, { orderLineId: 'physical-line-1', quantity: 1 }],
        }), /only be selected once/);
        const opened = await service.openReturnCase(customerCtx, firstInput);
        assert.equal(opened.status, 'OPEN');
        assert.equal(opened.sellerOrderId, String(order.id));
        assert.equal(opened.returnRequired, true);
        assert.deepEqual(opened.returnItems?.map(item => [item.orderLineId, item.quantity]), [['physical-line-1', 2]]);
        assert.equal(opened.returnItems?.[0]?.productName, 'Blue scarf');
        assert.equal(opened.sellerOrderStatusBeforeReturn, 'DELIVERED');
        assert.deepEqual(statusHistory, ['RETURN_REQUESTED']);
        await assert.rejects(service.openReturnCase(customerCtx, { ...firstInput, reason: 'Duplicate appeal' }));
        assert.equal((await source.getRepository(SupportCase).count()), 1);
        assert.equal((await service.findVendorReturnCases(vendorCtx)).length, 1);
        assert.equal((await service.findVendorReturnCases(otherVendorCtx)).length, 0);
        await assert.rejects(service.replyAsVendor(otherVendorCtx, opened.id, 'No access to this order'));
        await assert.rejects(service.decideReturnCase(vendorCtx, opened.id, 'APPROVE', 'Vendor cannot decide'));
        await assert.rejects(service.messageReturnVendor(customerCtx, opened.id, 'Customer cannot join internal thread'));
        await service.messageReturnVendor(adminCtx, opened.id, 'Please inspect the shipment');
        const vendorReply = await service.replyAsVendor(vendorCtx, opened.id, 'We sent the wrong variant');
        assert.equal(vendorReply.internalMessages?.length, 2);
        assert.equal(vendorReply.messages?.length, 0, 'Vendor view must hide the customer discussion');
        const approved = await service.decideReturnCase(adminCtx, opened.id, 'APPROVE', 'Send the wrong item back');
        assert.equal(approved.status, 'RETURN_APPROVED');
        assert.equal((await service.findAll(vendorCtx)).items.length, 0, 'Only super admin sees return tickets in admin queue');
        assert.equal((await service.findAll(adminCtx)).items.length, 1);
        await assert.rejects(service.decideReturnCase(adminCtx, opened.id, 'REJECT', 'Second decision'));
        await assert.rejects(service.resolve(adminCtx, { id: opened.id, decision: 'Bypass' }));
        const followedUp = await service.replyAsOwner(customerCtx, {
            id: opened.id, body: 'I will send it back', authorRole: 'SUPER_ADMIN', status: 'OPEN',
        });
        assert.equal(followedUp.status, 'RETURN_APPROVED', 'A customer follow-up must not reopen an approved return');
        assert.equal(followedUp.messages?.at(-1)?.authorRole, 'CUSTOMER', 'A customer cannot forge the author role');
        const adminFollowUp = await service.replyAsAdmin(adminCtx, {
            id: opened.id, body: 'Use tracked shipping', authorRole: 'VENDOR', status: 'RETURN_REJECTED',
        });
        assert.equal(adminFollowUp.status, 'RETURN_APPROVED', 'Generic admin reply must not change the return decision');
        assert.equal(adminFollowUp.messages?.at(-1)?.authorRole, 'ADMIN');
        await assert.rejects(service.markReturnReceived(vendorCtx, opened.id, 'Vendor cannot receive'));
        const received = await service.markReturnReceived(adminCtx, opened.id, 'Parcel inspected and received');
        assert.equal(received.status, 'RETURN_RECEIVED');
        assert.deepEqual(statusHistory, ['RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURNED']);
        await assert.rejects(service.markReturnReceived(adminCtx, opened.id, 'Do not restock twice'));
        assert.equal((await source.getRepository(SupportCase).findOneByOrFail({ id: opened.id })).status, 'RETURN_RECEIVED');

        const digitalOrder = {
            ...order, id: 'seller-digital-1', code: 'DIGITAL-RETURN-1',
            lines: [{ id: 'digital-line-1', quantity: 1,
                productVariant: { product: { customFields: { marketplaceType: 'DIGITAL' } } } }],
            customFields: { marketplaceStatus: 'FULFILLED', marketplaceDeliveredAt: new Date(Date.now() - 86_400_000) },
        } as unknown as Order;
        orders.set(String(digitalOrder.id), digitalOrder);
        const digitalCase = await service.openReturnCase(customerCtx, {
            sellerOrderId: digitalOrder.id, reason: 'Digital file is corrupted',
            items: [{ orderLineId: 'digital-line-1', quantity: 1 }],
        });
        assert.equal(digitalCase.returnRequired, false);
        await service.messageReturnVendor(adminCtx, digitalCase.id, 'Please check the defective digital file');
        await assert.rejects(service.decideReturnCase(
            adminCtx, digitalCase.id, 'APPROVE', 'Digital access was defective', true,
        ), /cannot require a physical return/, 'A non-shipping dispute must not be forced into a physical return');
        const digitalDecision = await service.decideReturnCase(
            adminCtx, digitalCase.id, 'APPROVE', 'Digital access was defective', false,
        );
        assert.equal(digitalDecision.returnRequired, false);
        await assert.rejects(service.markReturnReceived(adminCtx, digitalCase.id, 'No parcel exists'));

        const mixedOrder = {
            ...order, id: 'seller-mixed-1', code: 'MIXED-RETURN-1',
            lines: [
                { id: 'mixed-physical', quantity: 2,
                    productVariant: { name: 'Red', sku: 'RED-1', product: { name: 'Red scarf', customFields: { marketplaceType: 'PHYSICAL' } } } },
                { id: 'mixed-digital', quantity: 1,
                    productVariant: { name: 'PDF', sku: 'PDF-1', product: { name: 'Pattern PDF', customFields: { marketplaceType: 'DIGITAL' } } } },
            ],
            customFields: { marketplaceStatus: 'DELIVERED', marketplaceDeliveredAt: new Date(Date.now() - 86_400_000) },
        } as unknown as Order;
        orders.set(String(mixedOrder.id), mixedOrder);
        const mixedEligibility = await service.returnEligibility(customerCtx, mixedOrder.id);
        assert.deepEqual(mixedEligibility.returnableItems.map(item => [item.orderLineId, item.quantity]), [
            ['mixed-physical', 2], ['mixed-digital', 1],
        ]);
        const firstPartial = await service.openReturnCase(customerCtx, {
            sellerOrderId: mixedOrder.id, reason: 'The digital pattern is corrupt',
            items: [{ orderLineId: 'mixed-digital', quantity: 1 }],
        });
        assert.equal(firstPartial.returnRequired, false, 'A digital item in a mixed order needs no physical return');
        await service.messageReturnVendor(adminCtx, firstPartial.id, 'Please check the digital file');
        await service.decideReturnCase(adminCtx, firstPartial.id, 'APPROVE', 'Digital file could not be opened');
        assert.equal((mixedOrder.customFields as Record<string, unknown>).marketplaceStatus, 'RETURN_REQUESTED',
            'Approving a partial case must not mark the entire order returned');
        firstPartial.status = 'REFUNDED';
        await source.getRepository(SupportCase).save(firstPartial);
        await orderService.restoreAfterReturn(adminCtx, String(mixedOrder.id), 'DELIVERED', 'Partial refund completed');
        const remaining = await service.returnEligibility(customerCtx, mixedOrder.id);
        assert.equal(remaining.eligible, true);
        assert.deepEqual(remaining.returnableItems.map(item => [item.orderLineId, item.quantity]), [['mixed-physical', 2]]);
        await assert.rejects(service.openReturnCase(customerCtx, {
            sellerOrderId: mixedOrder.id, reason: 'Digital already refunded',
            items: [{ orderLineId: 'mixed-digital', quantity: 1 }],
        }), /between 1 and 0/);
        const secondPartial = await service.openReturnCase(customerCtx, {
            sellerOrderId: mixedOrder.id, reason: 'One scarf arrived damaged',
            items: [{ orderLineId: 'mixed-physical', quantity: 1 }],
        });
        assert.equal(secondPartial.returnRequired, true);
        await service.messageReturnVendor(adminCtx, secondPartial.id, 'Was this scarf damaged in transit?');
        await service.decideReturnCase(adminCtx, secondPartial.id, 'APPROVE', 'Please return one scarf');
        const physicalReceived = await service.markReturnReceived(adminCtx, secondPartial.id, 'One scarf received');
        assert.equal(physicalReceived.status, 'RETURN_RECEIVED');
        assert.equal((mixedOrder.customFields as Record<string, unknown>).marketplaceStatus, 'RETURN_REQUESTED');
        const activeEligibility = await service.returnEligibility(customerCtx, mixedOrder.id);
        assert.equal(activeEligibility.eligible, false, 'An unfinished partial return blocks a concurrent appeal');
        assert.deepEqual(activeEligibility.returnableItems.map(item => [item.orderLineId, item.quantity]), [['mixed-physical', 1]]);

        const rejectedOrder = {
            ...order, id: 'seller-rejected-1', code: 'REJECTED-RETURN-1',
            customFields: { marketplaceStatus: 'DELIVERED', marketplaceDeliveredAt: new Date(Date.now() - 86_400_000) },
        } as unknown as Order;
        orders.set(String(rejectedOrder.id), rejectedOrder);
        const rejectedCase = await service.openReturnCase(customerCtx, {
            sellerOrderId: rejectedOrder.id, reason: 'I think the color differs',
            items: [{ orderLineId: 'physical-line-1', quantity: 1 }],
        });
        await service.messageReturnVendor(adminCtx, rejectedCase.id, 'Please check the actual color');
        const rejectedDecision = await service.decideReturnCase(
            adminCtx, rejectedCase.id, 'REJECT', 'The ordered color matches the item delivered',
        );
        assert.equal(rejectedDecision.status, 'RETURN_REJECTED');
        assert.equal((rejectedOrder.customFields as Record<string, unknown>).marketplaceStatus, 'DELIVERED');
        const afterRejection = await service.returnEligibility(customerCtx, rejectedOrder.id);
        assert.equal(afterRejection.eligible, true, 'A rejected appeal must not consume returnable quantity');
        assert.equal(afterRejection.returnableItems[0]?.quantity, 2);
    } finally {
        await source.destroy();
    }
}

async function verifyAdminReturnQueue() {
    const source = await new DataSource({
        type: 'better-sqlite3', database: ':memory:', entities: [SupportCase], synchronize: true,
    }).initialize();
    const connection = {
        getRepository: () => source.getRepository(SupportCase),
    } as unknown as TransactionalConnection;
    const service = new SupportService(connection, {} as MarketplaceOrderService);
    const adminCtx = {
        activeUserId: 'super-admin', userHasPermissions: (permissions: Permission[]) => permissions.includes(Permission.SuperAdmin),
    } as unknown as RequestContext;
    const vendorCtx = {
        activeUserId: 'vendor-user', userHasPermissions: () => false,
    } as unknown as RequestContext;
    try {
        const cases = source.getRepository(SupportCase);
        for (let index = 0; index < 30; index++) {
            await cases.save(new SupportCase({
                code: `CASE-GENERIC-${index}`, openedByUserId: 'customer', category: 'GENERAL',
                subject: 'Generic support request', priority: 'NORMAL', status: 'OPEN', messages: [],
            }));
        }
        for (let index = 0; index < 27; index++) {
            await cases.save(new SupportCase({
                code: `CASE-RETURN-${index}`, openedByUserId: 'customer',
                sellerOrderId: `seller-order-${index}`, category: 'RETURN_DISPUTE',
                subject: 'Return request', priority: 'HIGH', status: 'OPEN', messages: [],
            }));
        }
        await assert.rejects(service.findReturnCases(vendorCtx), /forbidden/i);
        const first = await service.findReturnCases(adminCtx, { skip: 0, take: 25 });
        const second = await service.findReturnCases(adminCtx, { skip: 25, take: 25 });
        assert.equal(first.totalItems, 27, 'Generic tickets must not change the return queue count');
        assert.equal(first.items.length, 25);
        assert.equal(second.totalItems, 27);
        assert.equal(second.items.length, 2);
        assert(first.items.concat(second.items).every(item => item.category === 'RETURN_DISPUTE'));
        assert.equal(new Set(first.items.concat(second.items).map(item => String(item.id))).size, 27);
        const linked = await service.findReturnCases(adminCtx, { take: 100 }, ['seller-order-0']);
        assert.equal(linked.totalItems, 1, 'Order dashboards must find an older appeal by vendor order');
        assert.equal(linked.items[0]?.sellerOrderId, 'seller-order-0');
    } finally {
        await source.destroy();
    }
}

async function verifyReturnRefundLifecycle() {
    const source = await new DataSource({
        type: 'better-sqlite3', database: ':memory:',
        entities: [SupportCase, MarketplaceCustomerRefund], synchronize: true,
    }).initialize();
    const customerOrder = {
        id: 'customer-order-1', code: 'CUSTOMER-RETURN-1', totalWithTax: 25_000,
        payments: [{
            state: 'Settled', amount: 25_000,
            metadata: {
                source: 'MARKETPLACE_DIRECT_PURCHASE', collectionStatus: 'CONFIRMED',
                companyReceiptReference: 'RECEIPT-1', companyReceiptConfirmedAt: '2026-01-01T12:00:00.000Z',
            },
            refunds: [],
        }],
    };
    const order = {
        id: 'seller-return-1', code: 'SELLER-RETURN-1', type: OrderType.Seller, active: false,
        customer: { id: 'customer-1', firstName: 'QA', lastName: 'Customer', emailAddress: 'buyer@example.test' },
        aggregateOrder: customerOrder, currencyCode: 'PKR', channels: [{ id: 'vendor-channel-1' }],
        lines: [{ discountedLinePriceWithTax: 20_000 }], shippingWithTax: 5_000,
        customFields: { marketplaceStatus: 'RETURNED' },
    } as unknown as Order;
    const vendor = { id: 'vendor-1', channelId: 'vendor-channel-1', shopName: 'QA vendor' };
    const transitions: string[] = [];
    const orderService = {
        async transitionReturnStatus(_ctx: RequestContext, id: string, status: string) {
            assert.equal(id, String(order.id));
            transitions.push(status);
            (order.customFields as Record<string, unknown>).marketplaceStatus = status;
        },
    } as unknown as MarketplaceOrderService;
    const payoutLockRepository = {
        metadata: { findColumnWithPropertyName: () => ({ databaseName: 'holdingPeriodDays' }) },
        manager: { connection: { driver: { escape: (name: string) => `"${name}"` } } },
        createQueryBuilder: () => ({ update: () => ({ set: () => ({ execute: async () => ({ affected: 1 }) }) }) }),
    };
    const connection = {
        withTransaction: async (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) => work(ctx),
        getRepository(_ctx: RequestContext, entity: unknown) {
            if (entity === MarketplacePayoutSettings) return payoutLockRepository;
            if (entity === SupportCase) return source.getRepository(SupportCase);
            if (entity === MarketplaceCustomerRefund) return source.getRepository(MarketplaceCustomerRefund);
            if (entity === VendorProfile) return { find: async () => [vendor] };
            if (entity === MarketplaceRewardRedemption) return { find: async () => [] };
            if (entity === MarketplaceCouponRedemption) return { find: async () => [] };
            if (entity === Order) {
                const builder = {
                    leftJoinAndSelect: () => builder,
                    where: () => builder,
                    andWhere: () => builder,
                    getOne: async () => order,
                };
                return { createQueryBuilder: () => builder };
            }
            throw new Error(`Unexpected repository ${String(entity)}`);
        },
    } as unknown as TransactionalConnection;
    const service = new MarketplaceCustomerRefundService(connection, orderService,
        {} as MarketplaceCommissionRuleService, {} as MarketplacePurchaseRewardService,
        {} as MarketplaceRewardRedemptionService);
    const context = (activeUserId: string, superAdmin = false) => ({
        activeUserId,
        userHasPermissions: (permissions: Permission[]) => superAdmin && permissions.includes(Permission.SuperAdmin),
    }) as unknown as RequestContext;
    const adminCtx = context('super-admin', true);
    const vendorCtx = context('vendor-user');
    const refundInput: { sellerOrderId: typeof order.id; supportCaseId?: string; method: string; accountHolderName: string; accountIdentifier: string; reason: string } = {
        sellerOrderId: order.id, method: 'EASYPAISA', accountHolderName: 'QA Customer',
        accountIdentifier: '03001234567', reason: 'Wrong item returned',
    };
    try {
        const cases = source.getRepository(SupportCase);
        const returnCase = await cases.save(new SupportCase({
            code: 'CASE-RETURN-REFUND', openedByUserId: 'buyer-user', sellerOrderId: String(order.id),
            orderId: String(customerOrder.id), category: 'RETURN_DISPUTE', subject: 'Wrong item',
            priority: 'NORMAL', status: 'RETURN_APPROVED', returnRequired: true,
            messages: [], internalMessages: [],
        }));
        refundInput.supportCaseId = String(returnCase.id);
        await assert.rejects(service.create(adminCtx, refundInput), /receive the product/);
        assert.equal((await cases.findOneByOrFail({ id: returnCase.id })).status, 'RETURN_APPROVED');
        await assert.rejects(service.create(vendorCtx, refundInput), /super administrator/);

        returnCase.status = 'RETURN_RECEIVED';
        await cases.save(returnCase);
        const unpaid = await service.create(adminCtx, refundInput);
        assert.equal(unpaid.status, 'UNPAID');
        assert.equal(unpaid.refundScope, 'PRODUCT_ONLY');
        assert.equal(unpaid.deliveryAmount, 0, 'Approved returns must not refund the original delivery fee');
        assert.equal(unpaid.cashAmount, 20_000);
        assert.equal(unpaid.grossAmount, 20_000);
        assert.deepEqual(transitions, ['REFUNDED']);
        let linkedCase = await cases.findOneByOrFail({ id: returnCase.id });
        assert.equal(linkedCase.status, 'REFUND_PENDING');
        assert.equal(linkedCase.refundId, String(unpaid.id));
        assert.equal(linkedCase.refundStatus, 'UNPAID');

        await assert.rejects(service.process(adminCtx, { id: unpaid.id, status: 'PAID' }), /Transaction reference/);
        assert.equal((await source.getRepository(MarketplaceCustomerRefund).findOneByOrFail({ id: unpaid.id })).status, 'UNPAID');
        const rejected = await service.process(adminCtx, {
            id: unpaid.id, status: 'REJECTED', decisionNote: 'Wallet number could not be verified',
        });
        assert.equal(rejected.status, 'REJECTED');
        linkedCase = await cases.findOneByOrFail({ id: returnCase.id });
        assert.equal(linkedCase.status, 'REFUND_PENDING');
        assert.equal(linkedCase.refundStatus, 'REJECTED');
        assert.equal((order.customFields as Record<string, unknown>).marketplaceStatus, 'REFUNDED');

        await assert.rejects(service.create(vendorCtx, refundInput), /super administrator/);
        const retried = await service.create(adminCtx, {
            ...refundInput, method: 'JAZZCASH', accountIdentifier: '03009876543',
        });
        assert.equal(String(retried.id), String(unpaid.id), 'A corrected payout retries the same refund record');
        assert.equal(retried.status, 'UNPAID');
        assert.equal(retried.method, 'JAZZCASH');
        assert.deepEqual(transitions, ['REFUNDED'], 'Retry must not refund the order twice');
        linkedCase = await cases.findOneByOrFail({ id: returnCase.id });
        assert.equal(linkedCase.refundStatus, 'UNPAID');

        await assert.rejects(service.process(vendorCtx, {
            id: retried.id, status: 'PAID', transactionReference: 'TRANSFER-1',
        }), /super administrator/);
        const paid = await service.process(adminCtx, {
            id: retried.id, status: 'PAID', transactionReference: 'TRANSFER-1',
        });
        assert.equal(paid.status, 'PAID');
        assert.equal(paid.transactionReference, 'TRANSFER-1');
        assert(paid.paidAt instanceof Date);
        linkedCase = await cases.findOneByOrFail({ id: returnCase.id });
        assert.equal(linkedCase.status, 'REFUNDED');
        assert.equal(linkedCase.refundStatus, 'PAID');
        assert(linkedCase.resolvedAt instanceof Date);
        assert.match(linkedCase.messages?.at(-1)?.body ?? '', /refund has been transferred/i);
        assert.match(linkedCase.messages?.at(-1)?.body ?? '', /TRANSFER-1/, 'The customer must receive the transfer reference');
        await assert.rejects(service.create(adminCtx, refundInput), /paid refund request already exists/);
        await assert.rejects(service.process(adminCtx, {
            id: paid.id, status: 'PAID', transactionReference: 'TRANSFER-2',
        }), /Only unpaid refund requests/);
    } finally {
        await source.destroy();
    }
}

async function verifyThreePartialRefunds() {
    const source = await new DataSource({ type: 'better-sqlite3', database: ':memory:',
        entities: [SupportCase, MarketplaceCustomerRefund, PayoutLedgerEntry], synchronize: true }).initialize();
    const sellerOrderId = 'seller-partial-1';
    const order = {
        id: sellerOrderId, code: 'SELLER-PARTIAL-1', type: OrderType.Seller, active: false,
        customer: { id: 'buyer-1', firstName: 'QA', lastName: 'Buyer', emailAddress: 'buyer@example.test' },
        aggregateOrder: { id: 'aggregate-1', code: 'ORDER-1', totalWithTax: 110,
            payments: [{ state: 'Settled', amount: 110, metadata: { source: 'MARKETPLACE_DIRECT_PURCHASE',
                collectionStatus: 'CONFIRMED', companyReceiptReference: 'RECEIPT-1',
                companyReceiptConfirmedAt: '2026-01-01T00:00:00Z' }, refunds: [] }] },
        currencyCode: 'PKR', channels: [{ id: 'vendor-channel-1' }],
        lines: [{ id: 'line-1', quantity: 3, discountedLinePriceWithTax: 100,
            discountedLinePrice: 90, productVariant: { id: 'variant-1' } }],
        shippingWithTax: 10, customFields: { marketplaceStatus: 'RETURN_REQUESTED' },
    } as unknown as Order;
    const vendor = { id: 'vendor-1', channelId: 'vendor-channel-1', shopName: 'QA vendor' };
    const payoutLockRepository = {
        metadata: { findColumnWithPropertyName: () => ({ databaseName: 'holdingPeriodDays' }) },
        manager: { connection: { driver: { escape: (name: string) => `"${name}"` } } },
        createQueryBuilder: () => ({ update: () => ({ set: () => ({ execute: async () => ({ affected: 1 }) }) }) }),
    };
    const connection = {
        withTransaction: async (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) => work(ctx),
        getRepository(_ctx: RequestContext, entity: unknown) {
            if ([SupportCase, MarketplaceCustomerRefund, PayoutLedgerEntry].includes(entity as typeof SupportCase)) {
                return source.getRepository(entity as typeof SupportCase);
            }
            if (entity === MarketplacePayoutSettings) return payoutLockRepository;
            if (entity === VendorProfile) return { find: async () => [vendor] };
            if (entity === MarketplaceRewardRedemption) return { find: async () => [{ allocations: [
                { sellerOrderId, amount: 30, coins: 3 },
            ] }] };
            if (entity === MarketplaceCouponRedemption) return { find: async () => [{
                couponCode: 'SAVE5', fundingSource: 'VENDOR', allocations: [{ sellerOrderId, amount: 5,
                    lineAllocations: [{ variantId: 'variant-1', amount: 5 }] }],
            }] };
            if (entity === Order) {
                const builder = { leftJoinAndSelect: () => builder, where: () => builder,
                    andWhere: () => builder, getOne: async () => order };
                return { createQueryBuilder: () => builder };
            }
            throw new Error(`Unexpected repository ${String(entity)}`);
        },
    } as unknown as TransactionalConnection;
    const orderService = { async restoreAfterReturn(_ctx: RequestContext, id: string, target: string) {
        assert.equal(id, sellerOrderId);
        (order.customFields as Record<string, unknown>).marketplaceStatus = target;
    } } as unknown as MarketplaceOrderService;
    const commissionService = { async createLedgerEntriesForSellerOrder() { return []; } } as unknown as MarketplaceCommissionRuleService;
    const purchaseRewardService = { async reverseForReturnedItems() { return []; } } as unknown as MarketplacePurchaseRewardService;
    const redemptionService = { async restoreForReturnedItems() { return []; } } as unknown as MarketplaceRewardRedemptionService;
    const service = new MarketplaceCustomerRefundService(connection, orderService,
        commissionService, purchaseRewardService, redemptionService);
    const adminCtx = { activeUserId: 'super-admin',
        userHasPermissions: (permissions: Permission[]) => permissions.includes(Permission.SuperAdmin) } as unknown as RequestContext;
    try {
        const ledger = source.getRepository(PayoutLedgerEntry);
        const initial = [
            { kind: 'SALE', amount: 100, metadata: { source: 'MARKETPLACE_COMMISSION_RULES',
                ruleSummary: JSON.stringify([{ lineId: 'line-1', commissionAmount: 10, feeAmount: 3 }]) } },
            { kind: 'COMMISSION', amount: -10 }, { kind: 'PAYMENT_FEE', amount: -3 },
            { kind: 'TAX', amount: -10 }, { kind: 'COUPON_DISCOUNT', amount: -5 },
            { kind: 'REWARD_FUNDING', amount: 30, metadata: { accountingEffect: 'INFORMATIONAL' } },
        ] as const;
        await ledger.save(initial.map(item => new PayoutLedgerEntry({
            beneficiaryType: 'VENDOR', beneficiaryId: 'vendor-1', orderId: sellerOrderId,
            kind: item.kind, amount: item.amount, currencyCode: 'PKR', status: 'ON_HOLD',
            availableAt: new Date(), metadata: 'metadata' in item ? item.metadata : undefined,
        })));
        const cases = source.getRepository(SupportCase);
        const refunds: MarketplaceCustomerRefund[] = [];
        for (let index = 0; index < 3; index++) {
            (order.customFields as Record<string, unknown>).marketplaceStatus = 'RETURN_REQUESTED';
            const appeal = await cases.save(new SupportCase({
                code: `CASE-PARTIAL-${index}`, openedByUserId: 'buyer-1', sellerOrderId,
                category: 'RETURN_DISPUTE', subject: 'Damaged unit', priority: 'HIGH',
                status: 'RETURN_RECEIVED', returnRequired: true, messages: [],
                sellerOrderStatusBeforeReturn: 'FULFILLED',
                returnItems: [{ orderLineId: 'line-1', quantity: 1, productName: 'Scarf' }],
            }));
            const refund = await service.create(adminCtx, { sellerOrderId, supportCaseId: appeal.id,
                method: 'EASYPAISA', accountHolderName: 'QA Buyer', accountIdentifier: '03001234567',
                reason: 'Damaged unit received' });
            refunds.push(refund);
            assert.equal(refund.orderStatus, 'PARTIALLY_REFUNDED');
            assert.equal(refund.deliveryAmount, 0);
            assert.equal((order.customFields as Record<string, unknown>).marketplaceStatus, 'FULFILLED');
            await service.process(adminCtx, { id: refund.id, status: 'PAID', transactionReference: `TRANSFER-${index}` });
        }
        assert.deepEqual(refunds.map(item => item.productAmount), [33, 33, 34]);
        assert.equal(refunds.reduce((sum, item) => sum + item.productAmount, 0), 100);
        assert.equal(refunds.reduce((sum, item) => sum + item.cashAmount, 0), 65);
        assert.deepEqual(refunds.map(item => item.rewardCoins), [0, 1, 2]);
        assert.equal(refunds.reduce((sum, item) => sum + item.couponDiscountAmount, 0), 5);
        const active = await ledger.find({ where: { orderId: sellerOrderId } });
        const accounting = active.filter(item => item.metadata?.accountingEffect !== 'INFORMATIONAL');
        assert.equal(accounting.reduce((sum, item) => sum + item.amount, 0), 0,
            'All returned units must leave no vendor earnings or commission');
        assert.equal(active.filter(item => item.kind === 'REFUND' && item.status === 'PAID').length, 3);
        assert.equal((await source.getRepository(MarketplaceCustomerRefund).count()), 3);
    } finally {
        await source.destroy();
    }
}

void verifyMigration()
    .then(async () => {
        verifyDeadlinePolicy();
        await verifySupportCaseStorage();
        await verifyReturnLifecycle();
        await verifyAdminReturnQueue();
        await verifyReturnRefundLifecycle();
        await verifyThreePartialRefunds();
        console.log('Return/dispute deadline, migration, case lifecycle and manual refund synchronization checks passed.');
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
