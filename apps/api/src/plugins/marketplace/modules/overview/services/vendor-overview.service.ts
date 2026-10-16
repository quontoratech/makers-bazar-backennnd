import { Injectable } from '@nestjs/common';
import { RequestContext, TransactionalConnection } from '@vendure/core';

import { MarketplaceBooking } from '../../booking/entities/booking.entity';
import { MarketplaceCatalogService } from '../../catalog/services/marketplace-catalog.service';
import { MarketplaceCommissionRuleService } from '../../finance/services/commission-rule.service';
import { PayoutLedgerEntry } from '../../finance/entities/payout-ledger-entry.entity';
import { summarizeVendorLedger } from '../../finance/ledger-summary';
import { MarketplaceOrderService } from '../../order/services/marketplace-order.service';
import { SupportCase } from '../../support/entities/support-case.entity';
import { VendorService } from '../../vendor/services/vendor.service';
import { MarketplaceProductView } from '../entities/marketplace-product-view.entity';

const pendingOrderStatuses = new Set([
    'PENDING',
    'CONFIRMED',
    'PROCESSING',
    'PACKED',
    'PARTIALLY_FULFILLED',
    'OUT_OF_STOCK_EXCEPTION',
    'DISPATCHED',
    'OUT_FOR_DELIVERY',
    'DELIVERY_FAILED',
    'RETURN_REQUESTED',
    'RETURN_APPROVED',
]);

const excludedSalesStatuses = new Set(['REJECTED', 'CANCELLED', 'REFUNDED']);
const returnOrderStatuses = new Set(['RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED']);
const closedCaseStatuses = new Set(['RESOLVED', 'CLOSED']);
const completedBookingStatuses = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'REFUNDED']);

@Injectable()
export class VendorOverviewService {
    constructor(
        private connection: TransactionalConnection,
        private vendorService: VendorService,
        private marketplaceCatalogService: MarketplaceCatalogService,
        private marketplaceOrderService: MarketplaceOrderService,
        private marketplaceCommissionRuleService: MarketplaceCommissionRuleService,
    ) {}

    async recordProductView(ctx: RequestContext, productId: string, sessionId: string) {
        const cleanSessionId = sessionId.trim();
        if (!/^[a-zA-Z0-9_-]{8,100}$/.test(cleanSessionId)) {
            throw new Error('Invalid product view session');
        }

        const product = await this.marketplaceCatalogService.findPublicProductById(ctx, productId);
        if (!product) throw new Error('Product not found');

        const viewedOn = new Date().toISOString().slice(0, 10);
        const repository = this.connection.getRepository(ctx, MarketplaceProductView);
        const where = { productId: String(product.id), sessionId: cleanSessionId, viewedOn };
        const existing = await repository.findOne({ where });
        if (!existing) {
            try {
                await repository.save(new MarketplaceProductView({
                    vendorProfileId: String(product.vendorProfileId),
                    productId: String(product.id),
                    sessionId: cleanSessionId,
                    viewedOn,
                }));
            } catch (error) {
                const duplicate = await repository.findOne({ where });
                if (!duplicate) throw error;
            }
        }

        return { success: true, message: 'Product view recorded' };
    }

