import { Injectable } from '@nestjs/common';
import { OrderLineInput, OrderType } from '@vendure/common/lib/generated-types';
import {
    Allocation,
    Cancellation,
    EventBus,
    ForbiddenError,
    Order,
    Permission,
    Release,
    RequestContext,
    Sale,
    StockMovementService,
    TransactionalConnection,
    TranslatorService,
} from '@vendure/core';
import { In } from 'typeorm';

import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { MarketplaceCommissionRuleService } from '../../finance/services/commission-rule.service';
import { marketplaceOrderPaymentIsSettled } from '../../finance/order-earnings-policy';
import { MarketplaceBooking } from '../../booking/entities/booking.entity';
import { releaseBookingCapacity } from '../../booking/booking-capacity';
import { withPayoutTransaction } from '../../finance/payout-transaction';
import { MarketplacePurchaseRewardService } from '../../review/services/marketplace-purchase-reward.service';
import { MarketplaceRewardRedemptionService } from '../../review/services/marketplace-reward-redemption.service';
import { customerFundedProductAmount } from '../../review/services/reward-redemption-policy';
import { MarketplaceDigitalFile } from '../../catalog/entities/marketplace-digital-file.entity';
import { MarketplaceChatMessage } from '../../chat/entities/marketplace-chat-message.entity';
import { MarketplaceListingQuote } from '../../chat/entities/marketplace-listing-quote.entity';
import { marketplaceOrderChatEnabled } from '../../chat/chat-policy';
import { MarketplaceChatService } from '../../chat/services/marketplace-chat.service';
import { MarketplaceCouponService } from '../../promotion/services/marketplace-coupon.service';
import { MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import {
    MarketplaceOrderFilterInput,
    MarketplaceOrderLineAdjustmentInput,
    UpdateMarketplaceOrderStatusInput,
} from '../dto/marketplace-order.inputs';
import { MarketplaceOrderStatusEvent } from '../events/marketplace-order-status.event';
import {
    marketplaceOrderAvailableStatuses,
    marketplaceOrderPrintableDocuments,
    marketplaceOrderStatusLabel,
    marketplaceOrderStatusMessage,
    resolveMarketplaceOrderFulfillmentType,
} from '../order-workflow-policy';
import { configuredReturnWindowDays, evaluateReturnWindow } from '../../support/return-policy';

const sellerStatuses = [
    'PENDING',
    'CONFIRMED',
    'REJECTED',
    'PROCESSING',
    'PACKED',
    'PARTIALLY_FULFILLED',
    'OUT_OF_STOCK_EXCEPTION',
    'DISPATCHED',
    'OUT_FOR_DELIVERY',
    'DELIVERY_FAILED',
    'DELIVERED',
    'FULFILLED',
    'CANCELLED',
    'RETURN_REQUESTED',
    'RETURN_APPROVED',
    'RETURN_REJECTED',
    'RETURNED',
    'REFUNDED',
] as const;

const legacySellerStatuses: Record<string, string> = {
    PLACED: 'PENDING',
    READY_FOR_DISPATCH: 'PACKED',
    SHIPPED: 'DISPATCHED',
};

type SellerStatus = typeof sellerStatuses[number];
type TerminalSellerStatus = Extract<SellerStatus, 'REJECTED' | 'CANCELLED' | 'REFUNDED'>;

const decisionSlaHours = 24;

const terminalStatuses = new Set<SellerStatus>(['REJECTED', 'CANCELLED', 'REFUNDED']);
const isTerminalSellerStatus = (status: string): status is TerminalSellerStatus =>
    terminalStatuses.has(status as SellerStatus);
const statusesRequiringReason = new Set<SellerStatus>([
    'REJECTED',
    'CANCELLED',
    'RETURN_REJECTED',
    'RETURNED',
    'OUT_OF_STOCK_EXCEPTION',
]);
const statusNotesEnabled = new Set<SellerStatus>([
    'CONFIRMED',
    'PROCESSING',
    'PACKED',
    'REJECTED',
    'CANCELLED',
    'RETURN_REQUESTED',
    'RETURN_APPROVED',
    'RETURN_REJECTED',
    'RETURNED',
    'REFUNDED',
    'PARTIALLY_FULFILLED',
    'OUT_OF_STOCK_EXCEPTION',
    'FULFILLED',
]);
const lineExceptionStatuses = new Set<SellerStatus>([
    'PARTIALLY_FULFILLED',
    'OUT_OF_STOCK_EXCEPTION',
]);
const adminReturnStatuses = new Set<SellerStatus>([
    'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED', 'REFUNDED',
]);

interface OrderLineMovementTotals {
    allocatedByLineId: Map<string, number>;
    releasedByLineId: Map<string, number>;
    soldByLineId: Map<string, number>;
    cancelledByLineId: Map<string, number>;
}

interface MarketplaceOrderCustomerNote {
    vendorId: string;
    vendorName: string;
    vendorSlug?: string;
    note: string;
}

@Injectable()
export class MarketplaceOrderService {
    constructor(
        private connection: TransactionalConnection,
        private translator: TranslatorService,
        private eventBus: EventBus,
        private stockMovementService: StockMovementService,
        private marketplaceCommissionRuleService: MarketplaceCommissionRuleService,
        private marketplacePurchaseRewardService: MarketplacePurchaseRewardService,
        private marketplaceRewardRedemptionService: MarketplaceRewardRedemptionService,
        private marketplaceCouponService: MarketplaceCouponService,
        private marketplaceChatService: MarketplaceChatService,
    ) {}

    async listCustomerOrders(ctx: RequestContext, options?: MarketplaceListOptions) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        const orders = await this.baseQuery(ctx)
            .where('customerUser.id = :activeUserId', { activeUserId: ctx.activeUserId })
            .andWhere('order.active = :active', { active: false })
            .andWhere('order.type IN (:...types)', { types: [OrderType.Aggregate, OrderType.Regular] })
            .orderBy('order.orderPlacedAt', 'DESC')
            .getMany();
        return this.paginate(await this.mapOrders(ctx, orders), options);
    }

    async listCustomerSellerOrders(ctx: RequestContext, options?: MarketplaceListOptions) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        const orders = await this.baseQuery(ctx)
            .where('customerUser.id = :activeUserId', { activeUserId: ctx.activeUserId })
            .andWhere('order.active = :active', { active: false })
            .andWhere('order.type = :type', { type: OrderType.Seller })
            .orderBy('order.orderPlacedAt', 'DESC')
            .getMany();
        return this.paginate(await this.mapOrders(ctx, orders), options);
    }

    async listVendorOrders(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        filter?: MarketplaceOrderFilterInput,
    ) {
        const vendor = await this.activeVendor(ctx);
        const orders = await this.vendorOrders(ctx, vendor.channelId!);
        return this.paginate(this.filter(await this.mapOrders(ctx, orders), filter), options);
    }

    async listVendorOrdersForOverview(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor?.channelId) throw new ForbiddenError();
        const orders = await this.vendorOrders(ctx, vendor.channelId);
        return this.mapOrders(ctx, orders);
    }

    async listVendorWorkshopOrders(ctx: RequestContext) {
        const vendor = await this.activeVendor(ctx);
        return (await this.mapOrders(ctx, await this.vendorOrders(ctx, vendor.channelId!)))
            .filter(order => order.fulfillmentType === 'WORKSHOP');
    }

    async listAdminOrders(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        filter?: MarketplaceOrderFilterInput,
    ) {
        const orders = await this.baseQuery(ctx)
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .orderBy('order.orderPlacedAt', 'DESC')
            .getMany();
        return this.paginate(this.filter(await this.mapOrders(ctx, orders), filter), options);
    }

    async updateVendorStatus(ctx: RequestContext, input: UpdateMarketplaceOrderStatusInput) {
        return withPayoutTransaction(this.connection, ctx, ctx => this.updateVendorStatusLocked(ctx, input));
    }

    private async updateVendorStatusLocked(ctx: RequestContext, input: UpdateMarketplaceOrderStatusInput) {
        const vendor = await this.activeVendor(ctx);
        const order = await this.baseQuery(ctx)
            .where('order.id = :orderId', { orderId: input.orderId })
            .andWhere('order.type = :type', { type: OrderType.Seller })
            .andWhere('orderChannels.id = :channelId', { channelId: vendor.channelId })
            .getOne();
        if (!order) throw new ForbiddenError();

        return this.transitionSellerStatusLocked(ctx, order, vendor, input, false);
    }

    /** Return decisions and financial reversals are reserved for the super-admin case workflow. */
    async transitionReturnStatus(ctx: RequestContext, orderId: string, status: SellerStatus, note: string) {
        if (!ctx.activeUserId || !ctx.userHasPermissions([Permission.SuperAdmin])) throw new ForbiddenError();
        if (!adminReturnStatuses.has(status) && status !== 'FULFILLED') throw new Error('This is not a return status');
        return withPayoutTransaction(this.connection, ctx, async transactionCtx => {
            const order = await this.baseQuery(transactionCtx)
                .where('order.id = :orderId', { orderId })
                .andWhere('order.type = :type', { type: OrderType.Seller })
                .andWhere('order.active = :active', { active: false })
                .getOne();
            if (!order) throw new Error('Seller order was not found');
            if (status === 'FULFILLED' && this.orderStatus(order) !== 'RETURN_REJECTED') {
                throw new Error('Only a rejected return may restore a fulfilled order');
            }
            const channelIds = order.channels.map(channel => String(channel.id));
            const vendor = (await this.connection.getRepository(transactionCtx, VendorProfile).find({
                where: { channelId: In(channelIds) },
            }))[0];
            if (!vendor) throw new Error('The order vendor could not be found');
            return this.transitionSellerStatusLocked(transactionCtx, order, vendor, {
                orderId, status, statusNote: note,
            }, true);
        });
    }

    /**
     * A partial return does not undo the other items in the seller order. Restore the
     * delivery state without replaying stock, booking, reward, or ledger side effects.
     * The caller must first finish the case decision or post the partial refund offset.
     */
    async restoreAfterReturn(
        ctx: RequestContext,
        orderId: string,
        targetStatus: 'DELIVERED' | 'FULFILLED',
        note: string,
    ) {
        if (!ctx.activeUserId || !ctx.userHasPermissions([Permission.SuperAdmin])) throw new ForbiddenError();
        return withPayoutTransaction(this.connection, ctx, async transactionCtx => {
            const order = await this.baseQuery(transactionCtx)
                .where('order.id = :orderId', { orderId })
                .andWhere('order.type = :type', { type: OrderType.Seller })
                .andWhere('order.active = :active', { active: false })
                .getOne();
            if (!order) throw new Error('Seller order was not found');
            if (!['RETURN_REQUESTED', 'RETURN_REJECTED'].includes(this.orderStatus(order))) {
                throw new Error('Only a decided return can restore the delivery state');
            }
            const statusNote = this.cleanCustomerNote(note);
            order.customFields = {
                ...order.customFields,
                marketplaceStatus: targetStatus,
                marketplaceStatusNote: statusNote || (order.customFields as Record<string, unknown>).marketplaceStatusNote,
                marketplaceStatusUpdatedAt: new Date(),
            } as typeof order.customFields;
            await this.connection.getRepository(transactionCtx, Order).save(order, { reload: false });
            const updated = await this.baseQuery(transactionCtx)
                .where('order.id = :orderId', { orderId })
                .getOne();
            if (!updated) throw new Error('Order could not be reloaded');
            const mapped = (await this.mapOrders(transactionCtx, [updated]))[0];
            await this.marketplaceChatService.recordOrderStatusUpdate(
                transactionCtx, updated, targetStatus,
                marketplaceOrderStatusLabel(targetStatus, this.fulfillmentTypeForOrder(updated)),
                statusNote,
            );
            return mapped;
        });
    }

    async requestCustomerReturn(ctx: RequestContext, orderId: string, note: string) {
        if (!ctx.activeUserId) throw new ForbiddenError();
        return withPayoutTransaction(this.connection, ctx, async transactionCtx => {
            const order = await this.baseQuery(transactionCtx)
                .where('order.id = :orderId', { orderId })
                .andWhere('order.type = :type', { type: OrderType.Seller })
                .andWhere('order.active = :active', { active: false })
                .andWhere('customerUser.id = :customerUserId', { customerUserId: ctx.activeUserId })
                .getOne();
            if (!order) throw new ForbiddenError();
            const status = this.orderStatus(order);
            if (!['DELIVERED', 'FULFILLED'].includes(status)) throw new Error('This order is not eligible for a return appeal');
            const fields = order.customFields as Record<string, unknown>;
            const rawDate = fields.marketplaceDeliveredAt || fields.marketplaceStatusUpdatedAt;
            const deliveredAt = rawDate ? new Date(String(rawDate)) : undefined;
            const eligibility = evaluateReturnWindow(deliveredAt, new Date(), configuredReturnWindowDays());
            if (!eligibility.eligible) throw new Error(eligibility.reason);
            const channelIds = order.channels.map(channel => String(channel.id));
            const vendor = (await this.connection.getRepository(transactionCtx, VendorProfile).find({
                where: { channelId: In(channelIds) },
            }))[0];
            if (!vendor) throw new Error('The order vendor could not be found');
            return this.transitionSellerStatusLocked(transactionCtx, order, vendor, {
                orderId, status: 'RETURN_REQUESTED', statusNote: note,
            }, true);
        });
    }

    private async transitionSellerStatusLocked(
        ctx: RequestContext,
        order: Order,
        vendor: VendorProfile,
        input: UpdateMarketplaceOrderStatusInput,
        adminReturnTransition: boolean,
    ) {

        const currentStatus = this.orderStatus(order);
        const fulfillmentType = this.fulfillmentTypeForOrder(order);
        const nextStatus = input.status.trim().toUpperCase() as SellerStatus;
        if (!sellerStatuses.includes(nextStatus)) {
            throw new Error('Unknown marketplace order status');
        }
        if (adminReturnStatuses.has(nextStatus) && !adminReturnTransition) {
            throw new Error('Return and refund decisions must be handled by marketplace support');
        }
        if (currentStatus === nextStatus) {
            throw new Error(`Order is already ${nextStatus.toLowerCase().replace(/_/g, ' ')}`);
        }
        if (isTerminalSellerStatus(currentStatus)) {
            throw new Error(`${marketplaceOrderStatusLabel(currentStatus, fulfillmentType)} cannot be reopened`);
        }
        if (!marketplaceOrderAvailableStatuses(currentStatus, fulfillmentType).includes(nextStatus)) {
            throw new Error(`${marketplaceOrderStatusLabel(nextStatus, fulfillmentType)} is not available for this ${fulfillmentType.toLowerCase()} order`);
        }

        const statusNote = this.cleanCustomerNote(input.statusNote);
        if (statusesRequiringReason.has(nextStatus) && !statusNote) {
            throw new Error(`Add a customer-facing reason before setting the order to ${marketplaceOrderStatusLabel(nextStatus, fulfillmentType).toLowerCase()}`);
        }
        const lineAdjustments = this.validateLineAdjustments(input.lineAdjustments);
        if (lineExceptionStatuses.has(nextStatus)) {
            if (!statusNote) {
                throw new Error('Add a customer-facing note for the partial or out-of-stock update');
            }
            if (!lineAdjustments.length) {
                throw new Error('Add at least one item quantity for the partial or out-of-stock update');
            }
        }

        if (nextStatus === 'DELIVERED' || nextStatus === 'FULFILLED') {
            this.assertCustomerPaymentSettled(order);
            await this.completeOrderBookings(ctx, order);
        }
        if (nextStatus === 'FULFILLED' && this.isCustomDigitalProjectOrder(order)) {
            if (!statusNote) throw new Error('Add a final delivery note for the customer before completing this project');
            if (!vendor.ownerUserId) throw new Error('The vendor account owner is unavailable');
            await this.marketplaceChatService.assertVendorDeliverableAttached(
                ctx,
                String(order.id),
                vendor.ownerUserId,
            );
        }

        if (nextStatus === 'CANCELLED' || nextStatus === 'REJECTED') {
            await this.releaseCancelledInventory(ctx, order);
        } else if (lineExceptionStatuses.has(nextStatus)) {
            await this.releaseLineExceptions(ctx, order, lineAdjustments);
        } else if (nextStatus === 'DELIVERED' || nextStatus === 'FULFILLED') {
            await this.finalizeDeliveredInventory(ctx, order);
        }
        if (isTerminalSellerStatus(nextStatus)) await this.releaseOrderBookings(ctx, order, nextStatus);

        const customFields = order.customFields as Record<string, unknown>;
        order.customFields = {
            ...customFields,
            marketplaceStatus: nextStatus,
            marketplaceTrackingCode: input.trackingCode?.trim()
                || String(customFields.marketplaceTrackingCode ?? '')
                || undefined,
            marketplaceStatusNote: statusNotesEnabled.has(nextStatus)
                ? statusNote || String(customFields.marketplaceStatusNote ?? '') || undefined
                : customFields.marketplaceStatusNote,
            marketplaceConfirmedAt: nextStatus === 'CONFIRMED'
                ? customFields.marketplaceConfirmedAt || new Date()
                : customFields.marketplaceConfirmedAt,
            marketplaceDeliveredAt: nextStatus === 'DELIVERED' || nextStatus === 'FULFILLED'
                ? customFields.marketplaceDeliveredAt || new Date()
                : customFields.marketplaceDeliveredAt,
            marketplaceStatusUpdatedAt: new Date(),
        } as typeof order.customFields;
        await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        const updated = await this.baseQuery(ctx).where('order.id = :orderId', { orderId: order.id }).getOne();
        if (!updated) throw new Error('Order could not be reloaded');
        if (nextStatus === 'DELIVERED' || nextStatus === 'FULFILLED') {
            await this.marketplaceCommissionRuleService.createLedgerEntriesForSellerOrder(ctx, updated);
            await this.marketplacePurchaseRewardService.awardForSellerOrder(ctx, updated);
        } else if (isTerminalSellerStatus(nextStatus)) {
            await this.marketplaceCommissionRuleService.reverseLedgerEntriesForSellerOrder(ctx, updated, nextStatus);
            await this.marketplacePurchaseRewardService.reverseForSellerOrder(ctx, updated);
            await this.marketplaceRewardRedemptionService.reverseForSellerOrder(ctx, updated, nextStatus);
            await this.marketplaceCouponService.reverseForSellerOrder(ctx, updated, nextStatus);
        }
        const mappedOrder = (await this.mapOrders(ctx, [updated]))[0];
        if (!mappedOrder) throw new Error('Order could not be mapped');
        await this.marketplaceChatService.recordOrderStatusUpdate(
            ctx,
            updated,
            nextStatus,
            marketplaceOrderStatusLabel(nextStatus, fulfillmentType),
            mappedOrder.statusNote,
        );

        if (updated.customer?.emailAddress) {
            const status = nextStatus as SellerStatus;
            await this.eventBus.publish(new MarketplaceOrderStatusEvent(
                ctx,
                updated.customer.emailAddress,
                updated.customer.firstName || 'Customer',
                updated.aggregateOrder?.code ?? updated.code,
                updated.code,
                mappedOrder.vendorName ?? vendor.shopName,
                status,
                marketplaceOrderStatusLabel(status, fulfillmentType),
                marketplaceOrderStatusMessage(status, fulfillmentType),
                mappedOrder.trackingCode,
                mappedOrder.statusNote,
                mappedOrder.lines.map(line => ({
                    productName: line.productName,
                    variantName: line.variantName,
                    sku: line.sku,
                    quantity: line.quantity,
                })),
                fulfillmentType === 'DIGITAL' && status === 'FULFILLED',
            ));
        }

        return mappedOrder;
    }

    /** Called by booking actions and the subscription scheduler for every bookable category. */
    async synchronizeBookingOrder(ctx: RequestContext, booking: MarketplaceBooking) {
        return withPayoutTransaction(this.connection, ctx, ctx => this.synchronizeBookingOrderLocked(ctx, booking));
    }

    private async synchronizeBookingOrderLocked(ctx: RequestContext, booking: MarketplaceBooking) {
        const orderId = booking.billingModel === 'MONTHLY'
            ? booking.lastRenewalOrderId ?? booking.orderId
            : booking.orderId;
        if (!orderId) return;
        const order = await this.baseQuery(ctx)
            .where('order.id = :orderId', { orderId })
            .andWhere('order.type = :type', { type: OrderType.Seller })
            .getOne();
        if (!order) throw new Error('The paid booking order could not be found');
        const current = this.orderStatus(order);
        if (isTerminalSellerStatus(current)) return;
        const linked = await this.orderBookings(ctx, order);
        const now = new Date();
        const released = new Set(['CANCELLED', 'TERMINATED', 'REFUNDED']);
        let next: SellerStatus | undefined;
        const onlyBookings = order.lines.every(line => {
            const fields = line.customFields as Record<string, unknown> | undefined;
            return fields?.marketplaceBookingId || fields?.marketplaceRenewalBookingId;
        });
        if (onlyBookings && linked.length && linked.every(item => this.bookingPeriodCompleted(item, now))) {
            next = 'FULFILLED';
        } else if (released.has(booking.status)) {
            // A subscription which expires after delivering its paid period keeps those earnings.
            if (booking.billingModel === 'MONTHLY' && booking.endsAt <= now && current === 'FULFILLED') return;
            if (!onlyBookings || linked.some(item => !released.has(item.status))) {
                throw new Error('This order contains other active bookings. Cancel or refund the whole order from Orders.');
            }
            next = booking.status === 'REFUNDED' ? 'REFUNDED' : 'CANCELLED';
        } else if (booking.status === 'CONFIRMED' && current === 'PENDING') {
            next = 'CONFIRMED';
        } else if (booking.status === 'RESCHEDULED' && ['PENDING', 'CONFIRMED'].includes(current)) {
            next = 'PROCESSING';
        }
        if (!next || next === current) return;
        if (next === 'FULFILLED') this.assertCustomerPaymentSettled(order);
        if (['DELIVERED', 'FULFILLED'].includes(current) && next !== 'REFUNDED') return;
        order.customFields = {
            ...order.customFields,
            marketplaceStatus: next,
            marketplaceDeliveredAt: next === 'FULFILLED'
                ? (order.customFields as Record<string, unknown>).marketplaceDeliveredAt || now
                : (order.customFields as Record<string, unknown>).marketplaceDeliveredAt,
            marketplaceStatusUpdatedAt: next === 'FULFILLED' && linked.every(item => item.billingModel === 'MONTHLY')
                ? new Date(Math.max(...linked.map(item => item.endsAt.getTime())))
                : now,
            marketplaceStatusNote: booking.internalNote || `Booking ${booking.status.toLowerCase()}`,
        } as typeof order.customFields;
        await this.connection.getRepository(ctx, Order).save(order, { reload: false });
        if (next === 'FULFILLED') {
            await this.marketplaceCommissionRuleService.createLedgerEntriesForSellerOrder(ctx, order);
            await this.marketplacePurchaseRewardService.awardForSellerOrder(ctx, order);
        } else if (isTerminalSellerStatus(next)) {
            await this.marketplaceCommissionRuleService.reverseLedgerEntriesForSellerOrder(ctx, order, next);
            await this.marketplacePurchaseRewardService.reverseForSellerOrder(ctx, order);
            await this.marketplaceRewardRedemptionService.reverseForSellerOrder(ctx, order, next);
            await this.marketplaceCouponService.reverseForSellerOrder(ctx, order, next);
        }
    }

    private async orderBookings(ctx: RequestContext, order: Order) {
        const ids = order.lines.flatMap(line => {
            const fields = line.customFields as Record<string, unknown> | undefined;
            const id = String(fields?.marketplaceRenewalBookingId || fields?.marketplaceBookingId || '');
            return id ? [id] : [];
        });
        if (!ids.length) return [];
        const bookings = await this.connection.getRepository(ctx, MarketplaceBooking).find({ where: { id: In(ids) } });
        if (new Set(bookings.map(item => String(item.id))).size !== new Set(ids).size) {
            throw new Error('An order booking could not be found');
        }
        return bookings;
    }

    private bookingPeriodCompleted(booking: MarketplaceBooking, now: Date) {
        if (booking.billingModel === 'MONTHLY') {
            return ['PAID', 'GRACE'].includes(booking.paymentStatus) && booking.endsAt <= now
                && !['CANCELLED', 'TERMINATED', 'REFUNDED'].includes(booking.status);
        }
        return booking.paymentStatus === 'PAID' && ['COMPLETED', 'NO_SHOW'].includes(booking.status);
    }

    private async releaseOrderBookings(ctx: RequestContext, order: Order, status: string) {
        const bookings = await this.orderBookings(ctx, order);
        for (const booking of bookings) {
            // Refunding an older subscription period must not cancel a later, separately paid renewal.
            if (String(booking.lastRenewalOrderId ?? booking.orderId) !== String(order.id)) continue;
            if (['CANCELLED', 'REFUNDED', 'TERMINATED'].includes(booking.status)) continue;
            await releaseBookingCapacity(this.connection, ctx, booking);
            booking.status = status === 'REFUNDED' ? 'REFUNDED' : 'CANCELLED';
            booking.cancelledAt = new Date();
            booking.renewalToken = null;
            if (booking.billingModel === 'MONTHLY') booking.paymentStatus = 'TERMINATED';
        }
        if (bookings.length) await this.connection.getRepository(ctx, MarketplaceBooking).save(bookings, { reload: false });
    }

    private async completeOrderBookings(ctx: RequestContext, order: Order) {
        const bookings = await this.orderBookings(ctx, order);
        const now = new Date();
        for (const booking of bookings) {
            if (!['PAID', 'GRACE'].includes(booking.paymentStatus)
                || ['CANCELLED', 'TERMINATED', 'REFUNDED'].includes(booking.status)) {
                throw new Error('Every booking must be paid and active before this order can be completed');
            }
            if (booking.endsAt > now && (booking.billingModel === 'MONTHLY' || booking.bookingType !== 'SERVICE')) {
                throw new Error('The class, event, or subscription period must end before its earnings become eligible');
            }
            if (booking.billingModel !== 'MONTHLY') booking.status = 'COMPLETED';
        }
        if (bookings.length) await this.connection.getRepository(ctx, MarketplaceBooking).save(bookings, { reload: false });
    }

    async reconcileDeliveredInventory(ctx: RequestContext) {
        const orders = await this.baseQuery(ctx)
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .getMany();
        let unitsSold = 0;
        for (const order of orders) {
            const status = this.orderStatus(order);
            if (status === 'DELIVERED' || status === 'FULFILLED') {
                unitsSold += await this.finalizeDeliveredInventory(ctx, order);
                await this.marketplaceCommissionRuleService.createLedgerEntriesForSellerOrder(ctx, order);
            }
        }
        return unitsSold;
    }

    async reconcileCancelledInventory(ctx: RequestContext) {
        const orders = await this.baseQuery(ctx)
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .getMany();
        let unitsReleased = 0;
        for (const order of orders) {
            if (this.orderStatus(order) === 'CANCELLED') {
                unitsReleased += await this.releaseCancelledInventory(ctx, order);
            }
        }
        return unitsReleased;
    }

    async reconcileTerminalOrderLedgers(ctx: RequestContext) {
        const orders = await this.baseQuery(ctx)
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .getMany();
        let reversedEntries = 0;
        for (const order of orders) {
            const status = this.orderStatus(order) as SellerStatus;
            if (!isTerminalSellerStatus(status)) continue;
            const result = await this.marketplaceCommissionRuleService
                .reverseLedgerEntriesForSellerOrder(ctx, order, status);
            await this.marketplaceRewardRedemptionService.reverseForSellerOrder(ctx, order, status);
            await this.marketplaceCouponService.reverseForSellerOrder(ctx, order, status);
            reversedEntries += result.generatedEntries + result.duplicateRefundEntries + result.refundEntries;
        }
        return reversedEntries;
    }

    private async finalizeDeliveredInventory(ctx: RequestContext, sellerOrder: Order) {
        const sourceLines = await this.sourceOrderLinesForSellerOrder(ctx, sellerOrder);
        if (!sourceLines.length) return 0;

        const totals = await this.lineMovementTotals(ctx, sourceLines);
        const linesToSell: OrderLineInput[] = sourceLines.flatMap(line => {
            const remaining = this.remainingAllocatedForLine(line, totals);
            return remaining > 0 ? [{ orderLineId: line.id, quantity: remaining }] : [];
        });
        if (!linesToSell.length) return 0;
        await this.stockMovementService.createSalesForOrder(ctx, linesToSell);
        return linesToSell.reduce((total, line) => total + line.quantity, 0);
    }

    private async releaseCancelledInventory(ctx: RequestContext, sellerOrder: Order) {
        const sourceLines = await this.sourceOrderLinesForSellerOrder(ctx, sellerOrder);
        if (!sourceLines.length) return 0;

        const totals = await this.lineMovementTotals(ctx, sourceLines);
        const linesToRelease: OrderLineInput[] = sourceLines.flatMap(line => {
            const remainingAllocated = this.remainingAllocatedForLine(line, totals);
            return remainingAllocated > 0 ? [{ orderLineId: line.id, quantity: remainingAllocated }] : [];
        });
        if (!linesToRelease.length) return 0;

        await this.stockMovementService.createReleasesForOrderLines(ctx, linesToRelease);
        return linesToRelease.reduce((total, line) => total + line.quantity, 0);
    }

    private async releaseLineExceptions(
        ctx: RequestContext,
        sellerOrder: Order,
        adjustments: MarketplaceOrderLineAdjustmentInput[],
    ) {
        const sourceLines = await this.sourceOrderLinesForSellerOrder(ctx, sellerOrder);
        if (!sourceLines.length) return 0;

        const totals = await this.lineMovementTotals(ctx, sourceLines);
        const requestedByVariant = this.quantitiesByVariant(adjustments);
        const linesToRelease = this.lineInputsForVariantQuantities(
            sourceLines,
            requestedByVariant,
            line => this.remainingAllocatedForLine(line, totals),
            'release',
        );
        if (!linesToRelease.length) return 0;

        await this.stockMovementService.createReleasesForOrderLines(ctx, linesToRelease);
        return linesToRelease.reduce((total, line) => total + line.quantity, 0);
    }

    private async restockReturnedInventory(
        ctx: RequestContext,
        sellerOrder: Order,
        adjustments: MarketplaceOrderLineAdjustmentInput[],
    ) {
        const sourceLines = await this.sourceOrderLinesForSellerOrder(ctx, sellerOrder);
        if (!sourceLines.length) return 0;

        const totals = await this.lineMovementTotals(ctx, sourceLines);
        const requestedByVariant = adjustments.length
            ? this.quantitiesByVariant(adjustments)
            : this.quantitiesByVariant(sourceLines.map(line => ({
                variantId: String(line.productVariantId),
                quantity: this.returnableSoldForLine(line, totals),
            })));
        const linesToRestock = this.lineInputsForVariantQuantities(
            sourceLines,
            requestedByVariant,
            line => this.returnableSoldForLine(line, totals),
            'return',
        );
        if (!linesToRestock.length) return 0;

        await this.stockMovementService.createCancellationsForOrderLines(ctx, linesToRestock);
        return linesToRestock.reduce((total, line) => total + line.quantity, 0);
    }

    private async sourceOrderLinesForSellerOrder(ctx: RequestContext, sellerOrder: Order): Promise<Order['lines']> {
        const sourceOrderId = sellerOrder.aggregateOrder?.id ?? sellerOrder.id;
        const sourceOrder = await this.connection.getEntityOrThrow(ctx, Order, sourceOrderId, {
            relations: ['lines'],
        });
        const sellerChannelIds = new Set(sellerOrder.channels.map(channel => String(channel.id)));
        return sellerOrder.aggregateOrder
            ? sourceOrder.lines.filter(line => line.sellerChannelId != null && sellerChannelIds.has(String(line.sellerChannelId)))
            : sourceOrder.lines;
    }

    private async lineMovementTotals(ctx: RequestContext, sourceLines: Order['lines']): Promise<OrderLineMovementTotals> {
        const lineIds = sourceLines.map(line => line.id);
        const [allocations, releases, sales, cancellations] = await Promise.all([
            this.connection.getRepository(ctx, Allocation).find({
                where: { orderLine: { id: In(lineIds) } },
                relations: ['orderLine'],
            }),
            this.connection.getRepository(ctx, Release).find({
                where: { orderLine: { id: In(lineIds) } },
                relations: ['orderLine'],
            }),
            this.connection.getRepository(ctx, Sale).find({
                where: { orderLine: { id: In(lineIds) } },
                relations: ['orderLine'],
            }),
            this.connection.getRepository(ctx, Cancellation).find({
                where: { orderLine: { id: In(lineIds) } },
                relations: ['orderLine'],
            }),
        ]);
        return {
            allocatedByLineId: this.sumMovementsByOrderLine(allocations),
            releasedByLineId: this.sumMovementsByOrderLine(releases),
            soldByLineId: this.sumMovementsByOrderLine(sales),
            cancelledByLineId: this.sumMovementsByOrderLine(cancellations),
        };
    }

    private remainingAllocatedForLine(line: Order['lines'][number], totals: OrderLineMovementTotals) {
        const lineId = String(line.id);
        const allocated = totals.allocatedByLineId.get(lineId) ?? 0;
        const alreadyCleared = (totals.releasedByLineId.get(lineId) ?? 0) + (totals.soldByLineId.get(lineId) ?? 0);
        return Math.max(0, allocated - alreadyCleared);
    }

    private returnableSoldForLine(line: Order['lines'][number], totals: OrderLineMovementTotals) {
        const lineId = String(line.id);
        return Math.max(0, (totals.soldByLineId.get(lineId) ?? 0) - (totals.cancelledByLineId.get(lineId) ?? 0));
    }

    private quantitiesByVariant(adjustments: Array<Pick<MarketplaceOrderLineAdjustmentInput, 'variantId' | 'quantity'>>) {
        const requestedByVariant = new Map<string, number>();
        for (const adjustment of adjustments) {
            if (adjustment.quantity <= 0) continue;
            const variantId = String(adjustment.variantId);
            requestedByVariant.set(variantId, (requestedByVariant.get(variantId) ?? 0) + adjustment.quantity);
        }
        return requestedByVariant;
    }

    private lineInputsForVariantQuantities(
        sourceLines: Order['lines'],
        requestedByVariant: Map<string, number>,
        maxQuantityForLine: (line: Order['lines'][number]) => number,
        actionLabel: string,
    ) {
        const linesToMove: OrderLineInput[] = [];
        const availableByVariant = new Map<string, number>();
        for (const line of sourceLines) {
            const variantId = String(line.productVariantId);
            availableByVariant.set(variantId, (availableByVariant.get(variantId) ?? 0) + maxQuantityForLine(line));
        }
        for (const [variantId, requestedQuantity] of requestedByVariant.entries()) {
            const available = availableByVariant.get(variantId) ?? 0;
            if (requestedQuantity > available) {
                throw new Error(`Cannot ${actionLabel} more than the remaining quantity for variant ${variantId}`);
            }
            let remaining = requestedQuantity;
            for (const line of sourceLines.filter(item => String(item.productVariantId) === variantId)) {
                if (remaining <= 0) break;
                const quantity = Math.min(remaining, maxQuantityForLine(line));
                if (quantity > 0) {
                    linesToMove.push({ orderLineId: line.id, quantity });
                    remaining -= quantity;
                }
            }
        }
        return linesToMove;
    }

    private sumMovementsByOrderLine(movements: Array<Allocation | Release | Sale | Cancellation>) {
        const totals = new Map<string, number>();
        for (const movement of movements) {
            const lineId = String(movement.orderLine.id);
            totals.set(lineId, (totals.get(lineId) ?? 0) + Math.abs(movement.quantity));
        }
        return totals;
    }

    private baseQuery(ctx: RequestContext) {
        return this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('customer.user', 'customerUser')
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'productVariant')
            .leftJoinAndSelect('productVariant.translations', 'productVariantTranslations')
            .leftJoinAndSelect('productVariant.product', 'product')
            .leftJoinAndSelect('product.translations', 'productTranslations')
            .leftJoinAndSelect('product.featuredAsset', 'productFeaturedAsset')
            .leftJoinAndSelect('lines.featuredAsset', 'lineFeaturedAsset')
            .leftJoinAndSelect('order.surcharges', 'surcharges')
            .leftJoinAndSelect('order.shippingLines', 'shippingLines')
            .leftJoinAndSelect('order.channels', 'orderChannels')
            .leftJoinAndSelect('order.aggregateOrder', 'aggregateOrder')
            .leftJoinAndSelect('order.payments', 'orderPayments')
            .leftJoinAndSelect('orderPayments.refunds', 'orderPaymentRefunds')
            .leftJoinAndSelect('aggregateOrder.payments', 'aggregatePayments')
            .leftJoinAndSelect('aggregatePayments.refunds', 'aggregatePaymentRefunds')
            .leftJoinAndSelect('order.sellerOrders', 'sellerOrders')
            .leftJoinAndSelect('sellerOrders.channels', 'sellerOrderChannels');
    }

    private vendorOrders(ctx: RequestContext, channelId: string) {
        return this.baseQuery(ctx)
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .andWhere('orderChannels.id = :channelId', { channelId })
            .orderBy('order.orderPlacedAt', 'DESC')
            .getMany();
    }

    private async mapOrders(ctx: RequestContext, orders: Order[]) {
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendorByChannel = new Map<string, VendorProfile>();
        for (const vendor of vendors) {
            if (vendor.channelId) vendorByChannel.set(vendor.channelId, vendor);
        }
        const productIds = [...new Set(orders.flatMap(order => order.lines)
            .map(line => line.productVariant.product ? String(line.productVariant.product.id) : '')
            .filter(Boolean))];
        const digitalFiles = productIds.length
            ? await this.connection.getRepository(ctx, MarketplaceDigitalFile).find({
                where: { productId: In(productIds) },
                order: { createdAt: 'ASC' },
            })
            : [];
        const downloadableFilesByProduct = new Map<string, Array<Record<string, unknown>>>();
        for (const file of digitalFiles.filter(item => item.kind === 'MAIN')) {
            const items = downloadableFilesByProduct.get(file.productId) ?? [];
            items.push({
                id: String(file.id),
                fileName: file.fileName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                expiresAt: file.expiresAt,
            });
            downloadableFilesByProduct.set(file.productId, items);
        }
        const fundingOrderIds = [...new Set(orders.flatMap(order => [String(order.id), ...(order.aggregateOrder ? [String(order.aggregateOrder.id)] : [])]))];
        const rewardFunding = await this.marketplaceRewardRedemptionService.fundingByOrderIds(
            ctx,
            fundingOrderIds,
        );
        const couponFunding = await this.marketplaceCouponService.fundingByOrderIds(
            ctx,
            fundingOrderIds,
        );
        const projectDeadlineByQuoteId = await this.projectDeadlinesByQuoteId(ctx, orders);

        return orders.map(order => {
            const status = order.type === OrderType.Aggregate
                ? this.aggregateStatus(order.sellerOrders ?? [])
                : this.orderStatus(order);
            const downloadReady = status === 'DELIVERED' || status === 'FULFILLED';
            const orderVendor = order.type === OrderType.Seller
                ? order.channels.map(channel => vendorByChannel.get(String(channel.id))).find(Boolean)
                : undefined;
            const customerNotes = this.customerNotesForOrder(order);
            const visibleCustomerNotes = order.type === OrderType.Seller && orderVendor
                ? customerNotes.filter(note => this.customerNoteMatchesVendor(note, orderVendor))
                : customerNotes;
            const lineVendors = new Set<string>();
            const lines = order.lines.map(line => {
                const variant = this.translator.translate(line.productVariant, ctx);
                const product = line.productVariant.product
                    ? this.translator.translate(line.productVariant.product, ctx)
                    : undefined;
                const variantName = String(variant.name ?? '').trim()
                    || String(variant.sku ?? '').trim()
                    || `Variant ${line.id}`;
                const productName = String(product?.name ?? '').trim() || variantName;
                const vendor = vendorByChannel.get(String(line.sellerChannelId ?? ''));
                if (vendor) lineVendors.add(vendor.shopName);
                const noteVendor = vendor ?? orderVendor;
                const lineFields = line.customFields as Record<string, unknown> | undefined;
                return {
                    id: String(line.id),
                    productId: product ? String(product.id) : '',
                    productName,
                    productSlug: String(product?.slug ?? ''),
                    variantId: String(variant.id),
                    variantName,
                    sku: String(variant.sku ?? ''),
                    quantity: line.quantity,
                    unitPrice: line.discountedUnitPriceWithTax,
                    lineTotal: line.discountedLinePriceWithTax,
                    image: line.featuredAsset?.preview ?? product?.featuredAsset?.preview ?? '',
                    vendorId: vendor ? String(vendor.id) : orderVendor ? String(orderVendor.id) : undefined,
                    vendorName: vendor?.shopName ?? orderVendor?.shopName,
                    productType: String((product?.customFields as Record<string, unknown> | undefined)?.marketplaceType ?? 'PHYSICAL'),
                    downloadableFiles: product && downloadReady
                        ? downloadableFilesByProduct.get(String(product.id)) ?? []
                        : [],
                    customerNote: noteVendor ? this.customerNoteForVendor(customerNotes, noteVendor) : undefined,
                    bookingId: String(lineFields?.marketplaceBookingId ?? '').trim() || undefined,
                    renewalBookingId: String(lineFields?.marketplaceRenewalBookingId ?? '').trim() || undefined,
                };
            });
            const productSubTotal = lines.reduce((total, line) => total + line.lineTotal, 0);
            const displaySubTotal = order.type === OrderType.Seller
                ? productSubTotal
                : order.subTotalWithTax;
            const customFields = order.customFields as Record<string, unknown>;
            const decisionDueAt = this.decisionDueAt(order, status);
            const funding = rewardFunding.get(String(order.id));
            const coupon = couponFunding.get(String(order.id));
            const totalMarketplaceDiscount = (funding?.amount ?? 0) + (coupon?.amount ?? 0);
            const fulfillmentType = resolveMarketplaceOrderFulfillmentType(lines.map(line => line.productType));
            const projectDeadline = this.projectDeadlineForOrder(order, projectDeadlineByQuoteId);
            const chatAvailable = marketplaceOrderChatEnabled(order.lines);
            const customerOrder = order.aggregateOrder ?? order;
            const customerAmountDue = Math.max(0, customerOrder.totalWithTax
                - (rewardFunding.get(String(customerOrder.id))?.amount ?? 0)
                - (couponFunding.get(String(customerOrder.id))?.amount ?? 0));
            const companyPayment = customerOrder.payments?.find(payment =>
                payment.metadata?.source === 'MARKETPLACE_DIRECT_PURCHASE')
                ?? customerOrder.payments?.find(payment => payment.method === 'marketplace-connected-payment');
            return {
                id: String(order.id),
                code: order.code,
                customerOrderCode: order.aggregateOrder?.code ?? order.code,
                customerOrderId: String(order.aggregateOrder?.id ?? order.id),
                sellerOrderCode: order.type === OrderType.Seller ? order.code : undefined,
                sellerOrderIds: order.type === OrderType.Aggregate
                    ? (order.sellerOrders ?? []).map(sellerOrder => String(sellerOrder.id))
                    : order.type === OrderType.Seller ? [String(order.id)] : [],
                orderType: String(order.type),
                status,
                vendureState: order.state,
                paymentStatus: marketplaceOrderPaymentIsSettled(order) ? 'CONFIRMED' : 'AWAITING_CONFIRMATION',
                companyPaymentDue: order.type === OrderType.Seller && !ctx.userHasPermissions([Permission.SuperAdmin])
                    ? customerFundedProductAmount(displaySubTotal, totalMarketplaceDiscount) + order.shippingWithTax
                    : Number(companyPayment?.metadata?.customerPayableAmount ?? customerAmountDue),
                paymentState: companyPayment?.state,
                paymentMethod: String(companyPayment?.metadata?.checkoutMode ?? companyPayment?.method ?? ''),
                companyReceiptReference: String(companyPayment?.metadata?.companyReceiptReference ?? '') || undefined,
                companyReceiptAmount: companyPayment?.metadata?.companyReceiptAmount == null
                    ? undefined
                    : Number(companyPayment.metadata.companyReceiptAmount),
                companyReceiptConfirmedAt: String(companyPayment?.metadata?.companyReceiptConfirmedAt ?? '') || undefined,
                companyReceiptConfirmedBy: String(companyPayment?.metadata?.companyReceiptConfirmedBy ?? '') || undefined,
                createdAt: order.createdAt,
                updatedAt: order.updatedAt,
                placedAt: order.orderPlacedAt,
                customerId: order.customer ? String(order.customer.id) : '',
                customerName: order.customer ? `${order.customer.firstName} ${order.customer.lastName}`.trim() : 'Customer',
                customerEmail: order.customer?.emailAddress ?? '',
                vendorId: orderVendor ? String(orderVendor.id) : undefined,
                vendorName: orderVendor?.shopName ?? (lineVendors.size === 1 ? [...lineVendors][0] : lineVendors.size > 1 ? 'Multiple vendors' : undefined),
                vendorSlug: orderVendor?.slug,
                subTotal: displaySubTotal,
                shipping: order.shippingWithTax,
                total: displaySubTotal + order.shippingWithTax,
                customerPaidTotal: order.type === OrderType.Seller
                    ? order.aggregateOrder?.totalWithTax ?? displaySubTotal + order.shippingWithTax
                    : order.totalWithTax,
                vendorProceedsTotal: order.totalWithTax,
                rewardCoins: funding?.coins ?? 0,
                rewardFunding: funding?.amount ?? 0,
                couponCode: coupon?.code,
                couponDiscount: coupon?.amount ?? 0,
                couponFundingSource: coupon?.fundingSource,
                customerFundedSubTotal: customerFundedProductAmount(displaySubTotal, totalMarketplaceDiscount),
                currencyCode: String(order.currencyCode),
                totalQuantity: order.lines.reduce((total, line) => total + line.quantity, 0),
                shippingAddress: order.shippingAddress,
                trackingCode: String(customFields.marketplaceTrackingCode ?? '') || undefined,
                customerNote: this.customerNoteSummary(visibleCustomerNotes),
                customerNotes: visibleCustomerNotes,
                statusNote: this.statusNoteForOrder(order, vendorByChannel),
                confirmedAt: this.confirmedAtForOrder(order),
                statusUpdatedAt: this.statusUpdatedAtForOrder(order),
                decisionDueAt,
                decisionOverdue: Boolean(decisionDueAt && decisionDueAt.getTime() < Date.now()),
                projectDeadline,
                projectDeadlineOverdue: this.isProjectDeadlineOverdue(projectDeadline, status),
                chatAvailable,
                fulfillmentType,
                printableDocuments: order.type === OrderType.Seller
                    ? marketplaceOrderPrintableDocuments(status, fulfillmentType)
                    : [],
                availableStatuses: order.type === OrderType.Seller
                    ? marketplaceOrderAvailableStatuses(status, fulfillmentType)
                        .filter(next => ctx.userHasPermissions([Permission.SuperAdmin]) || !adminReturnStatuses.has(next as SellerStatus))
                    : [],
                lines,
            };
        });
    }

    private async projectDeadlinesByQuoteId(ctx: RequestContext, orders: Order[]) {
        const quoteIds = [...new Set(orders.flatMap(order => order.lines)
            .map(line => String((line.customFields as Record<string, unknown> | undefined)?.marketplaceQuoteId ?? '').trim())
            .filter(Boolean))];
        if (!quoteIds.length) return new Map<string, string>();

        const quotes = await this.connection.getRepository(ctx, MarketplaceListingQuote).find({
            where: { id: In(quoteIds) },
        });
        const conversationIds = [...new Set(quotes.map(quote => quote.conversationId).filter(Boolean))];
        if (!conversationIds.length) return new Map<string, string>();

        const summaries = await this.connection.getRepository(ctx, MarketplaceChatMessage).find({
            where: { conversationId: In(conversationIds), kind: 'INQUIRY_SUMMARY' },
            order: { createdAt: 'DESC' },
        });
        const deadlineByConversationId = new Map<string, string>();
        for (const summary of summaries) {
            if (deadlineByConversationId.has(summary.conversationId)) continue;
            const inquiry = summary.metadata?.inquirySummary;
            const deadline = String(inquiry?.deadline ?? '').trim();
            if (inquiry?.inquiryType === 'DIGITAL_PROJECT' && /^\d{4}-\d{2}-\d{2}$/.test(deadline)) {
                deadlineByConversationId.set(summary.conversationId, deadline);
            }
        }

        return new Map(quotes.flatMap(quote => {
            const deadline = deadlineByConversationId.get(quote.conversationId);
            return deadline ? [[String(quote.id), deadline] as const] : [];
        }));
    }

    private projectDeadlineForOrder(order: Order, projectDeadlineByQuoteId: Map<string, string>) {
        const deadlines = order.lines.flatMap(line => {
            const quoteId = String((line.customFields as Record<string, unknown> | undefined)?.marketplaceQuoteId ?? '').trim();
            const deadline = projectDeadlineByQuoteId.get(quoteId);
            return deadline ? [deadline] : [];
        }).sort();
        return deadlines[0];
    }

    private isProjectDeadlineOverdue(deadline: string | undefined, status: string) {
        if (!deadline || ['DELIVERED', 'FULFILLED', 'REJECTED', 'CANCELLED', 'REFUNDED'].includes(status)) {
            return false;
        }
        return new Date(`${deadline}T23:59:59.999+05:00`).getTime() < Date.now();
    }

    private validateLineAdjustments(input?: MarketplaceOrderLineAdjustmentInput[] | null) {
        if (!input?.length) return [];
        if (input.length > 50) throw new Error('Too many line adjustments');
        return input.map(adjustment => {
            const variantId = String(adjustment.variantId ?? '').trim();
            const quantity = Number(adjustment.quantity);
            if (!variantId) throw new Error('Choose an item for each line adjustment');
            if (!Number.isInteger(quantity) || quantity < 1) {
                throw new Error('Line adjustment quantities must be whole numbers greater than zero');
            }
            if (quantity > 999) throw new Error('Line adjustment quantity is too large');
            return {
                variantId,
                quantity,
                reason: this.cleanCustomerNote(adjustment.reason),
            };
        });
    }

    private cleanCustomerNote(value?: string | null) {
        const note = String(value ?? '')
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return note.length > 1000 ? note.slice(0, 1000).trim() : note;
    }

    private assertCustomerPaymentSettled(order: Order) {
        if (!marketplaceOrderPaymentIsSettled(order)) {
            throw new Error('The full customer payment must be settled with the company before this order can be completed');
        }
    }

    private isCustomDigitalProjectOrder(order: Order) {
        return order.lines.some(line => {
            const quoteId = String((line.customFields as Record<string, unknown> | undefined)?.marketplaceQuoteId ?? '');
            if (!quoteId) return false;
            const rawMetadata = (line.productVariant.product?.customFields as Record<string, unknown> | undefined)?.marketplaceMetadata;
            try {
                const metadata = typeof rawMetadata === 'string'
                    ? JSON.parse(rawMetadata) as Record<string, unknown>
                    : rawMetadata as Record<string, unknown> | undefined;
                return metadata?.formTemplateKey === 'custom_digital_project';
            } catch {
                return false;
            }
        });
    }

    private customerNotesForOrder(order: Order): MarketplaceOrderCustomerNote[] {
        const sourceOrder = order.aggregateOrder ?? order;
        const raw = String((sourceOrder.customFields as Record<string, unknown> | undefined)?.marketplaceCustomerNotes ?? '');
        if (!raw) return [];
        try {
            const parsed = JSON.parse(raw) as Array<Partial<MarketplaceOrderCustomerNote>>;
            if (!Array.isArray(parsed)) return [];
            return parsed.flatMap(item => {
                const vendorId = String(item.vendorId ?? '').trim();
                const vendorName = this.cleanCustomerNote(item.vendorName);
                const note = this.cleanCustomerNote(item.note);
                if (!vendorId || !vendorName || !note) return [];
                return [{
                    vendorId,
                    vendorName,
                    vendorSlug: String(item.vendorSlug ?? '').trim() || undefined,
                    note,
                }];
            });
        } catch {
            return [];
        }
    }

    private customerNoteForVendor(notes: MarketplaceOrderCustomerNote[], vendor: VendorProfile) {
        return notes.find(note => this.customerNoteMatchesVendor(note, vendor))?.note;
    }

    private customerNoteMatchesVendor(note: MarketplaceOrderCustomerNote, vendor: VendorProfile) {
        return note.vendorId === String(vendor.id) || Boolean(note.vendorSlug && note.vendorSlug === vendor.slug);
    }

    private customerNoteSummary(notes: MarketplaceOrderCustomerNote[]) {
        return notes.map(note => `${note.vendorName}: ${note.note}`).join(' | ') || undefined;
    }

    private statusNoteForOrder(order: Order, vendorByChannel: Map<string, VendorProfile>) {
        if (order.type !== OrderType.Aggregate) {
            return this.cleanCustomerNote(String((order.customFields as Record<string, unknown>).marketplaceStatusNote ?? '')) || undefined;
        }
        const notes = (order.sellerOrders ?? []).flatMap(sellerOrder => {
            const note = this.cleanCustomerNote(String((sellerOrder.customFields as Record<string, unknown>).marketplaceStatusNote ?? ''));
            if (!note) return [];
            const vendor = sellerOrder.channels
                .map(channel => vendorByChannel.get(String(channel.id)))
                .find(Boolean);
            return [`${vendor?.shopName ?? 'Vendor'}: ${note}`];
        });
        return notes.join(' | ') || undefined;
    }

    private confirmedAtForOrder(order: Order) {
        if (order.type !== OrderType.Aggregate) {
            return this.dateCustomField(order, 'marketplaceConfirmedAt');
        }
        const confirmedDates = (order.sellerOrders ?? [])
            .map(sellerOrder => this.dateCustomField(sellerOrder, 'marketplaceConfirmedAt'))
            .filter((value): value is Date => Boolean(value));
        if (!confirmedDates.length) return undefined;
        return new Date(Math.min(...confirmedDates.map(value => value.getTime())));
    }

    private statusUpdatedAtForOrder(order: Order) {
        if (order.type !== OrderType.Aggregate) {
            return this.dateCustomField(order, 'marketplaceStatusUpdatedAt') ?? order.updatedAt;
        }
        const statusDates = (order.sellerOrders ?? [])
            .map(sellerOrder => this.dateCustomField(sellerOrder, 'marketplaceStatusUpdatedAt') ?? sellerOrder.updatedAt)
            .filter((value): value is Date => Boolean(value));
        if (!statusDates.length) {
            return this.dateCustomField(order, 'marketplaceStatusUpdatedAt') ?? order.updatedAt;
        }
        return new Date(Math.max(...statusDates.map(value => value.getTime())));
    }

    private dateCustomField(order: Order, field: string) {
        const value = (order.customFields as Record<string, unknown>)[field];
        if (!value) return undefined;
        const date = value instanceof Date ? value : new Date(String(value));
        return Number.isNaN(date.getTime()) ? undefined : date;
    }

    private decisionDueAt(order: Order, status: string) {
        if (status !== 'PENDING') return undefined;
        const start = order.orderPlacedAt ?? order.createdAt;
        return start ? new Date(new Date(start).getTime() + decisionSlaHours * 60 * 60 * 1000) : undefined;
    }

    private orderStatus(order: Order) {
        const storedStatus = String((order.customFields as Record<string, unknown>)?.marketplaceStatus ?? 'PENDING');
        const status = legacySellerStatuses[storedStatus] ?? storedStatus;
        return sellerStatuses.includes(status as typeof sellerStatuses[number]) ? status : 'PENDING';
    }

    private fulfillmentTypeForOrder(order: Order) {
        return resolveMarketplaceOrderFulfillmentType(order.lines.map(line =>
            (line.productVariant.product?.customFields as Record<string, unknown> | undefined)?.marketplaceType,
        ));
    }

    private aggregateStatus(sellerOrders: Order[]) {
        if (!sellerOrders.length) return 'PENDING';
        const statuses = sellerOrders.map(order => this.orderStatus(order));
        const uniqueStatuses = new Set(statuses);
        if (uniqueStatuses.size === 1) return statuses[0] ?? 'PENDING';
        if (statuses.some(status => ['RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED', 'REFUNDED'].includes(status))) return 'PARTIALLY_RETURNED';
        if (statuses.some(status => ['REJECTED', 'CANCELLED'].includes(status))) return 'PARTIALLY_CANCELLED';
        if (statuses.some(status => ['PARTIALLY_FULFILLED', 'OUT_OF_STOCK_EXCEPTION'].includes(status))) return 'PARTIALLY_FULFILLED';
        if (statuses.some(status => ['DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED', 'FULFILLED'].includes(status))) return 'PARTIALLY_DISPATCHED';
        for (const status of ['PACKED', 'PROCESSING', 'CONFIRMED']) {
            if (statuses.some(value => value === status)) return status;
        }
        return 'PENDING';
    }

    private filter(items: Array<Record<string, any>>, filter?: MarketplaceOrderFilterInput) {
        if (!filter) return items;
        const term = filter.term?.trim().toLowerCase();
        return items.filter(order => {
            if (filter.vendorId && order.vendorId !== filter.vendorId) return false;
            if (filter.customerId && order.customerId !== filter.customerId) return false;
            if (filter.customerOrderCode && !String(order.customerOrderCode).toLowerCase().includes(filter.customerOrderCode.toLowerCase())) return false;
            if (filter.status && order.status !== filter.status.toUpperCase()) return false;
            if (term) {
                const text = [order.code, order.customerOrderCode, order.customerId, order.customerName, order.customerEmail, order.vendorId, order.vendorName, ...order.lines.map((line: any) => `${line.productName} ${line.sku}`)].join(' ').toLowerCase();
                if (!text.includes(term)) return false;
            }
            return true;
        });
    }

    private paginate<T>(items: T[], options?: MarketplaceListOptions) {
        const { skip, take } = normalizeListOptions(options);
        return { items: items.slice(skip, skip + take), totalItems: items.length };
    }

    private async activeVendor(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor || vendor.paused) throw new ForbiddenError();
        return vendor;
    }
}
