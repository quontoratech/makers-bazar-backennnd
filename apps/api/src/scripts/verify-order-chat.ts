import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { DataSource, Table } from 'typeorm';

import { AddMarketplaceOrderChat1787692800000 } from '../migrations/1787692800000-add-marketplace-order-chat';
import { ExtendMarketplaceChatSupport1787952000000 } from '../migrations/1787952000000-extend-marketplace-chat-support';
import { AddListingInquiriesAndQuotes1787962800000 } from '../migrations/1787962800000-add-listing-inquiries-and-quotes';
import { AddListingQuoteAddOns1787966400000 } from '../migrations/1787966400000-add-listing-quote-add-ons';
import { MarketplaceQuotePriceCalculationStrategy } from '../plugins/marketplace/modules/chat/config/marketplace-quote-price-calculation-strategy';
import { marketplaceListingRequiresShipping } from '../plugins/marketplace/modules/catalog/catalog-shipping-policy';
import {
    marketplaceOrderAvailableStatuses,
    marketplaceOrderPrintableDocuments,
    marketplaceOrderStatusLabel,
    marketplaceOrderStatusMessage,
    resolveMarketplaceOrderFulfillmentType,
} from '../plugins/marketplace/modules/order/order-workflow-policy';
import {
    calculateMarketplaceChatReceiptTotals,
    canAccessMarketplaceChat,
    marketplaceOrderChatEnabled,
    normalizeMarketplaceChatOrderReceipt,
} from '../plugins/marketplace/modules/chat/chat-policy';

const receipt = calculateMarketplaceChatReceiptTotals({
    itemsBeforeDiscount: 210_000,
    productSubtotal: 200_000,
    shipping: 45_000,
    rewardCoins: 60,
    rewardFunding: 600,
});
assert.equal(marketplaceListingRequiresShipping('SERVICE', 'PHYSICAL'), false);
assert.equal(marketplaceListingRequiresShipping('PHYSICAL_PRODUCT', 'SERVICE'), true);
assert.equal(marketplaceListingRequiresShipping(undefined, 'PERISHABLE'), true);
assert.equal(resolveMarketplaceOrderFulfillmentType(['PERISHABLE']), 'FOOD');
assert.equal(resolveMarketplaceOrderFulfillmentType(['DIGITAL']), 'DIGITAL');
assert.equal(resolveMarketplaceOrderFulfillmentType(['EVENT']), 'EVENT');
assert.equal(resolveMarketplaceOrderFulfillmentType(['PHYSICAL', 'SERVICE']), 'MIXED');
assert.deepEqual(marketplaceOrderAvailableStatuses('CONFIRMED', 'SERVICE'), ['PROCESSING', 'FULFILLED', 'CANCELLED']);
assert(marketplaceOrderAvailableStatuses('CONFIRMED', 'PHYSICAL').includes('PACKED'));
assert(!marketplaceOrderAvailableStatuses('CONFIRMED', 'DIGITAL').includes('OUT_OF_STOCK_EXCEPTION'));
assert.deepEqual(marketplaceOrderPrintableDocuments('PROCESSING', 'EVENT'), ['invoice']);
assert.deepEqual(marketplaceOrderPrintableDocuments('PROCESSING', 'PHYSICAL'), ['invoice', 'packing-slip']);
assert.equal(marketplaceOrderStatusLabel('PROCESSING', 'WORKSHOP'), 'Session scheduled');
assert.equal(marketplaceOrderStatusMessage('PACKED', 'PHYSICAL'), 'Your parcel has been packed and is ready for dispatch.');
assert.equal(marketplaceOrderStatusMessage('FULFILLED', 'DIGITAL'), 'Your ebook is ready. Sign in to your customer orders to download it securely.');
assert.equal(marketplaceOrderChatEnabled([{ customFields: {} }]), false);
assert.equal(marketplaceOrderChatEnabled([{ customFields: { marketplaceQuoteId: '' } }]), false);
assert.equal(marketplaceOrderChatEnabled([{ customFields: { marketplaceQuoteId: 'quote-1' } }]), true);
assert.deepEqual(receipt, {
    discount: 10_000,
    customerFundedProductAmount: 199_400,
    orderTotal: 245_000,
    customerPaidTotal: 244_400,
});
assert.throws(() => calculateMarketplaceChatReceiptTotals({
    itemsBeforeDiscount: 1_000,
    productSubtotal: 1_000,
    shipping: 0,
    rewardCoins: 20,
    rewardFunding: 2_000,
}), /cannot exceed/);

