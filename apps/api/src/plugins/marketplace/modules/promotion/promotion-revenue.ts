import type { MarketplacePromotionPayment } from './entities/marketplace-promotion-payment.entity';

export function summarizePromotionPayments(payments: MarketplacePromotionPayment[], from?: Date, to?: Date) {
    const received = payments.filter(
        payment =>
            payment.verifiedAt &&
            ['VERIFIED', 'REFUNDED'].includes(payment.status) &&
            (!from || payment.verifiedAt >= from) &&
            (!to || payment.verifiedAt <= to),
    );
    const verifiedAmount = received.reduce((sum, payment) => sum + payment.amount, 0);
    const refundedAmount = received.reduce((sum, payment) => sum + payment.refundedAmount, 0);
    const pending = payments.filter(payment => ['CHECKOUT_OPEN', 'SUBMITTED'].includes(payment.status));
    return {
        verifiedCount: received.length,
        verifiedAmount,
        refundedAmount,
        netRevenue: verifiedAmount - refundedAmount,
        pendingCount: pending.length,
        pendingAmount: pending.reduce((sum, payment) => sum + payment.amount, 0),
        currencyCode: 'PKR',
    };
}
