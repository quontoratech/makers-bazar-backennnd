import 'reflect-metadata';
import assert from 'node:assert/strict';
import { DataSource, EntitySchema, PrimaryGeneratedColumn } from 'typeorm';
import { Customer, EventBus, Injector, Order, ProductVariant, RequestContext, TransactionalConnection, User, VendureEntity } from '@vendure/core';
import { MarketplacePayoutSettings } from '../plugins/marketplace/modules/finance/entities/marketplace-payout-settings.entity';
import { MarketplaceAvailabilitySession } from '../plugins/marketplace/modules/catalog/entities/marketplace-availability-session.entity';
import { MarketplaceBooking } from '../plugins/marketplace/modules/booking/entities/booking.entity';
import { BookingService } from '../plugins/marketplace/modules/booking/services/booking.service';
import { VendorProfile } from '../plugins/marketplace/modules/vendor/entities/vendor-profile.entity';
import { MarketplaceChatService } from '../plugins/marketplace/modules/chat/services/marketplace-chat.service';
import { MarketplaceOrderService } from '../plugins/marketplace/modules/order/services/marketplace-order.service';
import { MarketplaceChatMessage } from '../plugins/marketplace/modules/chat/entities/marketplace-chat-message.entity';
import { MarketplaceChatConversation } from '../plugins/marketplace/modules/chat/entities/marketplace-chat-conversation.entity';
import { MarketplaceChatRealtimeService } from '../plugins/marketplace/modules/chat/services/marketplace-chat-realtime.service';
import { MarketplaceQuotePriceCalculationStrategy } from '../plugins/marketplace/modules/chat/config/marketplace-quote-price-calculation-strategy';

const day = 86400000;
const optionalText = { type: String, nullable: true } as const;
const optionalDate = { type: Date, nullable: true } as const;
const base = { id: { type: Number, primary: true, generated: true } as const, createdAt: { type: Date, createDate: true } as const, updatedAt: { type: Date, updateDate: true } as const };
const bookingSchema = new EntitySchema({ name: 'MarketplaceBooking', target: MarketplaceBooking, columns: {
    ...base, customerId: { type: String }, vendorProfileId: { type: String }, productVariantId: { type: String },
    orderId: optionalText, availabilitySessionId: optionalText, eventTicketTypeId: optionalText,
    bookingType: { type: String }, title: { type: String }, startsAt: { type: Date }, endsAt: { type: Date },
    quantity: { type: Number }, capacity: { type: Number, nullable: true }, status: { type: String }, billingModel: { type: String }, paymentStatus: { type: String },
    agreedPrice: { type: Number, nullable: true }, subscriptionClassName: optionalText, customerName: optionalText, customerEmail: optionalText,
    customerNote: optionalText, internalNote: optionalText, secureAccessReference: optionalText, renewalToken: optionalText,
    paidAt: optionalDate, graceEndsAt: optionalDate, cancelledAt: optionalDate, cancellationRequestedAt: optionalDate, renewalReminderSentAt: optionalDate, lastRenewalOrderId: optionalText,
} });
const sessionSchema = new EntitySchema({ name: 'MarketplaceAvailabilitySession', target: MarketplaceAvailabilitySession, columns: {
    ...base, productId: { type: String }, name: optionalText, startsAt: { type: Date }, endsAt: { type: Date }, scheduleType: { type: String },
    daysOfWeek: { type: 'simple-json', nullable: true }, startTime: optionalText, endTime: optionalText,
    price: { type: Number }, oneDayPrice: { type: Number, nullable: true }, earlyBirdPrice: { type: Number, nullable: true }, earlyBirdEndsAt: optionalDate,
    gracePeriodDays: { type: Number }, isActive: { type: Boolean }, capacity: { type: Number }, bookedCount: { type: Number }, bookingDeadline: optionalDate,
} });

