import {
    Injector,
    Order,
    OrderItemPriceCalculationStrategy,
    PriceCalculationResult,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';

import { MarketplaceListingQuote } from '../entities/marketplace-listing-quote.entity';
import { MarketplaceBooking } from '../../booking/entities/booking.entity';

export class MarketplaceQuotePriceCalculationStrategy implements OrderItemPriceCalculationStrategy {
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async calculateUnitPrice(
        ctx: RequestContext,
        productVariant: ProductVariant,
        orderLineCustomFields: Record<string, unknown>,
        _order: Order,
    ): Promise<PriceCalculationResult> {
        const availabilityEndsAt = (productVariant.customFields as Record<string, unknown> | undefined)?.availabilityEndsAt;
        const availabilityEnd = availabilityEndsAt instanceof Date
            ? availabilityEndsAt
            : typeof availabilityEndsAt === 'string' ? new Date(availabilityEndsAt) : undefined;
        if (availabilityEnd && Number.isFinite(availabilityEnd.getTime()) && availabilityEnd.getTime() <= Date.now()) {
            throw new Error('This offer has ended and is no longer available');
        }
        const bookingId = String(orderLineCustomFields.marketplaceBookingId ?? '').trim();
        const renewalBookingId = String(orderLineCustomFields.marketplaceRenewalBookingId ?? '').trim();
        if (bookingId || renewalBookingId) {
            const booking = await this.connection.getRepository(ctx, MarketplaceBooking).findOne({
                where: { id: bookingId || renewalBookingId },
            });
            const activeUserId = String(ctx.activeUserId ?? '');
            const validInitial = bookingId
                && booking?.status === 'PENDING'
                && booking.paymentStatus === 'UNPAID'
                && !booking.orderId;
            const validRenewal = renewalBookingId
                && booking?.billingModel === 'MONTHLY'
                && !['CANCELLED', 'TERMINATED', 'REFUNDED', 'CANCELLATION_REQUESTED'].includes(booking.status)
                && booking.paymentStatus === 'GRACE'
                && booking.graceEndsAt
                && booking.graceEndsAt.getTime() > Date.now();
            if (!booking
                || (!validInitial && !validRenewal)
                || booking.customerId !== activeUserId
                || booking.productVariantId !== String(productVariant.id)) {
                throw new Error(renewalBookingId ? 'This subscription renewal is invalid or has expired' : 'This booking is invalid or has expired');
            }
            const price = booking.agreedPrice ?? productVariant.listPrice;
            return { price, priceIncludesTax: productVariant.listPriceIncludesTax };
        }
        const quoteId = String(orderLineCustomFields.marketplaceQuoteId ?? '').trim();
        if (!quoteId) {
            return { price: productVariant.listPrice, priceIncludesTax: productVariant.listPriceIncludesTax };
        }
        const quote = await this.connection.getRepository(ctx, MarketplaceListingQuote).findOne({ where: { id: quoteId } });
        if (!quote
            || quote.status !== 'SENT'
            || quote.validUntil.getTime() <= Date.now()
            || quote.customerUserId !== String(ctx.activeUserId ?? '')
            || quote.productVariantId !== String(productVariant.id)) {
            throw new Error('This personalized quotation is invalid or has expired');
        }
        return { price: quote.amount, priceIncludesTax: productVariant.listPriceIncludesTax };
    }
}
