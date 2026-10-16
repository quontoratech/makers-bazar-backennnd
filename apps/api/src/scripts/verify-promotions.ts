import assert from 'node:assert/strict';
import 'reflect-metadata';
import { DataSource, Table } from 'typeorm';

import { AddPaidMarketplacePromotions1788200000000 } from '../migrations/1788200000000-add-paid-marketplace-promotions';
import { AddPromotionPayments1788300000000 } from '../migrations/1788300000000-add-promotion-payments';
import type { MarketplacePromotionPayment } from '../plugins/marketplace/modules/promotion/entities/marketplace-promotion-payment.entity';
import type { MarketplacePromotionRate } from '../plugins/marketplace/modules/promotion/entities/marketplace-promotion-rate.entity';
import type { MarketplacePromotionRequest } from '../plugins/marketplace/modules/promotion/entities/marketplace-promotion-request.entity';
import {
    categoryContains,
    effectivePromotionStatus,
    maximumPromotionOverlap,
    promotionSurfaces,
    reservationIsLive,
    selectPromotionRate,
} from '../plugins/marketplace/modules/promotion/promotion-policy';
import { summarizePromotionPayments } from '../plugins/marketplace/modules/promotion/promotion-revenue';

async function main() {
    const now = new Date('2026-09-29T12:00:00Z');
    const payment = (
        status: MarketplacePromotionPayment['status'],
        amount: number,
        extra: Partial<MarketplacePromotionPayment> = {},
    ) =>
        ({
            status,
            amount,
            refundedAmount: 0,
            ...(status === 'VERIFIED' || status === 'REFUNDED' ? { verifiedAt: now } : {}),
            ...extra,
        }) as MarketplacePromotionPayment;
    const paymentSummary = summarizePromotionPayments([
        payment('VERIFIED', 50000),
        payment('VERIFIED', 40000, { refundedAmount: 10000 }),
        payment('REFUNDED', 30000, { refundedAmount: 30000 }),
        payment('SUBMITTED', 20000),
        payment('CHECKOUT_OPEN', 10000),
        payment('REJECTED', 100000),
        payment('EXPIRED', 100000),
    ]);
    assert.equal(paymentSummary.netRevenue, 80000);
    assert.equal(paymentSummary.verifiedCount, 3);
    assert.equal(paymentSummary.pendingAmount, 30000);
    assert.equal(
        summarizePromotionPayments([payment('VERIFIED', 50000)], new Date(now.getTime() + 1)).netRevenue,
        0,
    );
    const target = {
        vendorId: 'vendor-1',
        categoryId: 'category-1',
        categoryCode: 'digital/templates',
        placement: 'BOTH' as const,
        campaignId: 'campaign-1',
    };
    const rate = (scope: MarketplacePromotionRate['scope'], extra: Partial<MarketplacePromotionRate> = {}) =>
        ({
            scope,
            placement: 'BOTH',
            pricePerDay: 10000,
            active: true,
            updatedAt: now,
            ...extra,
        }) as MarketplacePromotionRate;
    const rates = [
        rate('GLOBAL'),
        rate('CATEGORY', { categoryCode: 'digital', pricePerDay: 9000 }),
        rate('VENDOR', { vendorProfileId: 'vendor-1', pricePerDay: 8000 }),
        rate('VENDOR_CATEGORY', { vendorProfileId: 'vendor-1', categoryCode: 'digital', pricePerDay: 7000 }),
        rate('CAMPAIGN', { campaignId: 'campaign-1', pricePerDay: 6000 }),
    ];
    for (let count = 1; count <= rates.length; count++) {
        assert.equal(selectPromotionRate(rates.slice(0, count), target)?.scope, rates[count - 1]!.scope);
    }
    assert.equal(
        selectPromotionRate(rates, { ...target, vendorId: 'other', campaignId: 'other' })?.scope,
        'CATEGORY',
    );
    assert.equal(
        selectPromotionRate(rates, { ...target, placement: 'HOME' }),
        undefined,
        'BOTH must not be charged as HOME',
    );
    assert.equal(selectPromotionRate([rate('GLOBAL', { active: false })], target), undefined);
    assert.equal(
        selectPromotionRate(
            [rates[1]!, rate('CATEGORY', { categoryCode: 'digital/templates', pricePerDay: 5000 })],
            target,
        )?.pricePerDay,
        5000,
    );
    assert.equal(categoryContains('digital', 'digital/templates'), true);
    assert.equal(categoryContains('digital', 'digitally'), false);
    assert.deepEqual(promotionSurfaces('BOTH'), ['HOME', 'CATEGORY']);

    const request = (start: string, end: string, extra: Partial<MarketplacePromotionRequest> = {}) =>
        ({
            startsAt: new Date(start),
            endsAt: new Date(end),
            status: 'APPROVED',
            ...extra,
        }) as MarketplacePromotionRequest;
    const reservations = [
        request('2026-09-30T00:00:00Z', '2026-10-01T00:00:00Z'),
        request('2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
    ];
    const from = new Date('2026-09-30T00:00:00Z');
    const to = new Date('2026-10-02T00:00:00Z');
    assert.equal(maximumPromotionOverlap(reservations, from, to), 1, 'Adjacent periods may share a slot');
    assert.equal(
        maximumPromotionOverlap(
            [...reservations, request('2026-09-30T12:00:00Z', '2026-10-01T12:00:00Z')],
            from,
            to,
        ),
        2,
    );
    assert.equal(maximumPromotionOverlap(reservations, now, from), 0);
    const pending = request('2026-09-30T00:00:00Z', '2026-10-01T00:00:00Z', {
        status: 'PENDING_PAYMENT',
        paymentDueAt: new Date('2026-09-29T13:00:00Z'),
    });
    assert(reservationIsLive(pending, now));
    pending.paymentDueAt = now;
    assert(!reservationIsLive(pending, now));
    assert.equal(effectivePromotionStatus(pending, now), 'EXPIRED');
    assert(!reservationIsLive({ ...pending, status: 'PENDING_REVIEW' }, now));
    assert(!reservationIsLive({ ...pending, status: 'CANCELLED' }, now));
    assert(reservationIsLive({ ...pending, status: 'PAYMENT_SUBMITTED' }, now));
    assert.equal(
        effectivePromotionStatus(request('2026-09-28T00:00:00Z', now.toISOString()), now),
        'EXPIRED',
    );

    const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
    const runner = dataSource.createQueryRunner();
    const migration = new AddPaidMarketplacePromotions1788200000000();
    try {
        await runner.createTable(
            new Table({
                name: 'promotion_campaign',
                columns: [{ name: 'id', type: 'integer', isPrimary: true }],
            }),
        );
        await migration.up(runner);
        assert(await runner.hasColumn('promotion_campaign', 'maxPlacements'));
        for (const table of [
            'marketplace_promotion_rate',
            'marketplace_promotion_request',
            'marketplace_promotion_settings',
        ])
            assert(await runner.hasTable(table));
        const table = await runner.getTable('marketplace_promotion_request');
        assert(
            table?.indices.some(index => index.isUnique && index.columnNames.includes('paymentReference')),
        );
        assert(table?.findColumnByName('reviewedByUserId'));
        assert(table?.findColumnByName('paymentVerifiedByUserId'));
        assert.equal(table?.findColumnByName('productId')?.isNullable, true);
        const paymentsMigration = new AddPromotionPayments1788300000000();
        await paymentsMigration.up(runner);
        const paymentTable = await runner.getTable('marketplace_promotion_payment');
        assert(paymentTable?.uniques.some(key => key.columnNames.includes('checkoutSessionId')));
        assert(paymentTable?.findColumnByName('cardLast4'));
        assert(!paymentTable?.findColumnByName('cardNumber'));
        assert(!paymentTable?.findColumnByName('cvv'));
        await paymentsMigration.down(runner);
        await migration.down(runner);
        assert(!(await runner.hasTable('marketplace_promotion_request')));
        assert(!(await runner.hasColumn('promotion_campaign', 'maxPlacements')));
        console.log(
            'PASS: pricing precedence, category matching, slot overlap, deadlines, expiry, and migration round trip',
        );
    } finally {
        await runner.release();
        await dataSource.destroy();
    }
}

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
