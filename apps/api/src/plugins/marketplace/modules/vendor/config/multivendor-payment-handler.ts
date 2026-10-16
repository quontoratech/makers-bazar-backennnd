import { OrderType } from '@vendure/common/lib/generated-types';
import { LanguageCode, Order, PaymentMethodHandler, Permission, TransactionalConnection } from '@vendure/core';

import { MarketplaceRewardRedemption } from '../../review/entities/marketplace-reward-redemption.entity';
import { MarketplaceCouponRedemption } from '../../promotion/entities/marketplace-coupon-redemption.entity';
import { marketplaceOrderPaymentIsSettled } from '../../finance/order-earnings-policy';

let connection: TransactionalConnection;

/** Direct buying records a payable order. Only company receipt confirmation settles it. */
export const multivendorPaymentMethodHandler = new PaymentMethodHandler({
    code: 'marketplace-connected-payment-handler',
    description: [{ languageCode: LanguageCode.en, value: 'Marketplace direct purchase — company confirms payment' }],
    args: {},
    init(injector) { connection = injector.get(TransactionalConnection); },
    createPayment: async (ctx, order, amount) => {
        if (order.type === OrderType.Seller) {
            const sellerOrder = await connection.getRepository(ctx, Order).findOne({
                where: { id: order.id }, relations: ['aggregateOrder', 'aggregateOrder.payments'],
            });
            if (!sellerOrder?.aggregateOrder) throw new Error('Seller accounting requires a customer order');
            return {
                amount,
                state: marketplaceOrderPaymentIsSettled(sellerOrder) ? 'Settled' : 'Authorized',
                transactionId: `company-held:${order.code}`,
                metadata: { source: 'COMPANY_HELD_ACCOUNTING', customerOrderId: String(sellerOrder.aggregateOrder.id) },
            };
        }
        const rewards = await connection.getRepository(ctx, MarketplaceRewardRedemption).findOne({ where: { orderId: String(order.id), status: 'RESERVED' } });
        const coupon = await connection.getRepository(ctx, MarketplaceCouponRedemption).findOne({ where: { orderId: String(order.id), status: 'RESERVED' } });
        for (const reservation of [rewards, coupon]) {
            if (reservation && (reservation.customerUserId !== String(ctx.activeUserId)
                || reservation.currencyCode !== order.currencyCode || !Number.isSafeInteger(reservation.amount) || reservation.amount < 0)) {
                throw new Error('Payment discount reservation does not belong to this order');
            }
        }
        const discount = (rewards?.amount ?? 0) + (coupon?.amount ?? 0);
        if (discount > amount) throw new Error('Reserved discounts exceed the order amount');
        return {
            amount,
            state: 'Authorized',
            transactionId: `awaiting-company-receipt:${order.code}`,
            metadata: {
                source: 'MARKETPLACE_DIRECT_PURCHASE',
                collectionStatus: 'AWAITING_CONFIRMATION',
                customerPayableAmount: amount - discount,
                orderValue: amount,
                rewardAmount: rewards?.amount ?? 0,
                couponAmount: coupon?.amount ?? 0,
                couponFundingSource: coupon?.fundingSource ?? '',
            },
        };
    },
    settlePayment: async (ctx, order, payment) => {
        if (order.type === OrderType.Seller) {
            const seller = await connection.getRepository(ctx, Order).findOne({
                where: { id: order.id }, relations: ['aggregateOrder', 'aggregateOrder.payments'],
            });
            return seller && marketplaceOrderPaymentIsSettled(seller)
                ? { success: true }
                : { success: false, errorMessage: 'Company receipt must be confirmed on the customer order first' };
        }
        if (!ctx.userHasPermissions([Permission.SuperAdmin]) || !payment.metadata?.companyReceiptConfirmedAt
            || payment.metadata.companyReceiptConfirmedBy !== String(ctx.activeUserId)
            || !payment.metadata.companyReceiptReference) {
            return { success: false, errorMessage: 'Confirm the company receipt and amount from marketplace orders' };
        }
        return { success: true };
    },
});
