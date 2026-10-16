import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { assertFound, ID, Product, RequestContext, TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';
import type Stripe from 'stripe';
import { In } from 'typeorm';

import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplaceCategory } from '../../catalog/entities/marketplace-category.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import {
    CreatePromotionCampaignInput,
    CreatePromotionRateInput,
    CreatePromotionRequestInput,
    ReviewPromotionCampaignInput,
    ReviewPromotionRequestInput,
    SubmitPromotionPaymentInput,
    UpdatePromotionCampaignInput,
} from '../dto/promotion.inputs';
import { MarketplacePromotionPayment } from '../entities/marketplace-promotion-payment.entity';
import { MarketplacePromotionRate } from '../entities/marketplace-promotion-rate.entity';
import { MarketplacePromotionRequest } from '../entities/marketplace-promotion-request.entity';
import { MarketplacePromotionSettings } from '../entities/marketplace-promotion-settings.entity';
import { PromotionCampaign } from '../entities/promotion-campaign.entity';
import {
    categoryContains,
    effectivePromotionStatus,
    maximumPromotionOverlap,
    PROMOTION_DAY_MS,
    promotionSurfaces,
    reservationIsLive,
    selectPromotionRate,
} from '../promotion-policy';
import { PromotionCardGateway } from './promotion-card-gateway.service';
import { PromotionFinanceService } from './promotion-finance.service';

@Injectable()
export class PromotionService {
    constructor(
        private connection: TransactionalConnection,
        private cardGateway: PromotionCardGateway,
        private promotionFinance: PromotionFinanceService,
    ) {}

