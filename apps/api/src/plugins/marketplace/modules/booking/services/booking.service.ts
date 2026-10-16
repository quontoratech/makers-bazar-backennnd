import { Injectable } from '@nestjs/common';
import {
    assertFound,
    Customer,
    EventBus,
    ID,
    Order,
    Permission,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, IsNull, LessThanOrEqual, Not } from 'typeorm';

import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { requireActiveUserId } from '../../../shared/ownership';
import { MarketplaceAvailabilitySession } from '../../catalog/entities/marketplace-availability-session.entity';
import { MarketplaceEventTicketType } from '../../catalog/entities/marketplace-event-ticket-type.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { MarketplaceChatService } from '../../chat/services/marketplace-chat.service';
import { MarketplaceOrderService } from '../../order/services/marketplace-order.service';
import { CreateBookingInput, RequestSubscriptionCancellationInput, UpdateBookingStatusInput } from '../dto/booking.inputs';
import { MarketplaceBooking } from '../entities/booking.entity';
import { releaseBookingCapacity } from '../booking-capacity';
import { withPayoutTransaction } from '../../finance/payout-transaction';
import {
    MarketplaceSubscriptionCancellationEvent,
    MarketplaceSubscriptionRenewalEvent,
} from '../events/subscription-renewal.event';

const dayMs = 24 * 60 * 60 * 1000;
const terminalStatuses = new Set(['COMPLETED', 'CANCELLED', 'TERMINATED', 'NO_SHOW', 'REFUNDED']);
const capacityReleaseStatuses = new Set(['CANCELLED', 'TERMINATED', 'REFUNDED']);
const bookingStatuses = new Set([
    'PENDING', 'CONFIRMED', 'RESCHEDULED', 'CANCELLATION_REQUESTED',
    'COMPLETED', 'CANCELLED', 'TERMINATED', 'NO_SHOW', 'REFUNDED',
]);

@Injectable()
export class BookingService {
    constructor(
        private connection: TransactionalConnection,
        private eventBus: EventBus,
        private chatService: MarketplaceChatService,
        private marketplaceOrderService: MarketplaceOrderService,
    ) {}

    async findAll(ctx: RequestContext, options?: MarketplaceListOptions): Promise<MarketplaceList<MarketplaceBooking>> {
        const { skip, take } = normalizeListOptions(options);
        const vendor = await this.currentVendor(ctx);
        const [items, totalItems] = await this.connection.getRepository(ctx, MarketplaceBooking).findAndCount({
            where: vendor ? { vendorProfileId: String(vendor.id) } : undefined,
            skip,
            take,
            order: { createdAt: 'DESC' },
        });
        const workshopOrders = vendor ? await this.marketplaceOrderService.listVendorWorkshopOrders(ctx) : [];
        return Object.assign({ items: await this.withDetails(ctx, items), totalItems }, { workshopOrders });
    }

    async findMine(ctx: RequestContext): Promise<MarketplaceBooking[]> {
        const activeUserId = requireActiveUserId(ctx);
        const items = await this.connection.getRepository(ctx, MarketplaceBooking).find({
            where: { customerId: String(activeUserId) },
            order: { createdAt: 'DESC' },
        });
        return this.withDetails(ctx, items);
    }

    findOne(ctx: RequestContext, id: ID): Promise<MarketplaceBooking | null> {
        return this.connection.getRepository(ctx, MarketplaceBooking).findOne({ where: { id } });
    }

