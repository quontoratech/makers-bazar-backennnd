import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { Channel, ID, isGraphQlErrorResult, Order, OrderService, Payment, Permission, RequestContext, TransactionalConnection } from '@vendure/core';

import { CONNECTED_PAYMENT_METHOD_CODE } from '../../../constants';
import { BookingService } from '../../booking/services/booking.service';
import { withPayoutTransaction } from '../../finance/payout-transaction';
import { MarketplaceRewardRedemption } from '../../review/entities/marketplace-reward-redemption.entity';
import { MarketplaceCouponRedemption } from '../../promotion/entities/marketplace-coupon-redemption.entity';
import { MarketplaceCommissionRuleService } from '../../finance/services/commission-rule.service';

@Injectable()
export class CompanyPaymentService {
    constructor(private connection: TransactionalConnection, private orders: OrderService, private bookings: BookingService,
        private commissions: MarketplaceCommissionRuleService) {}

    async confirmReceipt(ctx: RequestContext, orderId: ID, amount: number, referenceInput: string) {
        if (!ctx.activeUserId || !ctx.userHasPermissions([Permission.SuperAdmin])) throw new Error('Only company finance can confirm receipt');
        const reference = String(referenceInput ?? '').trim();
        if (!reference || reference.length > 160) throw new Error('Enter the company receipt or transfer reference (up to 160 characters)');
        if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Received amount must be a non-negative whole minor-unit amount');
        return withPayoutTransaction(this.connection, ctx, async ctx => {
            const order = await this.connection.getRepository(ctx, Order).findOne({
                where: { id: orderId }, relations: ['channels', 'payments', 'sellerOrders', 'sellerOrders.channels', 'sellerOrders.payments', 'sellerOrders.lines', 'sellerOrders.lines.productVariant'],
            });
            if (!order || order.type === OrderType.Seller || order.state === 'Cancelled' || order.active) {
                throw new Error('Choose a placed customer order awaiting company payment confirmation');
            }
            if (order.sellerOrders?.some(seller => ['CANCELLED', 'REJECTED', 'REFUNDED'].includes(String((seller.customFields as Record<string, unknown>).marketplaceStatus)))) {
                throw new Error('This order has cancelled items; reconcile the customer amount before confirming a receipt');
            }
            const payments = order.payments.filter(payment => payment.method === CONNECTED_PAYMENT_METHOD_CODE
                && (payment.state === 'Authorized' || payment.state === 'Settled' && !payment.metadata?.companyReceiptConfirmedAt));
            if (payments.length !== 1 || order.payments.some(payment => payment.metadata?.companyReceiptConfirmedAt)) {
                throw new Error('This order is already confirmed or has no pending direct purchase payment');
            }
            const payment = payments[0]!;
            const legacy = payment.metadata?.source !== 'MARKETPLACE_DIRECT_PURCHASE';
            let expectedAmount = payment.metadata?.customerPayableAmount;
            if (payment.metadata?.source !== 'MARKETPLACE_DIRECT_PURCHASE') {
                // Earlier direct purchases were marked settled by a mock adapter. Require real evidence,
                // and reconstruct the amount from server-side reservations instead of old client metadata.
                const reward = await this.connection.getRepository(ctx, MarketplaceRewardRedemption).findOne({ where: { orderId: String(order.id), status: 'APPLIED' } });
                const coupon = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).findOne({ where: { orderId: String(order.id), status: 'APPLIED' } });
                expectedAmount = Math.max(0, order.totalWithTax - (reward?.amount ?? 0) - (coupon?.amount ?? 0));
            }
            if (amount !== expectedAmount) throw new Error('Received amount must match the customer amount due');
            const repository = this.connection.getRepository(ctx, Payment);
            if (await repository.findOne({ where: { transactionId: reference, state: 'Settled' } })) {
                throw new Error('This receipt reference has already been used');
            }
            payment.transactionId = reference;
            payment.metadata = { ...payment.metadata, source: 'MARKETPLACE_DIRECT_PURCHASE', customerPayableAmount: expectedAmount,
                collectionStatus: 'CONFIRMED', companyReceiptReference: reference,
                companyReceiptAmount: amount, companyReceiptConfirmedAt: new Date().toISOString(), companyReceiptConfirmedBy: String(ctx.activeUserId) };
            await repository.save(payment, { reload: false });
            if (payment.state !== 'Settled') {
                // Super admins can open Payments from any channel. Vendure resolves a
                // payment method inside the active channel, so settle the aggregate
                // payment in the customer order's own channel rather than whichever
                // portal channel happens to be active in the admin session.
                const customerCtx = await this.contextForOrderChannel(ctx, order.channels ?? []);
                const settled = await this.orders.settlePayment(customerCtx, payment.id);
                if (isGraphQlErrorResult(settled)) throw new Error(settled.message);
            }
            for (const seller of order.sellerOrders ?? []) {
                const sellerCtx = await this.contextForSellerChannel(ctx, seller.channels ?? []);
                for (const accountingPayment of seller.payments.filter(item => item.state === 'Authorized')) {
                    const result = await this.orders.settlePayment(sellerCtx, accountingPayment.id);
                    if (isGraphQlErrorResult(result)) throw new Error(result.message);
                }
            }
            if (!legacy) await this.bookings.confirmForSellerOrders(ctx, order.sellerOrders ?? [], true);
            for (const seller of order.sellerOrders ?? []) {
                await this.commissions.createLedgerEntriesForSellerOrder(ctx, seller);
            }
            return { success: true, message: 'Company receipt confirmed. Vendor earnings remain subject to completion and the holding period.' };
        });
    }

    /**
     * Vendure payment lookups are channel-aware. Aggregate customer orders live on the
     * default channel, while each internal seller order lives on its vendor channel.
     * Preserve the transaction and authenticated administrator while switching only
     * the active channel for the seller accounting settlement.
     */
    private async contextForOrderChannel(ctx: RequestContext, channels: Channel[]) {
        const orderChannel = channels[0];
        if (!orderChannel || typeof ctx.copy !== 'function') return ctx;
        // Order relations contain a partial Channel without its default tax and
        // shipping zones. Payment settlement can transition/recalculate the order,
        // and Vendure's tax strategy reads those relations from ctx.channel.
        // Always reload the complete channel, even when its id already matches the
        // administrator's active channel.
        const completeChannel = await this.connection.getRepository(ctx, Channel).findOne({
            where: { id: orderChannel.id },
            relations: ['defaultShippingZone', 'defaultTaxZone'],
        });
        if (!completeChannel?.defaultTaxZone || !completeChannel.defaultShippingZone) {
            throw new Error('The order channel is missing its default tax or shipping zone');
        }
        const orderCtx = ctx.copy();
        // RequestContext.copy() and Vendure's nested transaction hooks copy only
        // enumerable properties. Keep `_channel` enumerable so payment settlement
        // retains the order channel through every internal context copy.
        (orderCtx as unknown as { _channel: Channel })._channel = completeChannel;
        return orderCtx;
    }

    private async contextForSellerChannel(ctx: RequestContext, channels: Channel[]) {
        const sellerChannel = channels.find(channel => String(channel.id) !== String(ctx.channelId)) ?? channels[0];
        return this.contextForOrderChannel(ctx, sellerChannel ? [sellerChannel] : []);
    }
}