const legacyReceipt = normalizeMarketplaceChatOrderReceipt({
    sellerOrderCode: 'S-1',
    customerOrderCode: 'C-1',
    currencyCode: 'USD',
    lines: [{
        orderLineId: '1',
        productName: 'Desk',
        variantName: 'Oak',
        sku: 'DESK-OAK',
        quantity: 1,
        unitPrice: 200_000,
        lineTotal: 200_000,
    }],
    itemsBeforeDiscount: 210_000,
    discount: 10_000,
    productSubtotal: 200_000,
    rewardCoins: 60,
    rewardFunding: 600,
    customerFundedProductAmount: 199_400,
    shipping: 45_000,
    taxIncluded: 0,
    orderTotal: 245_000,
    customerPaidTotal: 244_400,
    placedAt: '2026-08-31T00:00:00.000Z',
});
assert.equal(legacyReceipt?.couponDiscount, 0);
assert.equal(legacyReceipt?.couponCode, undefined);
assert.equal(legacyReceipt?.couponFundingSource, undefined);

const conversation = { customerUserId: 'customer-1', vendorOwnerUserId: 'vendor-1' };
assert(canAccessMarketplaceChat({ userId: 'customer-1', role: 'CUSTOMER' }, conversation));
assert(!canAccessMarketplaceChat({ userId: 'customer-2', role: 'CUSTOMER' }, conversation));
assert(canAccessMarketplaceChat({ userId: 'vendor-1', role: 'VENDOR' }, conversation));
assert(!canAccessMarketplaceChat({ userId: 'vendor-2', role: 'VENDOR' }, conversation));
assert(canAccessMarketplaceChat({ userId: 'admin-1', role: 'ADMIN' }, conversation));
assert(canAccessMarketplaceChat({ userId: 'super-1', role: 'SUPER_ADMIN' }, conversation));

