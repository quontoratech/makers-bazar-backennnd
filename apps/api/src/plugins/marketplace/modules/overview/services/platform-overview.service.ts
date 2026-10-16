import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { Order, Payment, Product, RequestContext, TransactionalConnection } from '@vendure/core';
import { In, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';

import { RoleApplication } from '../../applications/entities/role-application.entity';
import { MarketplacePayoutBatch } from '../../finance/entities/marketplace-payout-batch.entity';
import { MarketplaceCustomerRefund } from '../../finance/entities/marketplace-customer-refund.entity';
import { PayoutLedgerEntry } from '../../finance/entities/payout-ledger-entry.entity';
import { MarketplaceReport } from '../../report/entities/marketplace-report.entity';
import { MarketplaceRewardRedemption } from '../../review/entities/marketplace-reward-redemption.entity';
import { MarketplaceCouponRedemption } from '../../promotion/entities/marketplace-coupon-redemption.entity';
import { SupportCase } from '../../support/entities/support-case.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { PromotionFinanceService } from '../../promotion/services/promotion-finance.service';
import { marketplacePaymentIsCompanyConfirmed } from '../../finance/order-earnings-policy';

const reportingPeriodDays = 30;
const hour = 60 * 60 * 1000;
const closedOrderStatuses = new Set(['REJECTED', 'DELIVERED', 'FULFILLED', 'CANCELLED', 'REFUNDED']);
const disputeCategories = ['DISPUTE', 'CHARGEBACK', 'REFUND', 'PAYMENT', 'RETURN'];

interface PlatformMetric {
    count: number;
    amount: number;
    detail: string;
}

interface OperationalQueue {
    key: string;
    label: string;
    count: number;
    tone: 'success' | 'warning' | 'danger' | 'info';
    description: string;
    href: string;
    oldestAt?: Date;
}

@Injectable()
export class PlatformOverviewService {
    constructor(private connection: TransactionalConnection, private promotionFinance: PromotionFinanceService) {}

    async getOverview(ctx: RequestContext) {
        const generatedAt = new Date();
        const periodStart = new Date(generatedAt.getTime() - reportingPeriodDays * 24 * hour);
        const delayCandidateDate = new Date(generatedAt.getTime() - 24 * hour);

        const orderRepository = this.connection.getRepository(ctx, Order);
        const [
            periodOrders,
            delayedOrderCandidates,
            payments,
            periodLedgerEntries,
            payoutBatches,
            vendors,
            products,
            applications,
            supportCases,
            policyReports,
            customerRefunds,
            promotionSummary,
        ] = await Promise.all([
            orderRepository.createQueryBuilder('order')
                .leftJoinAndSelect('order.customer', 'customer')
                .where('order.type = :type', { type: OrderType.Seller })
                .andWhere('order.active = :active', { active: false })
                .andWhere('order.orderPlacedAt >= :periodStart', { periodStart })
                .getMany(),
            orderRepository.find({
                where: {
                    type: OrderType.Seller,
                    active: false,
                    orderPlacedAt: LessThanOrEqual(delayCandidateDate),
                },
                order: { orderPlacedAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, Payment).createQueryBuilder('payment')
                .leftJoinAndSelect('payment.order', 'paymentOrder')
                .where('payment.createdAt >= :periodStart', { periodStart })
                .andWhere('paymentOrder.type IN (:...customerOrderTypes)', {
                    customerOrderTypes: [OrderType.Aggregate, OrderType.Regular],
                })
                .getMany(),
            this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: {
                    createdAt: MoreThanOrEqual(periodStart),
                    beneficiaryType: 'VENDOR',
                    kind: In(['SALE', 'COMMISSION', 'PAYMENT_FEE']),
                },
            }),
            this.connection.getRepository(ctx, MarketplacePayoutBatch).find({ order: { createdAt: 'ASC' } }),
            this.connection.getRepository(ctx, VendorProfile).find(),
            this.connection.getRepository(ctx, Product).find(),
            this.connection.getRepository(ctx, RoleApplication).find({
                where: { role: 'VENDOR', status: In(['PENDING', 'UNDER_REVIEW']) },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, SupportCase).find({
                where: { status: In(['OPEN', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_VENDOR', 'ESCALATED']) },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, MarketplaceReport).find({
                where: { status: In(['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED']) },
                order: { createdAt: 'ASC' },
            }),
            this.connection.getRepository(ctx, MarketplaceCustomerRefund).find({ order: { createdAt: 'ASC' } }),
            this.promotionFinance.summary(ctx, periodStart, generatedAt),
        ]);

        const salesEntries = periodLedgerEntries.filter(entry => entry.kind === 'SALE' && entry.status !== 'REVERSED');
        const commissionEntries = periodLedgerEntries.filter(entry => ['COMMISSION', 'PAYMENT_FEE'].includes(entry.kind) && entry.status !== 'REVERSED');
        const commissionRevenue = -commissionEntries.reduce((total, entry) => total + entry.amount, 0);
        const paidCustomerRefunds = customerRefunds.filter(refund => refund.status === 'PAID'
            && refund.paidAt
            && refund.paidAt.getTime() >= periodStart.getTime());
        const unpaidCustomerRefunds = customerRefunds.filter(refund => refund.status === 'UNPAID');
        const paidCustomerRefundAmount = this.sumRefundAmounts(paidCustomerRefunds);
        const settledPayments = payments.filter(marketplacePaymentIsCompanyConfirmed);
        const settledPaymentAmount = settledPayments.reduce((total, payment) => total + payment.amount, 0);
        const settledPaymentOrderIds = [...new Set(settledPayments
            .map(payment => payment.order ? String(payment.order.id) : '')
            .filter(Boolean))];
        const appliedRewardRedemptions = settledPaymentOrderIds.length
            ? await this.connection.getRepository(ctx, MarketplaceRewardRedemption).find({
                where: {
                    orderId: In(settledPaymentOrderIds),
                    status: In(['APPLIED', 'PARTIALLY_REVERSED', 'REVERSED']),
                },
            })
            : [];
        const marketplaceRewardFunding = appliedRewardRedemptions.reduce(
            (total, redemption) => total + redemption.amount,
            0,
        );
        const appliedCouponRedemptions = settledPaymentOrderIds.length
            ? await this.connection.getRepository(ctx, MarketplaceCouponRedemption).find({
                where: {
                    orderId: In(settledPaymentOrderIds),
                    status: In(['APPLIED', 'PARTIALLY_REVERSED', 'REVERSED']),
                },
            })
            : [];
        const couponDiscounts = appliedCouponRedemptions.reduce((total, redemption) => total + redemption.amount, 0);
        const vendorCouponDiscounts = appliedCouponRedemptions
            .filter(redemption => redemption.fundingSource === 'VENDOR')
            .reduce((total, redemption) => total + redemption.amount, 0);
        const activeVendors = vendors.filter(vendor => vendor.status === 'APPROVED'
            && !vendor.paused
            && vendor.enforcementStatus !== 'REMOVED');
        const marketplaceProducts = products.filter(product => this.vendorProfileId(product));
        const liveListings = marketplaceProducts.filter(product => product.enabled);
        const listingApprovals = marketplaceProducts.filter(product => !product.enabled);
        const delayedOrders = delayedOrderCandidates.filter(order => this.isDelayedOrder(order, generatedAt));
        const failedPayouts = payoutBatches.filter(batch => batch.status === 'FAILED');
        const paidPayouts = payoutBatches.filter(batch => batch.status === 'PAID' && batch.processedAt
            && batch.processedAt.getTime() >= periodStart.getTime());
        const disputes = supportCases.filter(item => this.matchesAny(item.category, disputeCategories));
        const activeCustomerIds = new Set(periodOrders
            .map(order => order.customer ? String(order.customer.id) : '')
            .filter(Boolean));
        const queue: OperationalQueue[] = [
            {
                key: 'vendor-applications',
                label: 'Vendor applications',
                count: applications.length,
                tone: applications.length ? 'warning' : 'success',
                description: 'Pending or under-review vendor applications.',
                href: '/dashboard/super-admin/applications',
                oldestAt: applications[0]?.createdAt,
            },
            {
                key: 'product-approvals',
                label: 'Product approvals',
                count: listingApprovals.length,
                tone: listingApprovals.length ? 'warning' : 'success',
                description: 'Marketplace listings that are not yet published.',
                href: '/dashboard/super-admin/catalog',
                oldestAt: this.oldestDate(listingApprovals.map(item => item.createdAt)),
            },
            {
                key: 'delayed-orders',
                label: 'Delayed orders',
                count: delayedOrders.length,
                tone: delayedOrders.length ? 'danger' : 'success',
                description: 'Orders beyond the marketplace fulfilment SLA.',
                href: '/dashboard/super-admin/orders',
                oldestAt: this.oldestDate(delayedOrders.map(item => this.orderStatusDate(item))),
            },
            {
                key: 'payout-failures',
                label: 'Payout failures',
                count: failedPayouts.length,
                tone: failedPayouts.length ? 'danger' : 'success',
                description: 'Failed payout batches requiring finance action.',
                href: '/dashboard/super-admin/commission',
                oldestAt: this.oldestDate(failedPayouts.map(item => item.updatedAt)),
            },
            {
                key: 'customer-refunds',
                label: 'Customer refunds',
                count: unpaidCustomerRefunds.length,
                tone: unpaidCustomerRefunds.length ? 'warning' : 'success',
                description: 'Approved order refunds waiting for a manual customer transfer.',
                href: '/dashboard/super-admin/refunds',
                oldestAt: unpaidCustomerRefunds[0]?.createdAt,
            },
            {
                key: 'support-cases',
                label: 'Support cases',
                count: supportCases.length,
                tone: supportCases.some(item => item.priority === 'URGENT' || item.status === 'ESCALATED')
                    ? 'danger'
                    : supportCases.length ? 'warning' : 'success',
                description: 'Open, waiting, or escalated customer and vendor cases.',
                href: '/dashboard/super-admin/support',
                oldestAt: supportCases[0]?.createdAt,
            },
            {
                key: 'policy-alerts',
                label: 'Policy alerts',
                count: policyReports.length,
                tone: policyReports.some(item => item.status === 'ACTION_REQUIRED')
                    ? 'danger'
                    : policyReports.length ? 'warning' : 'success',
                description: 'Trust and safety reports awaiting a decision.',
                href: '/dashboard/super-admin/reports',
                oldestAt: policyReports[0]?.createdAt,
            },
        ];

        const metrics: Record<string, PlatformMetric> = {
            promotionRevenue: { count: promotionSummary.verifiedCount, amount: promotionSummary.netRevenue,
                detail: 'Verified promotion payments, less refunds, in this period.' },
            commissionRevenue: { count: commissionEntries.length, amount: commissionRevenue,
                detail: 'Marketplace commission and fees from non-reversed sales ledger entries.' },
            marketplaceEarnings: { count: commissionEntries.length + promotionSummary.verifiedCount,
                amount: commissionRevenue + promotionSummary.netRevenue,
                detail: 'Commission and fees plus net promotion income. Excludes vendor sales and payout liabilities.' },
            sales: {
                count: new Set(salesEntries.map(entry => entry.orderId ?? String(entry.id))).size,
                amount: this.sumAmounts(salesEntries),
                detail: 'Completed marketplace product sales.',
            },
            orders: {
                count: periodOrders.length,
                amount: 0,
                detail: `${delayedOrders.length} currently beyond fulfilment SLA.`,
            },
            activeCustomers: {
                count: activeCustomerIds.size,
                amount: 0,
                detail: 'Customers who placed an order in this period.',
            },
            activeVendors: {
                count: activeVendors.length,
                amount: 0,
                detail: 'Approved, unpaused vendor accounts.',
            },
            listings: {
                count: liveListings.length,
                amount: 0,
                detail: `${listingApprovals.length} marketplace listings await publication.`,
            },
            payments: {
                count: settledPayments.length,
                amount: settledPaymentAmount - marketplaceRewardFunding - couponDiscounts - paidCustomerRefundAmount,
                detail: 'Net customer cash retained after coin and coupon discounts and paid refunds, including delivery.',
            },
            totalPayments: {
                count: settledPayments.length,
                amount: settledPaymentAmount - vendorCouponDiscounts,
                detail: 'Customer cash plus marketplace-funded coin and coupon value before refunds, including delivery.',
            },
            refunds: {
                count: paidCustomerRefunds.length,
                amount: paidCustomerRefundAmount,
                detail: 'Customer refund transfers marked paid by finance.',
            },
            refundLiability: {
                count: unpaidCustomerRefunds.length,
                amount: this.sumRefundAmounts(unpaidCustomerRefunds),
                detail: 'Unpaid customer refunds awaiting a manual transfer.',
            },
            disputes: {
                count: disputes.length,
                amount: disputes.reduce((total, item) => total + Math.abs(item.financialAdjustment ?? 0), 0),
                detail: 'Open payment, return, refund, or chargeback cases.',
            },
            payouts: {
                count: paidPayouts.length,
                amount: paidPayouts.reduce((total, batch) => total + Math.abs(batch.totalAmount), 0),
                detail: 'Vendor payout batches marked paid.',
            },
        };

        return {
            generatedAt,
            periodStart,
            periodEnd: generatedAt,
            periodDays: reportingPeriodDays,
            currencyCode: 'PKR',
            metrics,
            queues: queue,
            totalQueueItems: queue.reduce((total, item) => total + item.count, 0),
        };
    }

    private vendorProfileId(product: Product) {
        return String((product.customFields as Record<string, unknown> | undefined)?.vendorProfileId ?? '').trim();
    }

    private orderStatus(order: Order) {
        const stored = String((order.customFields as Record<string, unknown> | undefined)?.marketplaceStatus ?? 'PENDING')
            .trim()
            .toUpperCase();
        if (stored === 'PLACED') return 'PENDING';
        if (stored === 'READY_FOR_DISPATCH') return 'PACKED';
        if (stored === 'SHIPPED') return 'DISPATCHED';
        return stored;
    }

    private isDelayedOrder(order: Order, now: Date) {
        const status = this.orderStatus(order);
        if (closedOrderStatuses.has(status)) return false;
        const statusAge = now.getTime() - this.orderStatusDate(order).getTime();
        if (status === 'PENDING') return statusAge >= 24 * hour;
        if (['DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED'].includes(status)) return statusAge >= 7 * 24 * hour;
        return statusAge >= 72 * hour;
    }

    private orderStatusDate(order: Order) {
        const rawDate = (order.customFields as Record<string, unknown> | undefined)?.marketplaceStatusUpdatedAt;
        const statusDate = rawDate ? new Date(String(rawDate)) : undefined;
        if (statusDate && !Number.isNaN(statusDate.getTime())) return statusDate;
        return order.orderPlacedAt ?? order.updatedAt;
    }

    private matchesAny(value: string, candidates: string[]) {
        const normalized = value.trim().toUpperCase();
        return candidates.some(candidate => normalized.includes(candidate));
    }

    private sumAmounts(entries: PayoutLedgerEntry[]) {
        return entries.reduce((total, entry) => total + Math.abs(entry.amount), 0);
    }

    private sumRefundAmounts(refunds: MarketplaceCustomerRefund[]) {
        return refunds.reduce((total, refund) => total + refund.cashAmount, 0);
    }

    private oldestDate(dates: Date[]) {
        return dates.reduce<Date | undefined>((oldest, date) => {
            if (!oldest || date.getTime() < oldest.getTime()) return date;
            return oldest;
        }, undefined);
    }
}