    async paymentOptions(ctx: RequestContext) {
        const settings = await this.settings(ctx);
        return {
            cardEnabled: this.cardGateway.configured,
            manualEnabled: Boolean(settings.paymentInstructions.trim()),
        };
    }

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
    ): Promise<MarketplaceList<PromotionCampaign>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection
            .getRepository(ctx, PromotionCampaign)
            .findAndCount({ skip, take, order: { startsAt: 'DESC' } });
        return { items: await this.campaignsWithUsage(ctx, items), totalItems };
    }

    async findActive(ctx: RequestContext, placement?: string) {
        if (placement) this.assertPlacement(placement);
        const now = new Date();
        const campaigns = await this.connection
            .getRepository(ctx, PromotionCampaign)
            .find({
                where: { status: 'ACTIVE', ownerType: 'PLATFORM', campaignType: 'PLACEMENT' },
                order: { createdAt: 'DESC' },
            });
        return this.campaignsWithUsage(ctx, campaigns.filter(
            campaign =>
                campaign.startsAt <= now &&
                campaign.endsAt > now &&
                (!placement || campaign.placement === placement || campaign.placement === 'BOTH'),
        ));
    }

    async vendorCampaigns(ctx: RequestContext) {
        await this.vendorForContext(ctx);
        const campaigns = (
            await this.connection.getRepository(ctx, PromotionCampaign).find({
                where: {
                    ownerType: 'PLATFORM',
                    campaignType: 'PLACEMENT',
                    status: 'ACTIVE',
                },
                order: { startsAt: 'ASC' },
            })
        ).filter(campaign => campaign.endsAt > new Date());
        return this.campaignsWithUsage(ctx, campaigns);
    }

    async settings(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplacePromotionSettings);
        let settings = await repository.findOne({ where: { key: 'default' } });
        if (!settings) {
            await repository
                .createQueryBuilder()
                .insert()
                .values({
                    key: 'default',
                    homeSlots: 3,
                    categorySlots: 3,
                    paymentWindowHours: 48,
                    paymentInstructions: '',
                })
                .orIgnore()
                .execute();
            settings = await repository.findOne({ where: { key: 'default' } });
        }
        if (!settings) throw new Error('Promotion settings could not be loaded');
        return settings;
    }

    async updateSettings(
        ctx: RequestContext,
        input: {
            homeSlots: number;
            categorySlots: number;
            paymentWindowHours: number;
            paymentInstructions: string;
        },
    ) {
        for (const [key, max] of [
            ['homeSlots', 50],
            ['categorySlots', 50],
            ['paymentWindowHours', 168],
        ] as const) {
            if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > max)
                throw new Error(key + ' must be between 1 and ' + max);
        }
        const settings = await this.settings(ctx);
        Object.assign(settings, input, {
            paymentInstructions: String(input.paymentInstructions ?? '')
                .trim()
                .slice(0, 4000),
        });
        return this.connection.getRepository(ctx, MarketplacePromotionSettings).save(settings);
    }

    async findRates(ctx: RequestContext, mine = false) {
        const rates = await this.connection
            .getRepository(ctx, MarketplacePromotionRate)
            .find({ order: { active: 'DESC', scope: 'ASC', updatedAt: 'DESC' } });
        if (!mine) return rates;
        const vendor = await this.vendorForContext(ctx);
        return rates.filter(
            rate => rate.active && (!rate.vendorProfileId || rate.vendorProfileId === String(vendor.id)),
        );
    }

    async targets(ctx: RequestContext) {
        const vendors = await this.connection
            .getRepository(ctx, VendorProfile)
            .find({ where: { status: 'APPROVED' }, order: { shopName: 'ASC' } });
        const categories = await this.connection
            .getRepository(ctx, MarketplaceCategory)
            .find({ where: { isActive: true }, order: { code: 'ASC' } });
        return {
            vendors: vendors.map(vendor => ({
                id: String(vendor.id),
                code: vendor.slug,
                name: vendor.shopName,
            })),
            categories: categories.map(category => ({
                id: String(category.id),
                code: category.code,
                name: category.name,
            })),
        };
    }

    async findRequests(ctx: RequestContext, status?: string, mine = false, options?: MarketplaceListOptions) {
        const where = mine ? { vendorProfileId: String((await this.vendorForContext(ctx)).id) } : {};
        const requests = await this.connection
            .getRepository(ctx, MarketplacePromotionRequest)
            .find({ where, order: { createdAt: 'DESC', id: 'DESC' } });
        const items = requests
            .map(request => ({
                ...request,
                status: effectivePromotionStatus(request),
                cardCheckoutOpen: false,
            }))
            .filter(request => !status || request.status === status);
        const openCheckouts = await this.connection.getRepository(ctx, MarketplacePromotionPayment).find({
            where: { status: 'CHECKOUT_OPEN', ...(mine ? where : {}) },
        });
        for (const request of items)
            request.cardCheckoutOpen = openCheckouts.some(
                payment => payment.requestId === String(request.id),
            );
        const { skip, take } = normalizeListOptions(options ?? { take: 200 });
        return { items: items.slice(skip, skip + take), totalItems: items.length };
    }

    async createRate(ctx: RequestContext, input: CreatePromotionRateInput) {
        if (!['GLOBAL', 'VENDOR', 'CATEGORY', 'VENDOR_CATEGORY', 'CAMPAIGN'].includes(input.scope))
            throw new Error('Choose a valid promotion rate scope');
        this.assertPlacement(input.placement);
        if (
            !Number.isSafeInteger(input.pricePerDay) ||
            input.pricePerDay < 1 ||
            input.pricePerDay > 100_000_000
        )
            throw new Error('Enter a valid positive daily price');
        if (input.currencyCode && input.currencyCode !== 'PKR') throw new Error('Promotion payments use PKR');
        const needsVendor = ['VENDOR', 'VENDOR_CATEGORY'].includes(input.scope);
        const needsCategory = ['CATEGORY', 'VENDOR_CATEGORY'].includes(input.scope);
        if (needsVendor && !input.vendorProfileId) throw new Error('Choose a vendor for this rate');
        if (needsCategory && !input.categoryId) throw new Error('Choose a category for this rate');
        if (input.scope === 'CAMPAIGN' && !input.campaignId)
            throw new Error('Choose a campaign for this rate');
        if (needsVendor)
            await assertFound(
                this.connection
                    .getRepository(ctx, VendorProfile)
                    .findOne({ where: { id: input.vendorProfileId, status: 'APPROVED' } }),
            );
        const category = needsCategory
            ? await assertFound(
                  this.connection
                      .getRepository(ctx, MarketplaceCategory)
                      .findOne({ where: { id: input.categoryId, isActive: true } }),
              )
            : undefined;
        if (input.scope === 'CAMPAIGN') {
            const campaign = await assertFound(this.findOne(ctx, input.campaignId!));
            if (
                campaign.ownerType !== 'PLATFORM' ||
                campaign.campaignType !== 'PLACEMENT' ||
                ['COMPLETED', 'REJECTED'].includes(this.effectiveCampaignStatus(campaign))
            ) throw new Error('Choose an available placement campaign for this rate');
            if (campaign.placement !== 'BOTH' && campaign.placement !== input.placement)
                throw new Error('Rate placement must be supported by the campaign');
        }
        const repository = this.connection.getRepository(ctx, MarketplacePromotionRate);
        const rate = input.id
            ? await assertFound(repository.findOne({ where: { id: input.id } }))
            : new MarketplacePromotionRate();
        Object.assign(rate, {
            scope: input.scope,
            placement: input.placement,
            vendorProfileId: needsVendor ? String(input.vendorProfileId) : null,
            categoryId: category ? String(category.id) : null,
            categoryCode: category?.code ?? null,
            campaignId: input.scope === 'CAMPAIGN' ? String(input.campaignId) : null,
            pricePerDay: input.pricePerDay,
            currencyCode: 'PKR',
            active: input.active !== false,
            note: input.note?.trim().slice(0, 1000) || null,
        });
        return repository.save(rate);
    }

    async quote(ctx: RequestContext, input: CreatePromotionRequestInput) {
        const request = await this.prepareRequest(ctx, input);
        const settings = await this.settings(ctx);
        const unavailable = await this.unavailableSurface(ctx, request, settings);
        return {
            pricePerDay: request.pricePerDay,
            amount: request.amount,
            currencyCode: request.currencyCode,
            rateScope: request.rateScope,
            startsAt: request.startsAt,
            endsAt: request.endsAt,
            available: !unavailable,
            message: unavailable ? unavailable + ' promotion slots are full for these dates' : null,
        };
    }

    async createRequest(ctx: RequestContext, input: CreatePromotionRequestInput) {
        await this.lockCapacity(ctx);
        const request = await this.prepareRequest(ctx, input);
        if (input.expectedAmount != null && request.amount !== input.expectedAmount)
            throw new Error('The daily price changed. Refresh the quote before submitting');
        const duplicates = await this.connection.getRepository(ctx, MarketplacePromotionRequest).find({
            where: {
                vendorProfileId: request.vendorProfileId,
                placement: request.placement,
                status: In([
                    'PENDING_REVIEW',
                    'PENDING_PAYMENT',
                    'PAYMENT_SUBMITTED',
                    'PAYMENT_VERIFIED',
                    'APPROVED',
                ]),
            },
        });
        if (
            duplicates.some(
                item =>
                    effectivePromotionStatus(item) !== 'EXPIRED' &&
                    item.targetType === request.targetType &&
                    (request.targetType === 'PRODUCT'
                        ? item.productId === request.productId
                        : item.categoryId === request.categoryId) &&
                    item.startsAt < request.endsAt &&
                    item.endsAt > request.startsAt,
            )
        )
            throw new Error('You already have an open promotion request for this target and period');
        request.code = 'PROMO-' + randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase();
        request.status = 'PENDING_REVIEW';
        request.paymentStatus = 'UNPAID';
        request.submittedAt = new Date();
        request.priority = 0;
        return this.connection.getRepository(ctx, MarketplacePromotionRequest).save(request);
    }

    async submitPayment(ctx: RequestContext, input: SubmitPromotionPaymentInput) {
        await this.lockCapacity(ctx);
        const request = await this.findOwnedRequest(ctx, input.id);
        await this.assertNoOpenCardCheckout(ctx, request);
        if (
            effectivePromotionStatus(request) !== 'PENDING_PAYMENT' ||
            !['UNPAID', 'REJECTED'].includes(request.paymentStatus)
        )
            throw new Error(
                'Wait for space approval before paying, or submit a new request if the payment deadline has expired',
            );
        const reference = String(input.paymentReference ?? '').trim();
        if (reference.length < 3 || reference.length > 160)
            throw new Error('Enter a payment reference of 3 to 160 characters');
        const repository = this.connection.getRepository(ctx, MarketplacePromotionRequest);
        const duplicate = await repository.findOne({ where: { paymentReference: reference } });
        if (duplicate && String(duplicate.id) !== String(request.id))
            throw new Error('This payment reference has already been used for another promotion');
        request.paymentReference = reference;
        request.paymentNote = input.paymentNote?.trim().slice(0, 1000) || undefined;
        request.paymentSubmittedAt = new Date();
        request.paymentStatus = 'SUBMITTED';
        request.status = 'PAYMENT_SUBMITTED';
        await repository.save(request);
        await this.promotionFinance.recordManual(ctx, request);
        return request;
    }

    async cancelMine(ctx: RequestContext, id: ID) {
        await this.lockCapacity(ctx);
        const request = await this.findOwnedRequest(ctx, id);
        await this.assertNoOpenCardCheckout(ctx, request);
        if (
            !['PENDING_REVIEW', 'PENDING_PAYMENT'].includes(request.status) ||
            request.paymentStatus === 'VERIFIED' ||
            request.paymentStatus === 'SUBMITTED'
        )
            throw new Error('Only an unpaid request can be cancelled here');
        request.status = 'CANCELLED';
        return this.connection.getRepository(ctx, MarketplacePromotionRequest).save(request);
    }

    async reviewRequest(ctx: RequestContext, input: ReviewPromotionRequestInput) {
        const settings = await this.lockCapacity(ctx);
        const repository = this.connection.getRepository(ctx, MarketplacePromotionRequest);
        const request = await assertFound(repository.findOne({ where: { id: input.id } }));
        const now = new Date();
        if (input.status === 'APPROVE_SPACE') {
            if (request.status !== 'PENDING_REVIEW')
                throw new Error('This request has already been reviewed');
            if (!settings.paymentInstructions.trim() && !this.cardGateway.configured)
                throw new Error(
                    'Configure card payments or add marketplace payment instructions before requesting payment',
                );
            await this.assertRequestTarget(ctx, request);
            const configuredPaymentDueAt = new Date(
                now.getTime() + settings.paymentWindowHours * 3_600_000,
            );
            // Reserve one stable period before asking for money. A late review moves the
            // whole period after the payment window; activation never moves a paid booking again.
            if (request.startsAt < configuredPaymentDueAt) {
                request.startsAt = configuredPaymentDueAt;
                request.endsAt = new Date(
                    configuredPaymentDueAt.getTime() + request.durationDays * PROMOTION_DAY_MS,
                );
            }
            await this.validateCampaignPeriod(ctx, request);
            const unavailable = await this.unavailableSurface(ctx, request, settings);
            if (unavailable) throw new Error(unavailable + ' promotion space is full for these dates');
            request.status = 'PENDING_PAYMENT';
            request.reviewedAt = now;
            request.reviewedByUserId = String(ctx.activeUserId);
            request.paymentDueAt = configuredPaymentDueAt;
        } else if (input.status === 'PAYMENT_VERIFIED') {
            if (request.status !== 'PAYMENT_SUBMITTED' || request.paymentStatus !== 'SUBMITTED')
                throw new Error('A submitted payment reference is required before verification');
            request.paymentStatus = 'VERIFIED';
            request.status = 'PAYMENT_VERIFIED';
            request.paymentVerifiedAt = now;
            request.paymentVerifiedByUserId = String(ctx.activeUserId);
        } else if (input.status === 'APPROVED') {
            if (request.status !== 'PAYMENT_VERIFIED' || request.paymentStatus !== 'VERIFIED')
                throw new Error('Verify the received payment before activating the promotion');
            await this.assertRequestTarget(ctx, request);
            await this.validateCampaignPeriod(ctx, request);
            const unavailable = await this.unavailableSurface(ctx, request, settings);
            if (unavailable) throw new Error(unavailable + ' promotion space is full for these dates');
            request.status = 'APPROVED';
            request.approvedAt = now;
        } else if (input.status === 'REJECTED') {
            if (!['PENDING_REVIEW', 'PAYMENT_SUBMITTED'].includes(request.status))
                throw new Error('This request cannot be rejected in its current state');
            if (!input.adminNote?.trim()) throw new Error('Add a reason for rejection');
            if (request.status === 'PAYMENT_SUBMITTED') {
                request.paymentStatus = 'REJECTED';
                request.status = 'PENDING_PAYMENT';
                request.paymentDueAt = new Date(now.getTime() + settings.paymentWindowHours * 3_600_000);
            } else request.status = 'REJECTED';
        } else if (input.status === 'CANCELLED') {
            await this.assertNoOpenCardCheckout(ctx, request);
            if (['CANCELLED', 'REJECTED', 'EXPIRED'].includes(effectivePromotionStatus(request, now)))
                throw new Error('This request is already closed');
            if (request.paymentStatus === 'SUBMITTED')
                throw new Error('Verify or reject the submitted payment before stopping this request');
            if (!input.adminNote?.trim()) throw new Error('Add a reason for stopping the promotion');
            request.status = 'CANCELLED';
        } else throw new Error('Choose a valid promotion review action');
        request.adminNote = input.adminNote?.trim().slice(0, 2000) || request.adminNote;
        await repository.save(request);
        if (['PAYMENT_VERIFIED', 'REJECTED'].includes(input.status)) {
            const cardPayment = request.paymentReference
                ? await this.connection
                      .getRepository(ctx, MarketplacePromotionPayment)
                      .findOne({ where: { reference: request.paymentReference, method: 'CARD' } })
                : null;
            if (!cardPayment) await this.promotionFinance.recordManual(ctx, request);
        }
        return request;
    }

    async createCardCheckout(ctx: RequestContext, id: ID) {
        await this.lockCapacity(ctx);
        const request = await this.findOwnedRequest(ctx, id);
        if (
            effectivePromotionStatus(request) !== 'PENDING_PAYMENT' ||
            !['UNPAID', 'REJECTED'].includes(request.paymentStatus)
        )
            throw new Error('This promotion is not awaiting payment');
        const repository = this.connection.getRepository(ctx, MarketplacePromotionPayment);
        const open = await repository.findOne({ where: { requestId: String(id), status: 'CHECKOUT_OPEN' } });
        if (open?.checkoutSessionId) {
            const session = await this.cardGateway.retrieve(open.checkoutSessionId);
            if (session.payment_status === 'paid') {
                await this.settleCardPayment(ctx, session);
                return { url: null, paymentStatus: 'VERIFIED' };
            }
            if (session.status === 'open' && session.url)
                return { url: session.url, paymentStatus: 'UNPAID' };
            open.status = 'EXPIRED';
            await repository.save(open);
        }
        const key = `promotion-${randomUUID()}`;
        const session = await this.cardGateway.create(request, key);
        await repository.save(
            new MarketplacePromotionPayment({
                key,
                requestId: String(id),
                vendorProfileId: request.vendorProfileId,
                method: 'CARD',
                status: 'CHECKOUT_OPEN',
                amount: request.amount,
                currencyCode: request.currencyCode,
                checkoutSessionId: session.id,
                refundedAmount: 0,
            }),
        );
        return { url: session.url, paymentStatus: 'UNPAID' };
    }

    async syncCardCheckout(ctx: RequestContext, sessionId: string) {
        if (!/^cs_(test_|live_)?[a-zA-Z0-9_]+$/.test(sessionId) || sessionId.length > 255)
            throw new Error('Invalid checkout session');
        await this.lockCapacity(ctx);
        const payment = await this.connection
            .getRepository(ctx, MarketplacePromotionPayment)
            .findOne({ where: { checkoutSessionId: sessionId } });
        if (!payment) throw new Error('This checkout session is not available');
        const request = await this.findOwnedRequest(ctx, payment.requestId);
        const session = await this.cardGateway.retrieve(sessionId);
        if (session.payment_status === 'paid') return this.settleCardPayment(ctx, session);
        if (session.status === 'expired') {
            payment.status = 'EXPIRED';
            await this.connection.getRepository(ctx, MarketplacePromotionPayment).save(payment);
        }
        return request;
    }

    async cancelCardCheckout(ctx: RequestContext, id: ID) {
        await this.lockCapacity(ctx);
        const request = await this.findOwnedRequest(ctx, id);
        const repository = this.connection.getRepository(ctx, MarketplacePromotionPayment);
        const payment = await repository.findOne({
            where: { requestId: String(id), status: 'CHECKOUT_OPEN' },
        });
        if (!payment?.checkoutSessionId) return request;
        let session = await this.cardGateway.retrieve(payment.checkoutSessionId);
        if (session.payment_status === 'paid') return this.settleCardPayment(ctx, session);
        if (session.status === 'open') {
            try {
                session = await this.cardGateway.expire(session.id);
            } catch {
                session = await this.cardGateway.retrieve(session.id);
            }
        }
        if (session.payment_status === 'paid') return this.settleCardPayment(ctx, session);
        if (session.status !== 'expired')
            throw new Error('Payment is being processed. Refresh before switching payment method.');
        payment.status = 'EXPIRED';
        await repository.save(payment);
        return request;
    }

    async handleCardEvent(ctx: RequestContext, event: Stripe.Event) {
        await this.lockCapacity(ctx);
        if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
            const object = event.data.object as Stripe.Checkout.Session;
            if (!object.metadata?.promotionRequestId) return;
            const session = await this.cardGateway.retrieve(object.id);
            if (session.payment_status === 'paid') await this.settleCardPayment(ctx, session);
        } else if (event.type === 'checkout.session.expired') {
            const session = event.data.object as Stripe.Checkout.Session;
            await this.connection
                .getRepository(ctx, MarketplacePromotionPayment)
                .update({ checkoutSessionId: session.id, status: 'CHECKOUT_OPEN' }, { status: 'EXPIRED' });
        } else if (event.type === 'charge.refunded') {
            const charge = await this.cardGateway.charge((event.data.object as Stripe.Charge).id);
            const reference =
                typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
            if (!reference) return;
            const repository = this.connection.getRepository(ctx, MarketplacePromotionPayment);
            const payment = await repository.findOne({ where: { reference, method: 'CARD' } });
            if (!payment) return;
            payment.refundedAmount = Math.min(payment.amount, charge.amount_refunded);
            if (payment.refundedAmount === payment.amount) payment.status = 'REFUNDED';
            await repository.save(payment);
            await this.connection
                .getRepository(ctx, MarketplacePromotionRequest)
                .update(
                    { id: payment.requestId },
                    { status: 'CANCELLED', adminNote: 'Promotion stopped after a card payment refund.' },
                );
        }
    }

    private async settleCardPayment(ctx: RequestContext, session: Stripe.Checkout.Session) {
        const repository = this.connection.getRepository(ctx, MarketplacePromotionPayment);
        const payment = await repository.findOne({ where: { checkoutSessionId: session.id } });
        if (!payment) throw new Error('This checkout session is not available');
        const request = await this.connection
            .getRepository(ctx, MarketplacePromotionRequest)
            .findOne({ where: { id: payment.requestId } });
        if (!request) throw new Error('This promotion request is not available');
        if (
            session.payment_status !== 'paid' ||
            payment.method !== 'CARD' ||
            payment.amount !== request.amount ||
            payment.currencyCode !== request.currencyCode ||
            payment.vendorProfileId !== request.vendorProfileId ||
            session.amount_total !== payment.amount ||
            session.currency?.toUpperCase() !== payment.currencyCode ||
            session.mode !== 'payment' ||
            session.client_reference_id !== String(request.id) ||
            session.metadata?.promotionRequestId !== String(request.id) ||
            session.metadata?.paymentKey !== payment.key ||
            session.metadata.vendorProfileId !== request.vendorProfileId
        )
            throw new Error('Card payment does not match this promotion');
        if (payment.verifiedAt) return request;
        const intent = session.payment_intent as Stripe.PaymentIntent;
        if (!intent || typeof intent === 'string' || intent.status !== 'succeeded')
            throw new Error('Card payment has not settled');
        const charge = intent.latest_charge as Stripe.Charge | null;
        payment.reference = intent.id;
        payment.status = 'VERIFIED';
        payment.verifiedAt = new Date();
        payment.cardBrand =
            charge && typeof charge !== 'string'
                ? (charge.payment_method_details?.card?.brand ?? undefined)
                : undefined;
        payment.cardLast4 =
            charge && typeof charge !== 'string'
                ? (charge.payment_method_details?.card?.last4 ?? undefined)
                : undefined;
        payment.refundedAmount =
            charge && typeof charge !== 'string' ? Math.min(payment.amount, charge.amount_refunded) : 0;
        if (payment.refundedAmount === payment.amount) payment.status = 'REFUNDED';
        payment.note = 'Verified by Stripe';
        await repository.save(payment);
        if (request.paymentStatus !== 'VERIFIED') {
            request.paymentStatus = 'VERIFIED';
            request.paymentReference = intent.id;
            request.paymentSubmittedAt = payment.verifiedAt;
            request.paymentVerifiedAt = payment.verifiedAt;
            request.paymentNote = payment.note;
            // A late webhook must record money, but must never revive an admin-cancelled request.
            if (request.status === 'PENDING_PAYMENT') request.status = 'PAYMENT_VERIFIED';
            if (payment.refundedAmount > 0) request.status = 'CANCELLED';
            await this.connection.getRepository(ctx, MarketplacePromotionRequest).save(request);
        }
        return request;
    }

    private async assertNoOpenCardCheckout(ctx: RequestContext, request: MarketplacePromotionRequest) {
        const open = await this.connection.getRepository(ctx, MarketplacePromotionPayment).findOne({
            where: { requestId: String(request.id), status: 'CHECKOUT_OPEN' },
        });
        if (open) throw new Error('Close or finish the open card checkout before changing this request');
    }

    async activePlacementMap(ctx: RequestContext, categoryCode?: string) {
        const now = new Date();
        const requests = (
            await this.connection.getRepository(ctx, MarketplacePromotionRequest).find({
                where: { status: 'APPROVED', paymentStatus: 'VERIFIED' },
                order: { approvedAt: 'DESC', id: 'DESC' },
            })
        ).filter(
            request =>
                request.startsAt <= now &&
                request.endsAt > now &&
                (categoryCode
                    ? promotionSurfaces(request.placement).includes('CATEGORY') &&
                      (categoryContains(categoryCode, request.categoryCode) ||
                          categoryContains(request.categoryCode, categoryCode))
                    : promotionSurfaces(request.placement).includes('HOME')),
        );
        const campaigns = requests.some(request => request.campaignId)
            ? await this.connection.getRepository(ctx, PromotionCampaign).find()
            : [];
        const map = new Map<string, { placement: string; endsAt: Date; rank: number }>();
        const products = requests.length ? await this.connection.getRepository(ctx, Product).find() : [];
        const vendors = requests.length
            ? await this.connection.getRepository(ctx, VendorProfile).find({
                  where: { id: In(requests.map(request => request.vendorProfileId)), status: 'APPROVED' },
              })
            : [];
        const categories = requests.length
            ? await this.connection.getRepository(ctx, MarketplaceCategory).find({
                  where: {
                      id: In(
                          requests
                              .map(request => request.categoryId)
                              .filter((id): id is string => Boolean(id)),
                      ),
                      isActive: true,
                  },
              })
            : [];
        for (const [index, request] of requests.entries()) {
            if (
                !vendors.some(
                    vendor =>
                        String(vendor.id) === request.vendorProfileId &&
                        !vendor.paused &&
                        !['REMOVED', 'RESTRICTED'].includes(vendor.enforcementStatus),
                )
            )
                continue;
            if (
                !categories.some(
                    category =>
                        String(category.id) === request.categoryId && category.code === request.categoryCode,
                )
            )
                continue;
            if (
                request.campaignId &&
                !campaigns.some(
                    campaign =>
                        String(campaign.id) === request.campaignId &&
                        campaign.status === 'ACTIVE' &&
                        campaign.startsAt <= now &&
                        campaign.endsAt > now,
                )
            )
                continue;
            const ids = products
                .filter(product => this.productMatchesRequest(product, request))
                .map(product => String(product.id));
            for (const id of ids)
                if (!map.has(id))
                    map.set(id, { placement: request.placement, endsAt: request.endsAt, rank: index + 1 });
        }
        return map;
    }

    findOne(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, PromotionCampaign).findOne({ where: { id } });
    }

    async create(ctx: RequestContext, input: CreatePromotionCampaignInput) {
        const startsAt = this.validDate(input.startsAt);
        const endsAt = this.validDate(input.endsAt);
        if (endsAt <= startsAt) throw new Error('Campaign end must be after its start');
        if (startsAt.getTime() < Date.now() - 60_000)
            throw new Error('Campaign start cannot be in the past');
        if (endsAt <= new Date()) throw new Error('Campaign end must be in the future');
        const title = this.campaignTitle(input.title);
        const description = this.campaignDescription(input.description);
        if (!['PLATFORM', 'VENDOR', 'COMMERCIAL_BRAND'].includes(input.ownerType))
            throw new Error('Choose a valid campaign owner');
        const ownerId = String(input.ownerId ?? '').trim();
        if (input.ownerType !== 'PLATFORM' && !ownerId)
            throw new Error('Choose the campaign owner');
        if (!['PLACEMENT', 'AFFILIATE', 'EVENT', 'COLLECTION', 'LOYALTY'].includes(input.campaignType))
            throw new Error('Choose a valid campaign type');
        this.assertPlacement(input.placement);
        this.assertCampaignBudget(input.budget ?? 0);
        await this.assertCampaignTarget(ctx, input.target);
        if (
            !Number.isInteger(input.maxPlacements ?? 3) ||
            (input.maxPlacements ?? 3) < 1 ||
            (input.maxPlacements ?? 3) > 50
        )
            throw new Error('Campaign slots must be between 1 and 50');
        return this.connection.getRepository(ctx, PromotionCampaign).save(
            new PromotionCampaign({
                ...input,
                ownerId: input.ownerType === 'PLATFORM' ? undefined : ownerId,
                title,
                description,
                startsAt,
                endsAt,
                code:
                    (normalizeString(title, '-').toUpperCase() || 'CAMPAIGN') +
                    '-' +
                    randomUUID().slice(0, 8).toUpperCase(),
                budget: input.budget ?? 0,
                maxPlacements: input.maxPlacements ?? 3,
                status: input.ownerType === 'PLATFORM' ? 'DRAFT' : 'PENDING',
                metrics: { impressions: 0, clicks: 0, conversions: 0 },
            }),
        );
    }

    async update(ctx: RequestContext, input: UpdatePromotionCampaignInput) {
        await this.lockCapacity(ctx);
        const repository = this.connection.getRepository(ctx, PromotionCampaign);
        const campaign = await assertFound(repository.findOne({ where: { id: input.id } }));
        const now = new Date();
        const wasCompleted = this.effectiveCampaignStatus(campaign, now) === 'COMPLETED';
        const title = input.title === undefined ? campaign.title : this.campaignTitle(input.title);
        const description =
            input.description === undefined
                ? campaign.description
                : this.campaignDescription(input.description ?? undefined);
        const placement = input.placement ?? campaign.placement;
        const budget = input.budget ?? campaign.budget;
        const maxPlacements = input.maxPlacements ?? campaign.maxPlacements;
        const startsAt = input.startsAt === undefined ? campaign.startsAt : this.validDate(input.startsAt);
        const endsAt = input.endsAt === undefined ? campaign.endsAt : this.validDate(input.endsAt);
        const target = input.target === undefined ? campaign.target ?? undefined : input.target ?? undefined;
        const creative = input.creative === undefined ? campaign.creative ?? undefined : input.creative ?? undefined;
        if (endsAt <= startsAt) throw new Error('Campaign end must be after its start');
        this.assertPlacement(placement);
        this.assertCampaignBudget(budget);
        if (!Number.isInteger(maxPlacements) || maxPlacements < 1 || maxPlacements > 50)
            throw new Error('Campaign slots must be between 1 and 50');
        await this.assertCampaignTarget(ctx, target);

        const linked = await this.connection.getRepository(ctx, MarketplacePromotionRequest).find({
            where: { campaignId: String(campaign.id) },
        });
        const open = linked.filter(request =>
            ['PENDING_REVIEW', 'PENDING_PAYMENT', 'PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED', 'APPROVED'].includes(
                request.status,
            ) && effectivePromotionStatus(request, now) !== 'EXPIRED',
        );
        const categoryCode = this.campaignCategoryCode(target);
        for (const request of open) {
            if (startsAt > request.startsAt || endsAt < request.endsAt)
                throw new Error('Campaign dates must continue to cover every open vendor promotion');
            if (placement !== 'BOTH' && placement !== request.placement)
                throw new Error('Campaign placement must continue to support every open vendor promotion');
            if (categoryCode && !categoryContains(categoryCode, request.categoryCode))
                throw new Error('Campaign category must continue to include every open vendor promotion');
        }
        const reservations = linked.filter(request => reservationIsLive(request, now));
        const reservedPlacements = maximumPromotionOverlap(reservations, startsAt, endsAt);
        if (maxPlacements < reservedPlacements)
            throw new Error(`Campaign already has ${reservedPlacements} overlapping reserved placements`);
        const incompatibleRate = (
            await this.connection.getRepository(ctx, MarketplacePromotionRate).find({
                where: { campaignId: String(campaign.id), active: true },
            })
        ).find(rate => placement !== 'BOTH' && rate.placement !== placement);
        if (incompatibleRate)
            throw new Error('Pause or edit campaign rates that use the previous placement first');

        Object.assign(campaign, {
            title,
            description: description ?? null,
            placement,
            budget,
            maxPlacements,
            startsAt,
            endsAt,
            target,
            creative,
        });
        // Extending an automatically ended campaign requires an explicit Activate action.
        if (wasCompleted && campaign.status === 'ACTIVE' && endsAt > now)
            campaign.status = 'PAUSED';
        return repository.save(campaign);
    }

    async review(ctx: RequestContext, input: ReviewPromotionCampaignInput) {
        if (!['APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED'].includes(input.status))
            throw new Error('Choose a valid campaign status');
        await this.lockCapacity(ctx);
        const campaign = await assertFound(this.findOne(ctx, input.id));
        const current = this.effectiveCampaignStatus(campaign);
        if (current === input.status || (current === 'SCHEDULED' && campaign.status === input.status))
            return campaign;
        const transitions: Record<string, string[]> = {
            DRAFT: ['APPROVED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED'],
            PENDING: ['APPROVED', 'REJECTED'],
            APPROVED: ['ACTIVE', 'PAUSED', 'COMPLETED', 'REJECTED'],
            ACTIVE: ['PAUSED', 'COMPLETED'],
            SCHEDULED: ['PAUSED', 'COMPLETED'],
            PAUSED: ['APPROVED', 'ACTIVE', 'COMPLETED'],
            COMPLETED: [],
            REJECTED: [],
        };
        if (!(transitions[current] ?? []).includes(input.status))
            throw new Error(`Campaign cannot move from ${current} to ${input.status}`);
        if (['ACTIVE', 'APPROVED'].includes(input.status) && campaign.endsAt <= new Date())
            throw new Error('Extend the campaign end date before activating it');
        campaign.status = input.status;
        return this.connection.getRepository(ctx, PromotionCampaign).save(campaign);
    }

    private async campaignsWithUsage(ctx: RequestContext, campaigns: PromotionCampaign[]) {
        if (!campaigns.length) return [];
        const now = new Date();
        const ids = new Set(campaigns.map(campaign => String(campaign.id)));
        const reservations = (await this.connection.getRepository(ctx, MarketplacePromotionRequest).find())
            .filter(request => request.campaignId && ids.has(request.campaignId) && reservationIsLive(request, now));
        return campaigns.map(campaign => ({
            ...campaign,
            effectiveStatus: this.effectiveCampaignStatus(campaign, now),
            reservedPlacements: maximumPromotionOverlap(
                reservations.filter(request => request.campaignId === String(campaign.id)),
                campaign.startsAt,
                campaign.endsAt,
            ),
        }));
    }

    private effectiveCampaignStatus(campaign: PromotionCampaign, now = new Date()) {
        if (campaign.status === 'ACTIVE') {
            if (campaign.endsAt <= now) return 'COMPLETED';
            if (campaign.startsAt > now) return 'SCHEDULED';
            return 'ACTIVE';
        }
        return campaign.status;
    }

    private campaignTitle(value: string) {
        const title = String(value ?? '').trim();
        if (!title) throw new Error('Enter a campaign title');
        if (title.length > 160) throw new Error('Campaign title must be 160 characters or fewer');
        return title;
    }

    private campaignDescription(value?: string) {
        const description = String(value ?? '').trim();
        if (description.length > 2000)
            throw new Error('Campaign description must be 2,000 characters or fewer');
        return description || undefined;
    }

    private assertCampaignBudget(value: number) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647)
            throw new Error('Enter a valid campaign budget');
    }

    private campaignCategoryCode(target?: Record<string, string | string[]>) {
        const categoryCode = target?.categoryCode;
        if (categoryCode === undefined) return undefined;
        if (typeof categoryCode !== 'string' || !categoryCode.trim())
            throw new Error('Choose a valid campaign category');
        return categoryCode.trim();
    }

    private async assertCampaignTarget(
        ctx: RequestContext,
        target?: Record<string, string | string[]>,
    ) {
        const categoryCode = this.campaignCategoryCode(target);
        if (!categoryCode) return;
        const category = await this.connection.getRepository(ctx, MarketplaceCategory).findOne({
            where: { code: categoryCode, isActive: true },
        });
        if (!category) throw new Error('Choose an active campaign category');
    }

    private async vendorForContext(ctx: RequestContext) {
        if (!ctx.activeUserId) throw new Error('Vendor access required');
        const vendor = await this.connection
            .getRepository(ctx, VendorProfile)
            .findOne({ where: { channelId: String(ctx.channelId), status: 'APPROVED' } });
        if (
            !vendor ||
            vendor.paused ||
            vendor.enforcementStatus === 'REMOVED' ||
            vendor.enforcementStatus === 'RESTRICTED'
        )
            throw new Error('An active approved vendor shop is required');
        return vendor;
    }

    private async findOwnedRequest(ctx: RequestContext, id: ID) {
        const vendor = await this.vendorForContext(ctx);
        const request = await this.connection
            .getRepository(ctx, MarketplacePromotionRequest)
            .findOne({ where: { id, vendorProfileId: String(vendor.id) } });
        if (!request) throw new Error('This promotion request is not available in your shop');
        return request;
    }

    private productMetadata(product: Product): Record<string, unknown> {
        const raw = (product.customFields as Record<string, unknown> | undefined)?.marketplaceMetadata;
        try {
            const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : {};
            return value && typeof value === 'object' && !Array.isArray(value)
                ? (value as Record<string, unknown>)
                : {};
        } catch {
            return {};
        }
    }

    private productMatchesRequest(product: Product, request: MarketplacePromotionRequest) {
        const categoryCode = String(this.productMetadata(product).categoryCode ?? '');
        return (
            product.enabled &&
            !product.deletedAt &&
            String((product.customFields as Record<string, unknown>)?.vendorProfileId) ===
                request.vendorProfileId &&
            (request.targetType === 'VENDOR_CATEGORY'
                ? categoryContains(request.categoryCode, categoryCode)
                : String(product.id) === request.productId && categoryCode === request.categoryCode)
        );
    }

    private async assertRequestTarget(ctx: RequestContext, request: MarketplacePromotionRequest) {
        const vendor = await this.connection
            .getRepository(ctx, VendorProfile)
            .findOne({ where: { id: request.vendorProfileId, status: 'APPROVED' } });
        if (!vendor || vendor.paused || ['REMOVED', 'RESTRICTED'].includes(vendor.enforcementStatus))
            throw new Error('The vendor shop is no longer eligible for promotion');
        const category = request.categoryId
            ? await this.connection
                  .getRepository(ctx, MarketplaceCategory)
                  .findOne({ where: { id: request.categoryId, isActive: true } })
            : null;
        if (!category || category.code !== request.categoryCode)
            throw new Error('The promoted category is no longer available');
        const products = await this.connection
            .getRepository(ctx, Product)
            .find(request.targetType === 'PRODUCT' ? { where: { id: request.productId } } : {});
        if (!products.some(product => this.productMatchesRequest(product, request)))
            throw new Error('The promoted listing is no longer published in its original category');
    }

    private validDate(value: Date) {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid promotion date');
        return date;
    }

    private assertPlacement(placement: string) {
        if (!['HOME', 'CATEGORY', 'BOTH'].includes(placement))
            throw new Error('Choose a valid promotion placement');
    }

    private async prepareRequest(ctx: RequestContext, input: CreatePromotionRequestInput) {
        const vendor = await this.vendorForContext(ctx);
        this.assertPlacement(input.placement);
        const targetType = input.targetType ?? 'PRODUCT';
        if (!['PRODUCT', 'VENDOR_CATEGORY'].includes(targetType))
            throw new Error('Choose a listing or your category collection');
        const product =
            targetType === 'PRODUCT' && input.productId
                ? await this.connection
                      .getRepository(ctx, Product)
                      .findOne({ where: { id: input.productId }, relations: ['translations'] })
                : undefined;
        if (
            targetType === 'PRODUCT' &&
            (!product?.enabled ||
                product.deletedAt ||
                String((product.customFields as Record<string, unknown>)?.vendorProfileId) !==
                    String(vendor.id))
        )
            throw new Error('Choose a published listing from your own catalog');
        const metadata = product ? this.productMetadata(product) : {};
        const categoryId = targetType === 'VENDOR_CATEGORY' ? input.categoryId : metadata.categoryId;
        const category = categoryId
            ? await this.connection
                  .getRepository(ctx, MarketplaceCategory)
                  .findOne({ where: { id: String(categoryId), isActive: true } })
            : undefined;
        if (!category) throw new Error('Choose an active category');
        if (targetType === 'VENDOR_CATEGORY') {
            const owned = (await this.connection.getRepository(ctx, Product).find()).filter(
                item =>
                    item.enabled &&
                    !item.deletedAt &&
                    String((item.customFields as Record<string, unknown>)?.vendorProfileId) ===
                        String(vendor.id) &&
                    categoryContains(category.code, String(this.productMetadata(item).categoryCode ?? '')),
            );
            if (!owned.length)
                throw new Error('You need a published listing in this category before promoting it');
        }
        const startsAt = this.validDate(input.startsAt);
        if (startsAt.getTime() < Date.now() - 60_000)
            throw new Error('Choose a promotion start time in the future');
        if (!Number.isInteger(input.durationDays) || input.durationDays < 1 || input.durationDays > 90)
            throw new Error('Choose between 1 and 90 promotion days');
        const endsAt = new Date(startsAt.getTime() + input.durationDays * PROMOTION_DAY_MS);
        const request = new MarketplacePromotionRequest({
            targetType,
            productId: product ? String(product.id) : undefined,
            productName:
                product?.translations.find(item => item.languageCode === ctx.languageCode)?.name ??
                product?.translations[0]?.name ??
                vendor.shopName + ' / ' + category.name,
            productSlug:
                product?.translations.find(item => item.languageCode === ctx.languageCode)?.slug ??
                product?.translations[0]?.slug ??
                '',
            vendorProfileId: String(vendor.id),
            vendorName: vendor.shopName,
            categoryId: String(category.id),
            categoryCode: category.code,
            categoryName: category.name,
            placement: input.placement,
            campaignId: input.campaignId ? String(input.campaignId) : undefined,
            startsAt,
            endsAt,
            durationDays: input.durationDays,
        });
        const campaign = await this.validateCampaignPeriod(ctx, request);
        request.campaignCode = campaign?.code;
        const rate = selectPromotionRate(await this.findRates(ctx), {
            vendorId: String(vendor.id),
            categoryId: String(category.id),
            categoryCode: category.code,
            campaignId: request.campaignId,
            placement: request.placement,
        });
        if (!rate) throw new Error('Admin has not configured a daily price for this placement');
        request.pricePerDay = rate.pricePerDay;
        request.amount = rate.pricePerDay * input.durationDays;
        request.currencyCode = rate.currencyCode;
        request.rateScope = rate.scope;
        if (!Number.isSafeInteger(request.amount) || request.amount > 2_147_483_647)
            throw new Error('The promotion total exceeds the supported amount');
        return request;
    }

    private async validateCampaignPeriod(ctx: RequestContext, request: MarketplacePromotionRequest) {
        if (!request.campaignId) return undefined;
        const campaign = await assertFound(this.findOne(ctx, request.campaignId));
        if (
            campaign.ownerType !== 'PLATFORM' ||
            campaign.campaignType !== 'PLACEMENT' ||
            campaign.status !== 'ACTIVE' ||
            campaign.startsAt > request.startsAt ||
            campaign.endsAt < request.endsAt ||
            (campaign.placement !== request.placement && campaign.placement !== 'BOTH')
        )
            throw new Error('Choose a campaign that supports the placement and complete promotion period');
        if (
            campaign.target?.categoryCode &&
            !categoryContains(String(campaign.target.categoryCode), request.categoryCode)
        )
            throw new Error('This campaign is for a different category');
        return campaign;
    }

    private async lockCapacity(ctx: RequestContext) {
        const settings = await this.settings(ctx);
        // Serialize space approvals across processes inside the resolver transaction.
        await this.connection
            .getRepository(ctx, MarketplacePromotionSettings)
            .update(settings.id, { updatedAt: new Date() });
        return this.settings(ctx);
    }

    private async unavailableSurface(
        ctx: RequestContext,
        request: MarketplacePromotionRequest,
        settings: MarketplacePromotionSettings,
    ) {
        const now = new Date();
        const reservations = (
            await this.connection.getRepository(ctx, MarketplacePromotionRequest).find()
        ).filter(item => String(item.id) !== String(request.id) && reservationIsLive(item, now));
        for (const surface of promotionSurfaces(request.placement)) {
            // Child listings also appear on their parent category page and share its slots.
            const matching = reservations.filter(
                item =>
                    promotionSurfaces(item.placement).includes(surface) &&
                    (surface === 'HOME' ||
                        item.categoryCode.split('/')[0] === request.categoryCode.split('/')[0]),
            );
            const limit = surface === 'HOME' ? settings.homeSlots : settings.categorySlots;
            if (maximumPromotionOverlap(matching, request.startsAt, request.endsAt) >= limit)
                return surface === 'HOME' ? 'Homepage' : 'Category';
        }
        const campaign = request.campaignId ? await this.findOne(ctx, request.campaignId) : null;
        if (
            campaign &&
            maximumPromotionOverlap(
                reservations.filter(item => item.campaignId === request.campaignId),
                request.startsAt,
                request.endsAt,
            ) >= campaign.maxPlacements
        )
            return 'Campaign';
        return undefined;
    }
}