async function verifyMigration() {
    const strategy = new MarketplaceQuotePriceCalculationStrategy();
    const activeQuote = {
        id: 'quote-1',
        status: 'SENT',
        validUntil: new Date(Date.now() + 60_000),
        customerUserId: 'customer-1',
        productVariantId: 'variant-1',
        amount: 125_000,
    };
    (strategy as unknown as { connection: { getRepository: () => { findOne: () => Promise<typeof activeQuote> } } }).connection = {
        getRepository: () => ({ findOne: async () => activeQuote }),
    };
    const variant = { id: 'variant-1', listPrice: 99_000, listPriceIncludesTax: true };
    assert.deepEqual(await strategy.calculateUnitPrice(
        { activeUserId: 'customer-1' } as never,
        variant as never,
        { marketplaceQuoteId: 'quote-1' },
        {} as never,
    ), { price: 125_000, priceIncludesTax: true });
    assert.deepEqual(await strategy.calculateUnitPrice(
        { activeUserId: 'customer-1' } as never,
        variant as never,
        {},
        {} as never,
    ), { price: 99_000, priceIncludesTax: true });
    await assert.rejects(strategy.calculateUnitPrice(
        { activeUserId: 'another-customer' } as never,
        variant as never,
        { marketplaceQuoteId: 'quote-1' },
        {} as never,
    ), /invalid or has expired/);

    const directory = await mkdtemp(path.join(tmpdir(), 'marketplace-order-chat-'));
    const dataSource = new DataSource({ type: 'better-sqlite3', database: path.join(directory, 'chat.sqlite') });
    await dataSource.initialize();
    const queryRunner = dataSource.createQueryRunner();
    try {
        const migration = new AddMarketplaceOrderChat1787692800000();
        await migration.up(queryRunner);
        await queryRunner.createTable(new Table({
            name: 'marketplace_report',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }));
        await queryRunner.createTable(new Table({
            name: 'marketplace_vendor_appeal',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }));
        await queryRunner.createTable(new Table({
            name: 'marketplace_form_template',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'key', type: 'varchar' },
            ],
        }));
        await queryRunner.createTable(new Table({
            name: 'marketplace_category',
            columns: [
                { name: 'id', type: 'integer', isPrimary: true },
                { name: 'code', type: 'varchar' },
                { name: 'formTemplateId', type: 'integer', isNullable: true },
            ],
        }));
        await queryRunner.createTable(new Table({
            name: 'order_line',
            columns: [{ name: 'id', type: 'integer', isPrimary: true }],
        }));
        await queryRunner.query(`INSERT INTO "marketplace_form_template" ("id", "key") VALUES (1, 'service')`);
        await queryRunner.query(`INSERT INTO "marketplace_category" ("id", "code") VALUES (1, 'wedding-and-party/wedding-decor'), (2, 'wedding-and-party/party-supplies')`);
        const supportMigration = new ExtendMarketplaceChatSupport1787952000000();
        await supportMigration.up(queryRunner);
        const inquiryMigration = new AddListingInquiriesAndQuotes1787962800000();
        await inquiryMigration.up(queryRunner);
        const quoteAddOnsMigration = new AddListingQuoteAddOns1787966400000();
        await quoteAddOnsMigration.up(queryRunner);
        assert(await queryRunner.hasTable('marketplace_chat_conversation'));
        assert(await queryRunner.hasTable('marketplace_chat_message'));
        assert(await queryRunner.hasTable('marketplace_chat_read_state'));
        assert(await queryRunner.hasTable('marketplace_chat_attachment'));
        const conversations = await queryRunner.getTable('marketplace_chat_conversation');
        const messages = await queryRunner.getTable('marketplace_chat_message');
        const readStates = await queryRunner.getTable('marketplace_chat_read_state');
        const attachments = await queryRunner.getTable('marketplace_chat_attachment');
        const reports = await queryRunner.getTable('marketplace_report');
        const appeals = await queryRunner.getTable('marketplace_vendor_appeal');
        assert(conversations?.indices.some(index => index.name === 'IDX_chat_conversation_seller_order' && index.isUnique));
        assert(conversations?.indices.some(index => index.name === 'IDX_chat_conversation_type'));
        assert(conversations?.indices.some(index => index.name === 'IDX_chat_conversation_source'));
        assert(conversations?.findColumnByName('closeAt'));
        assert(messages?.indices.some(index => index.name === 'IDX_chat_message_idempotency' && index.isUnique));
        assert(readStates?.indices.some(index => index.name === 'IDX_chat_read_participant' && index.isUnique));
        assert(attachments?.indices.some(index => index.name === 'IDX_chat_attachment_storage' && index.isUnique));
        assert(reports?.findColumnByName('supportConversationId'));
        assert(appeals?.findColumnByName('supportConversationId'));
        assert(await queryRunner.hasTable('marketplace_listing_quote'));
        assert(await queryRunner.hasColumn('marketplace_listing_quote', 'addOns'));
        assert(await queryRunner.hasColumn('marketplace_category', 'chatEnabled'));
        assert(await queryRunner.hasColumn('order_line', 'customFieldsMarketplacequoteid'));
        assert((await queryRunner.getTable('marketplace_chat_conversation'))?.findColumnByName('sellerOrderId')?.isNullable);
        const seededCategories = await queryRunner.query(`SELECT "code", "chatEnabled", "formTemplateId" FROM "marketplace_category" ORDER BY "id"`);
        assert.equal(Number(seededCategories[0].chatEnabled), 1);
        assert.equal(Number(seededCategories[0].formTemplateId), 1);
        assert.equal(Number(seededCategories[1].chatEnabled), 0);
        await quoteAddOnsMigration.down(queryRunner);
        assert(!await queryRunner.hasColumn('marketplace_listing_quote', 'addOns'));
        await inquiryMigration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_listing_quote'));
        assert(!await queryRunner.hasColumn('marketplace_category', 'chatEnabled'));
        assert(!await queryRunner.hasColumn('order_line', 'customFieldsMarketplacequoteid'));
        await supportMigration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_chat_attachment'));
        assert(!(await queryRunner.getTable('marketplace_report'))?.findColumnByName('supportConversationId'));
        assert(!(await queryRunner.getTable('marketplace_vendor_appeal'))?.findColumnByName('supportConversationId'));
        await queryRunner.dropTable('marketplace_vendor_appeal');
        await queryRunner.dropTable('marketplace_report');
        await queryRunner.dropTable('order_line');
        await queryRunner.dropTable('marketplace_category');
        await queryRunner.dropTable('marketplace_form_template');
        await migration.down(queryRunner);
        assert(!await queryRunner.hasTable('marketplace_chat_read_state'));
        assert(!await queryRunner.hasTable('marketplace_chat_message'));
        assert(!await queryRunner.hasTable('marketplace_chat_conversation'));
    } finally {
        await queryRunner.release();
        await dataSource.destroy();
        await rm(directory, { recursive: true, force: true });
    }
}

void verifyMigration()
    .then(() => console.log('Order chat authorization, receipt, and migration checks passed.'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
