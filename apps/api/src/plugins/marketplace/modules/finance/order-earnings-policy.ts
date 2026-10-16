import type { Order, Payment } from '@vendure/core';
import { configuredReturnWindowDays } from '../support/return-policy';

export function marketplacePaymentIsCompanyConfirmed(payment: Payment): boolean {
    return payment.state === 'Settled'
        && payment.metadata?.source === 'MARKETPLACE_DIRECT_PURCHASE'
        && payment.metadata.collectionStatus === 'CONFIRMED'
        && !!payment.metadata.companyReceiptReference
        && !!payment.metadata.companyReceiptConfirmedAt;
}

/** A seller's accounting payment is not evidence that the company collected money. */
export function marketplaceOrderPaymentIsSettled(order: Order): boolean {
    const customerOrder = order.aggregateOrder ?? order;
    const total = Number(customerOrder.totalWithTax);
    const settled = (customerOrder.payments ?? []).filter(marketplacePaymentIsCompanyConfirmed);
    const collected = settled.reduce((sum, payment) => sum + payment.amount, 0);
    const refunded = settled.flatMap(payment => payment.refunds ?? [])
        .filter(refund => refund.state !== 'Failed')
        .reduce((sum, refund) => sum + refund.total, 0);
    return Number.isSafeInteger(total) && total >= 0
        && settled.length > 0 && collected >= total
        && (total === 0 || collected > refunded);
}

/** Returns and disputed deliveries remain held until their outcome is known. */
export function marketplaceOrderCanReleaseEarnings(order: Order): boolean {
    const status = String((order.customFields as Record<string, unknown> | undefined)?.marketplaceStatus ?? '');
    return ['DELIVERED', 'FULFILLED'].includes(status) && marketplaceOrderPaymentIsSettled(order);
}

export function marketplaceEarningsAvailableAt(order: Order, holdingPeriodDays: number, now = new Date()): Date {
    const fields = order.customFields as Record<string, unknown> | undefined;
    const completedValue = fields?.marketplaceDeliveredAt ?? fields?.marketplaceStatusUpdatedAt;
    // Older orders may predate the completion custom fields; use their last persisted
    // update so release checks do not restart the hold on every dashboard refresh.
    const completedAt = completedValue ? new Date(String(completedValue)) : (order.updatedAt ?? now);
    const anchor = Number.isFinite(completedAt.getTime()) ? completedAt.getTime() : now.getTime();
    // Keep the company's funds available through the customer's appeal window.
    const days = Math.max(
        Number.isFinite(holdingPeriodDays) ? Math.max(0, holdingPeriodDays) : 7,
        configuredReturnWindowDays(),
    );
    return new Date(anchor + days * 86_400_000);
}