    private async withDetails(ctx: RequestContext, bookings: MarketplaceBooking[]) {
        const orderIds = bookings.map(booking => booking.orderId).filter((id): id is string => Boolean(id));
        const orders = orderIds.length ? await this.connection.getRepository(ctx, Order).find({
            where: { id: In(orderIds) },
            relations: ['aggregateOrder', 'customer', 'customer.user', 'lines', 'lines.productVariant', 'lines.productVariant.product', 'lines.productVariant.product.translations'],
        }) : [];
        const variants = bookings.length ? await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(bookings.map(booking => booking.productVariantId)) },
            relations: ['product', 'product.translations'],
        }) : [];
        const sessionIds = bookings.map(booking => booking.availabilitySessionId).filter((id): id is string => Boolean(id));
        const sessions = sessionIds.length ? await this.connection.getRepository(ctx, MarketplaceAvailabilitySession).find({ where: { id: In(sessionIds) } }) : [];
        return bookings.map(booking => {
            const order = orders.find(item => String(item.id) === booking.orderId);
            const variant = variants.find(item => String(item.id) === booking.productVariantId);
            const session = sessions.find(item => String(item.id) === booking.availabilitySessionId);
            return {
                ...booking,
                details: {
                    customerRecordId: order?.customer?.id ? String(order.customer.id) : undefined,
                    customerOrderId: order ? String(order.aggregateOrder?.id ?? order.id) : undefined,
                    customerOrderCode: order?.aggregateOrder?.code ?? order?.code,
                    sellerOrderCode: order?.code,
                    placedAt: order?.orderPlacedAt,
                    currencyCode: order?.currencyCode ?? 'PKR',
                    orderTotal: order?.totalWithTax,
                    productId: variant?.productId ? String(variant.productId) : undefined,
                    productSlug: variant?.product?.translations?.[0]?.slug,
                    sku: variant?.sku,
                    daysOfWeek: session?.daysOfWeek,
                    startTime: session?.startTime,
                    endTime: session?.endTime,
                    capacity: session?.capacity,
                    bookedCount: session?.bookedCount,
                    gracePeriodDays: session?.gracePeriodDays,
                    lines: order?.lines.map(line => ({
                        id: String(line.id),
                        productName: line.productVariant.product?.translations?.[0]?.name ?? booking.title,
                        sku: line.productVariant.sku,
                        quantity: line.quantity,
                        unitPrice: line.unitPriceWithTax,
                        total: line.linePriceWithTax,
                    })),
                    shippingAddress: order?.shippingAddress,
                },
            };
        });
    }

    async create(ctx: RequestContext, input: CreateBookingInput): Promise<MarketplaceBooking> {
        const activeUserId = requireActiveUserId(ctx);
        const quantity = input.quantity ?? 1;
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
            throw new Error('Booking quantity must be a whole number between 1 and 100');
        }
        if (!['SERVICE', 'WORKSHOP', 'EXPERIENCE', 'TICKET'].includes(input.bookingType)) {
            throw new Error('Choose a supported booking type');
        }
        const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
            where: { id: input.productVariantId },
            relations: ['product', 'product.translations'],
        });
        if (!variant?.enabled || !variant.product?.enabled) throw new Error('This listing is not available for booking');
        const productFields = variant.product.customFields as Record<string, unknown>;
        const vendorProfileId = String(productFields.vendorProfileId ?? '');
        if (!vendorProfileId || (input.vendorProfileId && input.vendorProfileId !== vendorProfileId)) {
            throw new Error('The selected listing does not belong to this vendor');
        }
        const marketplaceType = String(productFields.marketplaceType ?? '');
        const expectedType = input.bookingType === 'SERVICE' ? 'SERVICE'
            : input.bookingType === 'TICKET' ? 'EVENT' : 'WORKSHOP';
        if (marketplaceType !== expectedType) throw new Error('The selected listing does not support this booking type');

        let startsAt = new Date(input.startsAt);
        let endsAt = new Date(input.endsAt);
        let capacity: number | undefined;
        let subscriptionClassName: string | undefined;
        let agreedPrice: number | undefined;
        let billingModel: MarketplaceBooking['billingModel'] = 'ONE_TIME';
        let oneDayPass = false;
        if (input.bookingType === 'WORKSHOP' || input.bookingType === 'EXPERIENCE') {
            const configuration = this.workshopConfiguration(productFields.marketplaceMetadata);
            const purchaseMode = String(input.purchaseMode ?? 'MONTHLY').toUpperCase();
            if (!['MONTHLY', 'ONE_DAY'].includes(purchaseMode)) throw new Error('Choose a supported class purchase option');
            oneDayPass = configuration.billingModel === 'MONTHLY' && purchaseMode === 'ONE_DAY';
            billingModel = oneDayPass ? 'ONE_TIME' : configuration.billingModel;
            if (!input.availabilitySessionId) {
                throw new Error(billingModel === 'MONTHLY' ? 'Choose a recurring class time' : 'Choose an available workshop or experience session');
            }
            if (billingModel === 'MONTHLY') {
                const existing = await this.connection.getRepository(ctx, MarketplaceBooking).findOne({
                    where: {
                        customerId: String(activeUserId),
                        availabilitySessionId: input.availabilitySessionId,
                        billingModel: 'MONTHLY',
                        status: Not(In([...capacityReleaseStatuses])),
                        paymentStatus: Not('TERMINATED'),
                    },
                });
                if (existing) throw new Error('You already have an active enrollment for this class. Renew it from Bookings instead.');
            }
            const session = await this.reserveSession(
                ctx,
                input.availabilitySessionId,
                String(variant.product.id),
                quantity,
                configuration.billingModel === 'MONTHLY' ? 'SUBSCRIPTION_CLASS' : 'ONE_TIME',
                oneDayPass,
            );
            capacity = session.capacity;
            agreedPrice = this.effectiveSessionPrice(session, variant.listPrice, oneDayPass);
            if (configuration.billingModel === 'MONTHLY') {
                if (quantity !== 1) throw new Error('Monthly class subscriptions can only be purchased one at a time');
                startsAt = configuration.startsAt && configuration.startsAt > new Date() ? configuration.startsAt : new Date();
                endsAt = new Date(startsAt.getTime() + (oneDayPass ? dayMs : configuration.periodDays * dayMs));
                subscriptionClassName = session.name || 'Recurring class';
            } else {
                startsAt = session.startsAt;
                endsAt = session.endsAt;
            }
        } else if (input.bookingType === 'TICKET') {
            if (!input.eventTicketTypeId) throw new Error('Choose an event ticket type');
            const ticket = await this.reserveTicket(ctx, input.eventTicketTypeId, String(variant.product.id), quantity);
            const eventWindow = this.eventWindow(productFields.marketplaceMetadata);
            if (!eventWindow) throw new Error('This event does not have a valid published date and time');
            startsAt = eventWindow.startsAt;
            endsAt = eventWindow.endsAt;
            capacity = ticket.quantity;
            agreedPrice = ticket.price;
        }
        if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) {
            throw new Error('Booking end time must be after its start time');
        }
        if (billingModel !== 'MONTHLY' && !oneDayPass && startsAt <= new Date()) throw new Error('Choose a future booking time');
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { user: { id: activeUserId } },
            relations: ['user'],
        });
        return this.connection.getRepository(ctx, MarketplaceBooking).save(new MarketplaceBooking({
            ...input,
            customerId: String(activeUserId),
            customerName: customer ? `${customer.firstName} ${customer.lastName}`.trim() : undefined,
            customerEmail: customer?.emailAddress,
            vendorProfileId,
            title: String(variant.product.name || input.title).trim(),
            startsAt,
            endsAt,
            quantity,
            capacity,
            status: 'PENDING',
            billingModel,
            paymentStatus: 'UNPAID',
            subscriptionClassName,
            agreedPrice,
        }));
    }

    async updateStatus(ctx: RequestContext, input: UpdateBookingStatusInput): Promise<MarketplaceBooking> {
        return withPayoutTransaction(this.connection, ctx, ctx => this.updateStatusLocked(ctx, input));
    }

    private async updateStatusLocked(ctx: RequestContext, input: UpdateBookingStatusInput): Promise<MarketplaceBooking> {
        const booking = await assertFound(this.findOne(ctx, input.id));
        await this.assertVendorOwnsBooking(ctx, booking);
        if (!bookingStatuses.has(input.status)) throw new Error('Choose a supported booking status');
        if (booking.billingModel === 'MONTHLY' && input.status !== booking.status && ['COMPLETED', 'NO_SHOW'].includes(input.status)) {
            throw new Error('Monthly subscriptions stay active until renewal or cancellation; use Cancelled to end enrollment');
        }
        if (capacityReleaseStatuses.has(booking.status) && input.status !== booking.status) {
            throw new Error('A released enrollment cannot be changed or reactivated');
        }
        const wasTerminal = terminalStatuses.has(booking.status) && !(booking.billingModel === 'MONTHLY' && booking.status === 'COMPLETED');
        const becomesTerminal = terminalStatuses.has(input.status);
        if (wasTerminal && !becomesTerminal) throw new Error('A completed or released booking cannot be reactivated');
        if (['CONFIRMED', 'COMPLETED', 'NO_SHOW'].includes(input.status) && booking.paymentStatus !== 'PAID') {
            throw new Error('Company payment confirmation is required before confirming or completing a booking');
        }
        if (['COMPLETED', 'NO_SHOW'].includes(input.status) && booking.bookingType !== 'SERVICE' && booking.endsAt > new Date()) {
            throw new Error('The class or event must end before it can be completed');
        }
        if (input.status === 'CANCELLATION_REQUESTED') throw new Error('Only the customer can request cancellation');
        if (!capacityReleaseStatuses.has(booking.status) && capacityReleaseStatuses.has(input.status)) await this.releaseCapacity(ctx, booking);
        booking.status = input.status;
        if (input.internalNote !== undefined) booking.internalNote = input.internalNote;
        if (input.secureAccessReference !== undefined) booking.secureAccessReference = input.secureAccessReference;
        if (input.status === 'CONFIRMED') booking.cancellationRequestedAt = null;
        if (capacityReleaseStatuses.has(input.status)) {
            booking.cancelledAt = new Date();
            booking.renewalToken = null;
            if (booking.billingModel === 'MONTHLY') booking.paymentStatus = 'TERMINATED';
        }
        await this.connection.getRepository(ctx, MarketplaceBooking).save(booking, { reload: false });
        await this.marketplaceOrderService.synchronizeBookingOrder(ctx, booking);
        await this.chatService.recordSubscriptionUpdate(ctx, booking, `Booking ${input.status.toLowerCase().replace(/_/g, ' ')}.${booking.internalNote ? ` ${booking.internalNote}` : ''}`);
        return (await this.withDetails(ctx, [booking]))[0]!;
    }

    async requestCancellation(ctx: RequestContext, input: RequestSubscriptionCancellationInput) {
        const activeUserId = requireActiveUserId(ctx);
        const booking = await assertFound(this.findOne(ctx, input.id));
        if (booking.customerId !== String(activeUserId)) throw new Error('This subscription belongs to another customer');
        if (booking.billingModel !== 'MONTHLY') throw new Error('Only active class subscriptions use this cancellation flow');
        if (!['PENDING', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED'].includes(booking.status) || booking.paymentStatus === 'UNPAID') throw new Error('This subscription cannot be cancelled in its current state');
        booking.status = 'CANCELLATION_REQUESTED';
        booking.cancellationRequestedAt = new Date();
        booking.renewalToken = null;
        booking.customerNote = String(input.reason ?? '').trim().slice(0, 1000) || booking.customerNote;
        await this.connection.getRepository(ctx, MarketplaceBooking).save(booking, { reload: false });
        await this.chatService.recordSubscriptionUpdate(ctx, booking, `Unsubscribe requested for ${booking.subscriptionClassName || 'this class subscription'}.${booking.customerNote ? ` ${booking.customerNote}` : ''}`);
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: booking.vendorProfileId } });
        if (vendor) {
            await this.eventBus.publish(new MarketplaceSubscriptionCancellationEvent(
                ctx,
                vendor.contactEmail || vendor.ownerEmailAddress,
                vendor.shopName,
                booking.customerName || 'A customer',
                booking.title,
                booking.subscriptionClassName || 'Class subscription',
                booking.customerNote,
            ));
        }
        return (await this.withDetails(ctx, [booking]))[0]!;
    }

    async findRenewal(ctx: RequestContext, token: string) {
        const activeUserId = requireActiveUserId(ctx);
        const booking = await this.connection.getRepository(ctx, MarketplaceBooking).findOne({
            where: { renewalToken: token.trim(), customerId: String(activeUserId) },
        });
        if (!booking || capacityReleaseStatuses.has(booking.status) || booking.status === 'CANCELLATION_REQUESTED' || booking.paymentStatus !== 'GRACE' || !booking.graceEndsAt || booking.graceEndsAt <= new Date()) {
            throw new Error('This renewal link is invalid or has expired');
        }
        const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({
            where: { id: booking.productVariantId },
            relations: ['translations', 'product', 'product.translations'],
        });
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: booking.vendorProfileId } });
        if (!variant?.product || !vendor) throw new Error('This class is no longer available');
        const session = booking.availabilitySessionId
            ? await this.connection.getRepository(ctx, MarketplaceAvailabilitySession).findOne({ where: { id: booking.availabilitySessionId } })
            : null;
        const periodDays = Math.max(1, Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / dayMs));
        const nextStartsAt = new Date(booking.endsAt.getTime() + dayMs);
        const nextEndsAt = new Date(nextStartsAt.getTime() + periodDays * dayMs);
        return {
            bookingId: String(booking.id),
            productId: String(variant.product.id),
            productVariantId: String(variant.id),
            productName: booking.title,
            productSlug: variant.product.translations?.[0]?.slug ?? String(variant.product.id),
            variantName: variant.name || variant.translations?.[0]?.name || variant.sku,
            sku: variant.sku,
            vendorProfileId: String(vendor.id),
            vendorName: vendor.shopName,
            vendorSlug: vendor.slug,
            price: booking.agreedPrice ?? session?.price ?? variant.listPrice,
            className: booking.subscriptionClassName || session?.name || 'Recurring class',
            graceEndsAt: booking.graceEndsAt,
            periodDays,
            nextStartsAt,
            nextEndsAt,
        };
    }

    async attachUnpaidSellerOrders(ctx: RequestContext, sellerOrders: Order[]) {
        const repository = this.connection.getRepository(ctx, MarketplaceBooking);
        for (const order of sellerOrders) {
            for (const line of order.lines) {
                const fields = line.customFields as Record<string, unknown> | undefined;
                const id = String(fields?.marketplaceBookingId ?? '').trim();
                if (!id) continue;
                const booking = await repository.findOne({ where: { id } });
                if (!booking || booking.customerId !== String(ctx.activeUserId)
                    || booking.productVariantId !== String(line.productVariant.id)
                    || booking.status !== 'PENDING' || booking.paymentStatus !== 'UNPAID'
                    || booking.orderId && booking.orderId !== String(order.id)) {
                    throw new Error('This booking cannot be attached to the direct purchase');
                }
                booking.orderId = String(order.id);
                await repository.save(booking, { reload: false });
            }
        }
    }

    async confirmForSellerOrders(ctx: RequestContext, sellerOrders: Order[], companyConfirmed = false) {
        const lines = sellerOrders.flatMap(order => order.lines.flatMap(line => {
            const fields = line.customFields as Record<string, unknown> | undefined;
            const bookingId = String(fields?.marketplaceBookingId ?? '').trim();
            const renewalBookingId = String(fields?.marketplaceRenewalBookingId ?? '').trim();
            return [
                ...(bookingId ? [{ order, line, bookingId, renewal: false }] : []),
                ...(renewalBookingId ? [{ order, line, bookingId: renewalBookingId, renewal: true }] : []),
            ];
        }));
        if (!lines.length) return 0;
        const bookings = await this.connection.getRepository(ctx, MarketplaceBooking).find({
            where: { id: In([...new Set(lines.map(item => item.bookingId))]) },
        });
        const byId = new Map(bookings.map(booking => [String(booking.id), booking]));
        const activeUserId = ctx.activeUserId ? String(ctx.activeUserId) : '';
        let confirmed = 0;
        for (const item of lines) {
            const booking = byId.get(item.bookingId);
            if (!booking) throw new Error('The workshop booking attached to this order no longer exists');
            if (activeUserId && booking.customerId !== activeUserId
                && !(companyConfirmed && ctx.userHasPermissions([Permission.SuperAdmin]))) throw new Error('This booking belongs to another customer');
            if (booking.productVariantId !== String(item.line.productVariant.id)) throw new Error('The workshop booking price does not match the ordered item');
            if (item.renewal) {
                if (booking.lastRenewalOrderId === String(item.order.id)) continue;
                if (capacityReleaseStatuses.has(booking.status) || booking.status === 'CANCELLATION_REQUESTED' || booking.paymentStatus !== 'GRACE' || !booking.graceEndsAt || booking.graceEndsAt <= new Date()) {
                    throw new Error('This subscription renewal is no longer payable');
                }
                const periodDays = Math.max(1, Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / dayMs));
                booking.startsAt = new Date(booking.endsAt.getTime() + dayMs);
                booking.endsAt = new Date(booking.startsAt.getTime() + periodDays * dayMs);
                booking.lastRenewalOrderId = String(item.order.id);
                booking.paymentStatus = 'PAID';
                booking.status = 'CONFIRMED';
                booking.paidAt = new Date();
                booking.graceEndsAt = null;
                booking.renewalToken = null;
                booking.renewalReminderSentAt = null;
                await this.connection.getRepository(ctx, MarketplaceBooking).save(booking, { reload: false });
                await this.chatService.recordSubscriptionUpdate(ctx, booking, 'Renewal payment received. Your class enrollment remains active.', 'PAID');
                confirmed++;
                continue;
            }
            if (booking.orderId && booking.orderId !== String(item.order.id)) throw new Error('This workshop booking has already been paid on another order');
            if (booking.orderId === String(item.order.id) && booking.paymentStatus === 'PAID') continue;
            if (booking.status !== 'PENDING' || booking.paymentStatus !== 'UNPAID') throw new Error('This booking is no longer awaiting payment');
            booking.orderId = String(item.order.id);
            booking.paymentStatus = 'PAID';
            booking.paidAt = new Date();
            if (booking.billingModel !== 'MONTHLY') booking.status = 'CONFIRMED';
            await this.connection.getRepository(ctx, MarketplaceBooking).save(booking, { reload: false });
            confirmed++;
        }
        return confirmed;
    }

    async releaseExpiredPending(ctx: RequestContext) {
        const expiresAt = new Date(Date.now() - 30 * 60 * 1000);
        const bookings = await this.connection.getRepository(ctx, MarketplaceBooking).find({
            where: { status: 'PENDING', paymentStatus: 'UNPAID', orderId: IsNull(), createdAt: LessThanOrEqual(expiresAt) },
        });
        for (const booking of bookings) {
            await this.releaseCapacity(ctx, booking);
            booking.status = 'CANCELLED';
            booking.cancelledAt = new Date();
            booking.internalNote = 'Unpaid booking reservation expired after 30 minutes';
        }
        if (bookings.length) await this.connection.getRepository(ctx, MarketplaceBooking).save(bookings, { reload: false });
        return bookings.length;
    }

    async processSubscriptionRenewals(ctx: RequestContext) {
        const now = new Date();
        const due = await this.connection.getRepository(ctx, MarketplaceBooking).find({
            where: [
                { billingModel: 'MONTHLY', status: 'CONFIRMED', paymentStatus: 'PAID', endsAt: LessThanOrEqual(now) },
                { billingModel: 'MONTHLY', status: 'RESCHEDULED', paymentStatus: 'PAID', endsAt: LessThanOrEqual(now) },
                { billingModel: 'MONTHLY', status: 'PENDING', paymentStatus: 'PAID', endsAt: LessThanOrEqual(now) },
                { billingModel: 'MONTHLY', status: 'COMPLETED', paymentStatus: 'PAID', endsAt: LessThanOrEqual(now) },
                { billingModel: 'MONTHLY', status: 'CANCELLATION_REQUESTED', paymentStatus: 'PAID', endsAt: LessThanOrEqual(now) },
            ],
        });
        if (due.length) {
            const users = await this.connection.getRepository(ctx, User).find({
                where: { id: In([...new Set(due.map(booking => booking.customerId))]) },
            });
            const userById = new Map(users.map(user => [String(user.id), user]));
            for (const booking of due) {
                await this.marketplaceOrderService.synchronizeBookingOrder(ctx, booking);
                const session = booking.availabilitySessionId
                    ? await this.connection.getRepository(ctx, MarketplaceAvailabilitySession).findOne({ where: { id: booking.availabilitySessionId } })
                    : null;
                const gracePeriodDays = Math.max(0, Math.min(30, session?.gracePeriodDays ?? 5));
                booking.paymentStatus = 'GRACE';
                // Hold the quoted renewal fee fixed until this grace period ends.
                booking.agreedPrice = session?.price ?? booking.agreedPrice ?? 0;
                booking.graceEndsAt = new Date(booking.endsAt.getTime() + gracePeriodDays * dayMs);
                booking.renewalToken = booking.status === 'CANCELLATION_REQUESTED' ? null : randomBytes(24).toString('base64url');
                booking.renewalReminderSentAt = now;
                await this.connection.getRepository(ctx, MarketplaceBooking).save(booking, { reload: false });
                if (booking.status === 'CANCELLATION_REQUESTED') {
                    await this.chatService.recordSubscriptionUpdate(ctx, booking, 'Your unsubscribe request is recorded. Your enrollment will end after the renewal grace period.');
                    continue;
                }
                if (booking.graceEndsAt <= now) continue;
                await this.chatService.recordSubscriptionRenewal(ctx, booking, booking.agreedPrice);
                const user = userById.get(booking.customerId);
                if (user?.identifier) {
                    await this.eventBus.publish(new MarketplaceSubscriptionRenewalEvent(
                        ctx,
                        user.identifier,
                        booking.title,
                        booking.subscriptionClassName || session?.name || 'Recurring class',
                        booking.endsAt,
                        booking.graceEndsAt,
                        booking.renewalToken!,
                    ));
                }
            }
        }
        const awaitingRenewal = await this.connection.getRepository(ctx, MarketplaceBooking).find({
            where: { billingModel: 'MONTHLY', paymentStatus: 'GRACE' },
        });
        for (const booking of awaitingRenewal) {
            if (!booking.renewalToken || !booking.graceEndsAt || booking.graceEndsAt <= now || booking.status === 'CANCELLATION_REQUESTED' || capacityReleaseStatuses.has(booking.status)) continue;
            await this.chatService.recordSubscriptionRenewal(ctx, booking, booking.agreedPrice ?? 0);
        }
        const expired = await this.connection.getRepository(ctx, MarketplaceBooking).find({
            where: { billingModel: 'MONTHLY', paymentStatus: 'GRACE', graceEndsAt: LessThanOrEqual(now) },
        });
        for (const booking of expired) {
            await this.releaseCapacity(ctx, booking);
            booking.status = 'TERMINATED';
            booking.paymentStatus = 'TERMINATED';
            booking.cancelledAt = now;
            booking.renewalToken = null;
            booking.internalNote = 'Subscription ended because renewal was not paid before the grace deadline';
            await this.chatService.recordSubscriptionUpdate(ctx, booking, 'Your class subscription has ended because renewal was not paid within the grace period. Your place is now available to other customers.', 'EXPIRED');
        }
        if (expired.length) await this.connection.getRepository(ctx, MarketplaceBooking).save(expired, { reload: false });
        return due.length;
    }

    private async reserveSession(
        ctx: RequestContext,
        sessionId: string,
        productId: string,
        quantity: number,
        scheduleType: MarketplaceAvailabilitySession['scheduleType'],
        oneDayPass = false,
    ) {
        const repository = this.connection.getRepository(ctx, MarketplaceAvailabilitySession);
        const session = await repository.findOne({ where: { id: sessionId } });
        const now = new Date();
        if (!session || session.productId !== productId) throw new Error('The selected class or session does not belong to this listing');
        if (!session.isActive || session.scheduleType !== scheduleType) throw new Error('The selected class or session is not available');
        if (scheduleType === 'ONE_TIME') {
            if (session.endsAt <= now) throw new Error('The selected session has ended');
            if (session.bookingDeadline && session.bookingDeadline <= now) throw new Error('The booking deadline has passed');
        }
        if (oneDayPass && (!Number.isInteger(session.oneDayPrice) || Number(session.oneDayPrice) < 100)) {
            throw new Error('This class does not offer a one-day pass');
        }
        const result = await repository.createQueryBuilder()
            .update(MarketplaceAvailabilitySession)
            .set({ bookedCount: () => 'bookedCount + :quantity' })
            .where('id = :id', { id: session.id })
            .andWhere('isActive = :isActive', { isActive: true })
            .andWhere('bookedCount + :quantity <= capacity')
            .setParameter('quantity', quantity)
            .execute();
        if (result.affected !== 1) throw new Error('This class or session is full');
        return session;
    }

    private effectiveSessionPrice(session: MarketplaceAvailabilitySession, fallback: number, oneDayPass = false) {
        const configuredPrice = oneDayPass ? session.oneDayPrice : session.price;
        if (oneDayPass && (!Number.isInteger(configuredPrice) || Number(configuredPrice) < 100)) {
            throw new Error('This class does not offer a one-day pass');
        }
        const regular = Number.isInteger(configuredPrice) && Number(configuredPrice) >= 0 ? Number(configuredPrice) : fallback;
        return !oneDayPass && session.earlyBirdPrice != null && session.earlyBirdEndsAt && session.earlyBirdEndsAt > new Date()
            ? session.earlyBirdPrice
            : regular;
    }

    private async reserveTicket(ctx: RequestContext, ticketId: string, productId: string, quantity: number) {
        const repository = this.connection.getRepository(ctx, MarketplaceEventTicketType);
        const ticket = await repository.findOne({ where: { id: ticketId } });
        const now = new Date();
        if (!ticket || ticket.productId !== productId) throw new Error('The selected ticket does not belong to this event');
        if (ticket.saleStartsAt && ticket.saleStartsAt > now) throw new Error('Ticket sales have not started');
        if (ticket.saleEndsAt && ticket.saleEndsAt <= now) throw new Error('Ticket sales have ended');
        if (String(ticket.rules?.status ?? 'ACTIVE') !== 'ACTIVE') throw new Error('This ticket type is not currently available');
        const orderLimit = Number(ticket.rules?.ticketSaleLimit ?? 0);
        if (Number.isInteger(orderLimit) && orderLimit > 0 && quantity > orderLimit) throw new Error(`This ticket type allows at most ${orderLimit} ticket(s) per booking`);
        let query = repository.createQueryBuilder()
            .update(MarketplaceEventTicketType)
            .set({ soldCount: () => 'soldCount + :quantity' })
            .where('id = :id', { id: ticket.id })
            .setParameter('quantity', quantity);
        if (ticket.rules?.overbookingAllowed !== true) query = query.andWhere('soldCount + :quantity <= quantity');
        const result = await query.execute();
        if (result.affected !== 1) throw new Error('There are not enough tickets remaining in this tier');
        return ticket;
    }

    private async releaseCapacity(ctx: RequestContext, booking: MarketplaceBooking) {
        await releaseBookingCapacity(this.connection, ctx, booking);
    }

    private async currentVendor(ctx: RequestContext) {
        const activeUserId = ctx.activeUserId ? String(ctx.activeUserId) : '';
        return this.connection.getRepository(ctx, VendorProfile).findOne({
            where: [
                { channelId: String(ctx.channelId) },
                ...(activeUserId ? [{ ownerUserId: activeUserId }] : []),
            ],
        });
    }

    private async assertVendorOwnsBooking(ctx: RequestContext, booking: MarketplaceBooking) {
        const vendor = await this.currentVendor(ctx);
        if (vendor && String(vendor.id) !== booking.vendorProfileId) throw new Error('This booking belongs to another vendor');
    }

    private eventWindow(rawMetadata: unknown) {
        if (typeof rawMetadata !== 'string' || !rawMetadata) return undefined;
        try {
            const metadata = JSON.parse(rawMetadata) as { attributes?: Record<string, unknown> };
            const date = metadata.attributes?.event_date;
            const start = metadata.attributes?.start_time;
            const end = metadata.attributes?.end_time;
            if (typeof date !== 'string' || typeof start !== 'string' || typeof end !== 'string') return undefined;
            const startsAt = new Date(`${date.slice(0, 10)}T${start.slice(0, 5)}:00+05:00`);
            const endsAt = new Date(`${date.slice(0, 10)}T${end.slice(0, 5)}:00+05:00`);
            if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt) return undefined;
            return { startsAt, endsAt };
        } catch {
            return undefined;
        }
    }

    private workshopConfiguration(rawMetadata: unknown) {
        const fallback = { billingModel: 'ONE_TIME' as const, periodDays: 30, startsAt: undefined as Date | undefined };
        if (typeof rawMetadata !== 'string' || !rawMetadata) return fallback;
        try {
            const metadata = JSON.parse(rawMetadata) as { attributes?: Record<string, unknown> };
            const attributes = metadata.attributes ?? {};
            if (attributes.billing_model !== 'Monthly subscription') return fallback;
            const configuredDays = Number(attributes.subscription_period_days);
            const periodDays = Number.isInteger(configuredDays) && configuredDays >= 1 && configuredDays <= 365 ? configuredDays : 30;
            const startText = typeof attributes.subscription_start_date === 'string' ? attributes.subscription_start_date.slice(0, 10) : '';
            const startsAt = startText ? new Date(`${startText}T00:00:00+05:00`) : undefined;
            return {
                billingModel: 'MONTHLY' as const,
                periodDays,
                startsAt: startsAt && Number.isFinite(startsAt.getTime()) ? startsAt : undefined,
            };
        } catch {
            return fallback;
        }
    }
}