    async getOverview(ctx: RequestContext) {
        const vendor = await this.vendorService.findMine(ctx);
        const [orders, catalog, bookings, supportCases, payouts, productViews] = await Promise.all([
            this.marketplaceOrderService.listVendorOrdersForOverview(ctx),
            this.marketplaceCatalogService.listVendorProducts(ctx),
            this.connection.getRepository(ctx, MarketplaceBooking).find({
                where: { vendorProfileId: String(vendor.id) },
                order: { startsAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, SupportCase).find({
                where: { vendorProfileId: String(vendor.id) },
                order: { updatedAt: 'DESC' },
            }).then(cases => cases.filter(item => item.category !== 'RETURN_DISPUTE')),
            this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: { beneficiaryType: 'VENDOR', beneficiaryId: String(vendor.id) },
                order: { createdAt: 'DESC' },
            }),
            this.connection.getRepository(ctx, MarketplaceProductView).find({
                where: { vendorProfileId: String(vendor.id) },
                order: { createdAt: 'ASC' },
            }),
        ]);

        const salesOrders = orders.filter(order => !excludedSalesStatuses.has(order.status));
        const ledgerSummary = summarizeVendorLedger(payouts);
        const grossSales = ledgerSummary.grossSales;
        const ledgeredSales = ledgerSummary.ledgeredSales;
        const averageOrderValue = ledgeredSales ? Math.round(grossSales / ledgeredSales) : 0;
        const cancelledOrders = orders.filter(order => order.status === 'CANCELLED');
        const refundedOrders = orders.filter(order => order.status === 'REFUNDED');
        const returnOrders = orders.filter(order => returnOrderStatuses.has(order.status));
        const cancelledValue = cancelledOrders.reduce((total, order) => total + order.subTotal, 0);
        const refundAmount = refundedOrders.reduce((total, order) => total + order.subTotal, 0);
        const estimatedCommission = ledgerSummary.commission;
        const estimatedFees = ledgerSummary.fees;
        const estimatedEarnings = ledgerSummary.netEarnings;
        const currentBaseCommissionPercent = await this.marketplaceCommissionRuleService.currentBaseCommissionPercent(ctx, vendor);
        const effectiveCommissionPercent = grossSales
            ? Math.round(estimatedCommission / grossSales * 10_000) / 100
            : currentBaseCommissionPercent;
        const pendingOrders = orders.filter(order => pendingOrderStatuses.has(order.status));
        const stockAlerts = catalog.items
            .filter(product => product.enabled && !['DIGITAL', 'SERVICE'].includes(product.productType))
            .flatMap(product => product.variants
                .filter(variant => variant.enabled)
                .map(variant => ({
                    productId: product.id,
                    productName: product.name,
                    productSlug: product.slug,
                    variantId: variant.id,
                    variantName: variant.name,
                    sku: variant.sku,
                    availableStock: Math.max(0, variant.stockOnHand - variant.stockAllocated),
                    lowStockThreshold: variant.lowStockThreshold,
                })))
            .filter(item => item.availableStock <= item.lowStockThreshold)
            .sort((left, right) => left.availableStock - right.availableStock)
            .map(item => ({
                ...item,
                status: item.availableStock === 0 ? 'OUT_OF_STOCK' : 'LOW_STOCK',
            }));

        const now = Date.now();
        const upcomingBookings = bookings
            .filter(booking => !completedBookingStatuses.has(booking.status) && booking.endsAt.getTime() >= now)
            .slice(0, 5);
        const pendingBookings = bookings.filter(booking => booking.status === 'PENDING');
        const openCases = supportCases.filter(item => !closedCaseStatuses.has(item.status));
        const returnCases = supportCases.filter(item => this.matchesCategory(item.category, ['RETURN']));
        const disputeCases = supportCases.filter(item => this.matchesCategory(item.category, ['DISPUTE', 'CHARGEBACK', 'MISCONDUCT']));

        const returnedReferences = new Set(returnOrders.map(order => `order:${order.id}`));
        for (const item of returnCases) {
            returnedReferences.add(item.orderId ? `order:${item.orderId}` : `case:${item.id}`);
        }

        const viewsByProduct = new Map<string, MarketplaceProductView[]>();
        for (const view of productViews) {
            const views = viewsByProduct.get(view.productId) ?? [];
            views.push(view);
            viewsByProduct.set(view.productId, views);
        }

        const salesByProduct = new Map<string, ProductSalesSummary>();
        const conversionOrderIds = new Set<string>();
        for (const order of salesOrders) {
            const placedAt = new Date(order.placedAt ?? order.createdAt).getTime();
            const undiscountedLineTotal = order.lines.reduce((total, line) => total + line.lineTotal, 0);
            for (const line of order.lines) {
                if (!line.productId) continue;
                const summary = salesByProduct.get(line.productId) ?? {
                    unitsSold: 0,
                    revenue: 0,
                    orderIds: new Set<string>(),
                    conversionOrderIds: new Set<string>(),
                };
                summary.unitsSold += line.quantity;
                summary.revenue += undiscountedLineTotal
                    ? Math.round(order.subTotal * line.lineTotal / undiscountedLineTotal)
                    : 0;
                summary.orderIds.add(String(order.id));
                const firstViewAt = viewsByProduct.get(line.productId)?.[0]?.createdAt.getTime();
                if (firstViewAt != null && placedAt >= firstViewAt) {
                    summary.conversionOrderIds.add(String(order.id));
                    conversionOrderIds.add(String(order.id));
                }
                salesByProduct.set(line.productId, summary);
            }
        }

        const listingPerformance = catalog.items.map(product => {
            const sales = salesByProduct.get(product.id);
            const views = viewsByProduct.get(product.id)?.length ?? 0;
            const trackedVariants = product.variants.filter(variant => variant.enabled);
            const availableStock = trackedVariants.reduce(
                (total, variant) => total + Math.max(0, variant.stockOnHand - variant.stockAllocated),
                0,
            );
            const stockStatus = ['DIGITAL', 'SERVICE'].includes(product.productType)
                ? 'NOT_TRACKED'
                : trackedVariants.length === 0 || availableStock === 0
                    ? 'OUT_OF_STOCK'
                    : trackedVariants.some(variant => Math.max(0, variant.stockOnHand - variant.stockAllocated) <= variant.lowStockThreshold)
                        ? 'LOW_STOCK'
                        : 'IN_STOCK';
            return {
                productId: product.id,
                productName: product.name,
                productSlug: product.slug,
                unitsSold: sales?.unitsSold ?? 0,
                orderCount: sales?.orderIds.size ?? 0,
                revenue: sales?.revenue ?? 0,
                views,
                conversionRate: views ? this.percentage(sales?.conversionOrderIds.size ?? 0, views) : null,
                availableStock,
                stockStatus,
                enabled: product.enabled,
            };
        });

        const enabledListings = listingPerformance.filter(product => product.enabled);
        const bestLimit = Math.min(5, Math.max(1, Math.ceil(enabledListings.length / 2)));
        const bestPerformingListings = [...enabledListings]
            .sort((left, right) => right.revenue - left.revenue
                || right.unitsSold - left.unitsSold
                || right.orderCount - left.orderCount
                || right.views - left.views
                || left.productName.localeCompare(right.productName))
            .slice(0, bestLimit);
        const bestProductIds = new Set(bestPerformingListings.map(product => product.productId));
        const lowPerformingListings = [...enabledListings]
            .filter(product => !bestProductIds.has(product.productId))
            .sort((left, right) => left.revenue - right.revenue
                || left.unitsSold - right.unitsSold
                || (left.conversionRate ?? 0) - (right.conversionRate ?? 0)
                || right.views - left.views
                || left.productName.localeCompare(right.productName))
            .slice(0, 5);

        const availablePayout = this.availablePayout(payouts);
        const pendingPayout = this.pendingPayout(payouts);
        const paidPayout = payouts
            .filter(entry => entry.kind === 'PAYOUT' && entry.status === 'PAID')
            .reduce((total, entry) => total + Math.abs(entry.amount), 0);
        const currencyCode = 'PKR';
        const reviewSummary = vendor as VendorProfileWithReviewSummary;

        return {
            metrics: {
                grossSales,
                ledgeredSales,
                orders: orders.length,
                averageOrderValue,
                productViews: productViews.length,
                conversionRate: productViews.length
                    ? this.percentage(conversionOrderIds.size, productViews.length)
                    : null,
                pendingOrders: pendingOrders.length,
                stockAlerts: stockAlerts.length,
                stockOuts: stockAlerts.filter(item => item.status === 'OUT_OF_STOCK').length,
                bookings: bookings.length,
                pendingBookings: pendingBookings.length,
                cancelledOrders: cancelledOrders.length,
                cancellationRate: this.percentage(cancelledOrders.length, orders.length),
                cancelledValue,
                returns: returnedReferences.size,
                returnRate: this.percentage(returnedReferences.size, orders.length),
                refundedOrders: refundedOrders.length,
                refundRate: this.percentage(refundedOrders.length, orders.length),
                refundAmount,
                disputes: disputeCases.length,
                openCases: openCases.length,
                ratingAverage: reviewSummary.ratingAverage ?? null,
                ratingCount: reviewSummary.ratingCount ?? 0,
                estimatedCommission,
                estimatedFees,
                estimatedEarnings,
                pendingPayout,
                availablePayout,
                paidPayout,
                payoutStatus: this.payoutStatus(payouts),
                payoutSchedule: vendor.payoutSchedule,
                commissionPercent: currentBaseCommissionPercent,
                effectiveCommissionPercent,
                currencyCode,
            },
            pendingActionCount: pendingOrders.length + pendingBookings.length + stockAlerts.length + openCases.length,
            recentOrders: orders.slice(0, 5),
            stockAlerts: stockAlerts.slice(0, 8),
            upcomingBookings,
            openCases: openCases.slice(0, 5),
            recentPayouts: payouts.slice(0, 5),
            bestPerformingListings,
            lowPerformingListings,
        };
    }