async function main() {
    PrimaryGeneratedColumn()(VendureEntity.prototype, 'id');
    const db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [bookingSchema, sessionSchema, MarketplacePayoutSettings], synchronize: true }).initialize();
    try {
        const bookings = db.getRepository(MarketplaceBooking);
        const sessions = db.getRepository(MarketplaceAvailabilitySession);
        const customerContext = (id: string) => ({ activeUserId: id, channelId: 'vendor-channel' } as unknown as RequestContext);
        const ctx = customerContext('customer-0');
        const variant = { id: 'variant', enabled: true, listPrice: 200000, productId: 'product', sku: 'YOGA', product: { id: 'product', enabled: true, name: 'Yoga', translations: [{ slug: 'yoga' }], customFields: { vendorProfileId: 'vendor', marketplaceType: 'WORKSHOP', marketplaceMetadata: JSON.stringify({ attributes: { billing_model: 'Monthly subscription', subscription_period_days: 30 } }) } } };
        const vendor = { id: 'vendor', contactEmail: 'vendor@example.test', shopName: 'Vendor' };
        const connection = { getRepository(_ctx: unknown, entity: unknown) {
            if (entity === MarketplacePayoutSettings) return db.getRepository(MarketplacePayoutSettings);
            if (entity === MarketplaceBooking) return bookings;
            if (entity === MarketplaceAvailabilitySession) return sessions;
            if (entity === ProductVariant) return { findOne: async () => variant, find: async () => [variant] };
            if (entity === Customer) return { findOne: async () => ({ firstName: 'Test', lastName: 'Customer', emailAddress: 'customer@example.test' }) };
            if (entity === User) return { find: async () => Array.from({ length: 25 }, (_, index) => ({ id: `customer-${index}`, identifier: `customer-${index}@example.test` })) };
            if (entity === VendorProfile) return { findOne: async () => vendor };
            if (entity === Order) return { find: async () => [] };
            throw new Error('Unexpected repository');
        }, withTransaction: (ctx: RequestContext, work: (ctx: RequestContext) => Promise<unknown>) => db.transaction(() => work(ctx)) } as unknown as TransactionalConnection;
        const emails: unknown[] = [];
        const updates: Array<{ status: string; quoteStatus?: string }> = [];
        const renewalCalls: string[] = [];
        const financeSync: Array<{ id: string; paymentStatus: string; status: string; type: string }> = [];
        const service = new BookingService(connection, { publish: async (event: unknown) => { emails.push(event); } } as unknown as EventBus,
            { recordSubscriptionRenewal: async (_ctx: unknown, booking: MarketplaceBooking) => { renewalCalls.push(String(booking.id)); }, recordSubscriptionUpdate: async (_ctx: unknown, booking: MarketplaceBooking, _body: string, quoteStatus?: string) => { updates.push({ status: booking.status, quoteStatus }); } } as unknown as MarketplaceChatService,
            { listVendorWorkshopOrders: async () => [], updateVendorStatus: async () => {}, synchronizeBookingOrder: async (_ctx: unknown, booking: MarketplaceBooking) => {
                financeSync.push({ id: String(booking.id), paymentStatus: booking.paymentStatus, status: booking.status, type: booking.bookingType });
            } } as unknown as MarketplaceOrderService);
        const session = await sessions.save(sessions.create({ productId: 'product', name: 'Morning', startsAt: new Date(), endsAt: new Date(Date.now() + day), scheduleType: 'SUBSCRIPTION_CLASS', daysOfWeek: ['Monday'], startTime: '09:00', endTime: '10:00', price: 200000, gracePeriodDays: 5, capacity: 20, bookedCount: 0, isActive: true }));
        const input = { vendorProfileId: 'vendor', productVariantId: 'variant', availabilitySessionId: String(session.id), bookingType: 'WORKSHOP' as const, title: 'Yoga', startsAt: new Date(), endsAt: new Date(Date.now() + 30 * day), quantity: 1 };
        const requests = await Promise.allSettled(Array.from({ length: 25 }, (_, index) => service.create(customerContext(`customer-${index}`), input)));
        assert.equal(requests.filter(result => result.status === 'fulfilled').length, 20, 'Exactly 20 enrollments must fit');
        assert.equal(requests.filter(result => result.status === 'rejected').length, 5, 'All requests beyond capacity must fail');
        assert.equal((await sessions.findOneByOrFail({ id: session.id })).bookedCount, 20);
        const [booking, cancelBooking] = await bookings.find({ order: { id: 'ASC' } });
        assert(booking && cancelBooking);
        const bookingContext = customerContext(booking.customerId);
        await assert.rejects(service.create(bookingContext, input), /already have an active enrollment/, 'A customer cannot open a second active enrollment for the same class');
        await service.updateStatus(ctx, { id: cancelBooking.id, status: 'CANCELLED' });
        await service.updateStatus(ctx, { id: cancelBooking.id, status: 'CANCELLED' });
        assert.equal((await sessions.findOneByOrFail({ id: session.id })).bookedCount, 19, 'Cancellation frees exactly one place');
        await service.create(customerContext('replacement-customer'), input);
        assert.equal((await sessions.findOneByOrFail({ id: session.id })).bookedCount, 20, 'Freed place must be bookable again');
        await assert.rejects(service.updateStatus(ctx, { id: booking.id, status: 'COMPLETED' }), /Monthly subscriptions stay active/);
        // Existing monthly records marked completed must still reach renewal.
        await bookings.update(booking.id, { orderId: 'seller', status: 'COMPLETED', paymentStatus: 'PAID', startsAt: new Date(Date.now() - 31 * day), endsAt: new Date(Date.now() - day) });
        await service.processSubscriptionRenewals(ctx);
        let renewed = await bookings.findOneByOrFail({ id: booking.id });
        assert.equal(renewed.paymentStatus, 'GRACE');
        assert(financeSync.some(item => item.id === String(booking.id) && item.paymentStatus === 'PAID'), 'The completed paid subscription period must reach finance before renewal begins');
        assert(renewed.renewalToken && renewed.graceEndsAt);
        assert.equal(emails.length, 1, 'One renewal email per expired period');
        await service.processSubscriptionRenewals(ctx);
        assert.equal(emails.length, 1, 'Scheduler reruns must not send duplicate emails');
        assert(renewalCalls.includes(String(booking.id)), 'Renewal must reach chat');
        await sessions.update(session.id, { price: 250000 });
        const renewalDetails = await service.findRenewal(bookingContext, renewed.renewalToken!);
        assert.equal(renewalDetails.price, 200000, 'Renewal checkout must keep the quoted fee after class prices change');
        assert(renewalDetails.variantName, 'Renewal data must always provide the required variant name');
        assert.equal(renewalDetails.nextStartsAt.getTime(), renewed.endsAt.getTime() + day, 'Next access starts the day after the current period ends');
        const prices = new MarketplaceQuotePriceCalculationStrategy();
        prices.init({ get: () => connection } as unknown as Injector);
        const price = await prices.calculateUnitPrice(bookingContext, variant as unknown as ProductVariant, { marketplaceRenewalBookingId: String(booking.id) }, {} as Order);
        assert.equal(price.price, 200000, 'Final order calculation must charge the same quoted fee');
        const oldEnd = renewed.endsAt.getTime();
        const renewalOrder = { id: 'renewal-order', lines: [{ productVariant: { id: 'variant' }, customFields: { marketplaceRenewalBookingId: String(booking.id) } }] } as unknown as Order;
        await service.confirmForSellerOrders(bookingContext, [renewalOrder]);
        await service.confirmForSellerOrders(bookingContext, [renewalOrder]);
        renewed = await bookings.findOneByOrFail({ id: booking.id });
        assert.equal(renewed.startsAt.getTime(), oldEnd + day, 'Paid renewal starts on the next calendar day');
        assert.equal(renewed.endsAt.getTime(), oldEnd + 31 * day, 'Payment adds one full period after the next-day start');
        assert.equal(renewed.paymentStatus, 'PAID'); assert.equal(renewed.status, 'CONFIRMED');
        assert.equal(renewed.graceEndsAt, null, 'Successful renewal must clear the stored grace deadline');
        assert.equal(renewed.renewalToken, null, 'Successful renewal must clear the stored checkout token');
        assert.equal((await sessions.findOneByOrFail({ id: session.id })).bookedCount, 20, 'Renewal keeps its reserved seat');
        await bookings.update(booking.id, { paymentStatus: 'GRACE', graceEndsAt: new Date(Date.now() - 1000), renewalToken: 'expired' });
        await service.processSubscriptionRenewals(ctx);
        await service.processSubscriptionRenewals(ctx);
        assert.equal((await bookings.findOneByOrFail({ id: booking.id })).status, 'TERMINATED');
        assert.equal((await sessions.findOneByOrFail({ id: session.id })).bookedCount, 19, 'Grace expiry releases exactly one seat');
        await assert.rejects(service.confirmForSellerOrders(bookingContext, [{ ...renewalOrder, id: 'late-renewal' } as Order]), /no longer payable/);
        const activeContext = customerContext('active-customer');
        const active = await service.create(activeContext, input);
        await bookings.update(active.id, { orderId: 'seller-2', paymentStatus: 'PAID', status: 'CONFIRMED', startsAt: new Date(Date.now() - 31 * day), endsAt: new Date(Date.now() - day) });
        await service.requestCancellation(activeContext, { id: active.id, reason: 'Unsubscribe' });
        const beforeQuotes = renewalCalls.length;
        await service.processSubscriptionRenewals(ctx);
        let cancelled = await bookings.findOneByOrFail({ id: active.id });
        assert.equal(cancelled.paymentStatus, 'GRACE'); assert(!cancelled.renewalToken);
        assert.equal(renewalCalls.length, beforeQuotes, 'Unsubscribe must not send a payable renewal quotation');
        await bookings.update(active.id, { graceEndsAt: new Date(Date.now() - 1000) });
        await service.processSubscriptionRenewals(ctx);
        cancelled = await bookings.findOneByOrFail({ id: active.id });
        assert.equal(cancelled.status, 'TERMINATED');
        assert.equal((await sessions.findOneByOrFail({ id: session.id })).bookedCount, 19, 'Unsubscribe expires and releases enrollment');
        assert(updates.some(update => update.quoteStatus === 'PAID') && updates.some(update => update.quoteStatus === 'EXPIRED'));

        // Exercise the real chat quotation writer without sending to any live account.
        const messages: MarketplaceChatMessage[] = [];
        const conversation = { id: 'chat', vendorOwnerUserId: 'vendor-user', vendorName: 'Vendor' } as unknown as MarketplaceChatConversation;
        const chatConnection = { getRepository(_ctx: unknown, entity: unknown) {
            if (entity === MarketplaceChatMessage) return {
                findOne: async ({ where }: { where: { clientMessageId: string } }) => messages.find(message => message.clientMessageId === where.clientMessageId),
                find: async () => messages,
                save: async (message: MarketplaceChatMessage) => { if (!message.id) { message.id = String(messages.length + 1); message.createdAt = new Date(); messages.push(message); } return message; },
            };
            if (entity === MarketplaceChatConversation) return { save: async () => conversation };
            if (entity === ProductVariant) return { findOne: async () => variant };
            throw new Error('Unexpected chat repository');
        } } as unknown as TransactionalConnection;
        const chat = new MarketplaceChatService(chatConnection, { publishMessage: () => {} } as unknown as MarketplaceChatRealtimeService);
        Object.assign(chat, { subscriptionConversation: async () => conversation });
        const due = { ...renewed, renewalToken: 'test-token', paymentStatus: 'GRACE', graceEndsAt: new Date(Date.now() + 5 * day) } as MarketplaceBooking;
        await chat.recordSubscriptionRenewal(ctx, due, 200000);
        await chat.recordSubscriptionRenewal(ctx, due, 200000);
        assert.equal(messages.length, 1, 'Duplicate scheduler runs must create one quotation');
        assert.equal(messages[0]!.metadata?.quote?.checkoutUrl, '/subscriptions/renew?token=test-token');
        assert.equal(messages[0]!.metadata?.quote?.amount, 200000);
        await chat.recordSubscriptionUpdate(ctx, due, 'Renewed', 'PAID');
        assert.equal(messages[0]!.metadata?.quote?.status, 'PAID', 'Paid quotations must stop offering checkout');
        console.log(JSON.stringify({ capacity: '20 enrollments; 21st rejected; cancelled place reusable', renewal: 'chat quotation and email; payment extends once', graceExpiry: 'seat released once; late payment rejected', unsubscribe: 'no payable quotation; enrollment expires', legacyCompletedSubscription: 'renewal preserved', result: 'PASS' }, null, 2));
    } finally { await db.destroy(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