    private percentage(value: number, total: number) {
        if (!total) return 0;
        return Math.round(value / total * 1000) / 10;
    }

    private matchesCategory(category: string, values: string[]) {
        const normalized = category.trim().toUpperCase();
        return values.some(value => normalized.includes(value));
    }

    private sumPayouts(entries: PayoutLedgerEntry[], statuses: PayoutLedgerEntry['status'][]) {
        const allowed = new Set(statuses);
        return entries
            .filter(entry => allowed.has(entry.status)
                && entry.kind !== 'PAYOUT'
                && entry.metadata?.accountingEffect !== 'INFORMATIONAL')
            .reduce((total, entry) => total + entry.amount, 0);
    }

    private availablePayout(entries: PayoutLedgerEntry[]) {
        const availableEarnings = this.sumPayouts(entries, ['AVAILABLE', 'APPROVED']);
        const committedOrPaid = entries
            .filter(entry => entry.kind === 'PAYOUT'
                && ['AVAILABLE', 'PENDING', 'APPROVED', 'PAID'].includes(entry.status))
            .reduce((total, entry) => total + entry.amount, 0);
        return Math.max(0, availableEarnings + committedOrPaid);
    }

    private pendingPayout(entries: PayoutLedgerEntry[]) {
        const heldEarnings = this.sumPayouts(entries, ['PENDING', 'ON_HOLD']);
        const payoutBatches = entries
            .filter(entry => entry.kind === 'PAYOUT' && ['PENDING', 'APPROVED'].includes(entry.status))
            .reduce((total, entry) => total + Math.abs(entry.amount), 0);
        return Math.max(0, heldEarnings + payoutBatches);
    }

    private payoutStatus(entries: PayoutLedgerEntry[]) {
        const activeEntries = entries.filter(entry => entry.status !== 'REVERSED');
        if (activeEntries.some(entry => entry.kind === 'PAYOUT' && entry.status === 'FAILED')) return 'FAILED';
        if (activeEntries.some(entry => entry.kind === 'PAYOUT' && entry.status === 'APPROVED')) return 'APPROVED';
        if (activeEntries.some(entry => entry.kind === 'PAYOUT' && entry.status === 'PENDING')) return 'PENDING';
        if (this.availablePayout(activeEntries) > 0) return 'AVAILABLE';
        if (activeEntries.some(entry => entry.kind !== 'PAYOUT' && ['PENDING', 'ON_HOLD'].includes(entry.status))) return 'PENDING';
        if (activeEntries.some(entry => entry.kind === 'PAYOUT' && entry.status === 'PAID')) return 'PAID';
        return 'NO_ACTIVITY';
    }
}

interface VendorProfileWithReviewSummary {
    ratingAverage?: number | null;
    ratingCount?: number;
}

interface ProductSalesSummary {
    unitsSold: number;
    revenue: number;
    orderIds: Set<string>;
    conversionOrderIds: Set<string>;
}
