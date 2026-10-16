import { Inject, Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { ForbiddenError, ID, Order, ProductVariant, RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

import { MARKETPLACE_PLUGIN_OPTIONS } from '../../../constants';
import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplacePluginOptions } from '../../../types';
import { AffiliateProfile } from '../../affiliate/entities/affiliate-profile.entity';
import { MarketplaceCategory } from '../../catalog/entities/marketplace-category.entity';
import { PayoutLedgerEntry } from '../../finance/entities/payout-ledger-entry.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { allocateCouponByWeight, calculateCouponDiscount, couponMatchesLine } from '../coupon-policy';
import {
    CreateMarketplaceCouponInput,
    MarketplaceCouponFilterInput,
    MarketplaceCouponQuoteItemInput,
    UpdateMarketplaceCouponInput,
} from '../dto/marketplace-coupon.inputs';
import { PromotionCampaign } from '../entities/promotion-campaign.entity';
import {
    MarketplaceCoupon,
    MarketplaceCouponFundingSource,
    MarketplaceCouponPurpose,
    MarketplaceCouponRewardRecipientType,
    MarketplaceCouponScope,
} from '../entities/marketplace-coupon.entity';
import {
    MarketplaceCouponAllocation,
    MarketplaceCouponRedemption,
    MarketplaceCouponRuleSnapshot,
} from '../entities/marketplace-coupon-redemption.entity';

interface CouponLine {
    productId: string;
    variantId: string;
    vendorId: string;
    categoryId: string;
    categoryCode: string;
    categoryName: string;
    productSlug: string;
    amount: number;
}

const activeRedemptionStatuses: MarketplaceCouponRedemption['status'][] = [
    'RESERVED',
    'APPLIED',
    'PARTIALLY_REVERSED',
];

@Injectable()
export class MarketplaceCouponService {
    constructor(
        private connection: TransactionalConnection,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
    ) {}

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        filter?: MarketplaceCouponFilterInput,
    ): Promise<MarketplaceList<MarketplaceCoupon>> {
        const { skip, take } = normalizeListOptions(options);
        const query = this.connection.getRepository(ctx, MarketplaceCoupon)
            .createQueryBuilder('coupon')
            .orderBy('coupon.createdAt', 'DESC')
            .skip(skip)
            .take(take);
        if (filter?.purpose) query.andWhere('coupon.purpose = :purpose', { purpose: filter.purpose.toUpperCase() });
        if (filter?.scope) query.andWhere('coupon.scope = :scope', { scope: filter.scope.toUpperCase() });
        if (filter?.status) query.andWhere('coupon.status = :status', { status: filter.status.toUpperCase() });
        if (filter?.term?.trim()) {
            query.andWhere(
                '(LOWER(coupon.code) LIKE :term OR LOWER(coupon.name) LIKE :term OR LOWER(coupon.targetName) LIKE :term OR LOWER(coupon.rewardRecipientName) LIKE :term)',
                { term: `%${filter.term.trim().toLowerCase()}%` },
            );
        }
        const [items, totalItems] = await query.getManyAndCount();
        return { items, totalItems };
    }

    async create(ctx: RequestContext, input: CreateMarketplaceCouponInput) {
        const normalized = await this.normalizeInput(ctx, input);
        const existing = await this.connection.getRepository(ctx, MarketplaceCoupon).findOne({
            where: { code: normalized.code },
        });
        if (existing) throw new Error('A coupon with this code already exists');
        return this.connection.getRepository(ctx, MarketplaceCoupon).save(new MarketplaceCoupon({
            ...normalized,
            createdByUserId: this.requireUser(ctx),
            updatedByUserId: this.requireUser(ctx),
        }));
    }

    async update(ctx: RequestContext, input: UpdateMarketplaceCouponInput) {
        const repository = this.connection.getRepository(ctx, MarketplaceCoupon);
        const coupon = await repository.findOne({ where: { id: input.id } });
        if (!coupon) throw new Error('Coupon not found');
        const normalized = await this.normalizeInput(ctx, input);
        const duplicate = await repository.findOne({ where: { code: normalized.code } });
        if (duplicate && String(duplicate.id) !== String(coupon.id)) {
            throw new Error('A coupon with this code already exists');
        }
        Object.assign(coupon, normalized, { updatedByUserId: this.requireUser(ctx) });
        return repository.save(coupon);
    }

    async delete(ctx: RequestContext, id: ID) {
        const repository = this.connection.getRepository(ctx, MarketplaceCoupon);
        const coupon = await repository.findOne({ where: { id } });
        if (!coupon) throw new Error('Coupon not found');
        const used = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).count({
            where: { couponId: String(coupon.id) },
        });
        if (used) {
            coupon.status = 'ARCHIVED';
            coupon.updatedByUserId = this.requireUser(ctx);
            await repository.save(coupon, { reload: false });
            return { success: true, message: 'Used coupon archived to preserve order history' };
        }
        await repository.remove(coupon);
        return { success: true, message: 'Coupon deleted' };
    }

    async quoteItems(ctx: RequestContext, code: string, items: MarketplaceCouponQuoteItemInput[]) {
        const coupon = await this.activeCoupon(ctx, code);
        const customerUserId = ctx.activeUserId == null ? undefined : String(ctx.activeUserId);
        await this.assertUsageAvailable(ctx, coupon, customerUserId);
        const lines = await this.quoteLines(ctx, items);
        return this.quoteForLines(coupon, await this.snapshot(ctx, coupon), lines);
    }

    async reserve(ctx: RequestContext, orderId: string, code: string) {
        const userId = this.requireUser(ctx);
        const order = await this.loadOrder(ctx, orderId);
        if (!order || order.type === OrderType.Seller || !order.active) {
            throw new Error('The active checkout could not be found');
        }
        if (!order.customer || String(order.customer.user?.id ?? '') !== userId) throw new ForbiddenError();

        const coupon = await this.activeCoupon(ctx, code);
        const repository = this.connection.getRepository(ctx, MarketplaceCouponRedemption);
        const existing = await repository.findOne({ where: { orderId: String(order.id) } });
        if (existing?.status === 'RESERVED' && existing.couponCode === coupon.code) return this.redemptionQuote(existing);
        if (existing && !['RELEASED', 'REVERSED'].includes(existing.status)) {
            throw new Error('This checkout already has a coupon reservation');
        }
        await this.assertUsageAvailable(ctx, coupon, userId, existing?.id);
        const snapshot = await this.snapshot(ctx, coupon);
        const quote = this.quoteForLines(coupon, snapshot, this.orderLines(order));
        if (!quote.valid || quote.amount <= 0) throw new Error(quote.message ?? 'This coupon does not apply to your basket');

        const redemption = existing ?? repository.create({ orderId: String(order.id) });
        redemption.couponId = String(coupon.id);
        redemption.couponCode = coupon.code;
        redemption.orderCode = order.code;
        redemption.customerId = String(order.customer.id);
        redemption.customerUserId = userId;
        redemption.customerName = `${order.customer.firstName} ${order.customer.lastName}`.trim() || 'Customer';
        redemption.eligibleSubtotal = quote.eligibleSubtotal;
        redemption.amount = quote.amount;
        redemption.currencyCode = String(order.currencyCode);
        redemption.fundingSource = coupon.fundingSource;
        redemption.status = 'RESERVED';
        redemption.reservedAt = new Date();
        redemption.appliedAt = undefined;
        redemption.reversedAt = undefined;
        redemption.reversalReason = undefined;
        redemption.ruleSnapshot = snapshot;
        redemption.allocations = undefined;
        return this.redemptionQuote(await repository.save(redemption));
    }

    async release(ctx: RequestContext, orderId: string, reason = 'Checkout was not completed') {
        const userId = this.requireUser(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceCouponRedemption);
        const redemption = await repository.findOne({ where: { orderId: String(orderId) } });
        if (!redemption) return { success: true, message: 'No coupon reservation was present' };
        if (redemption.customerUserId !== userId) throw new ForbiddenError();
        if (redemption.status !== 'RESERVED') return { success: true, message: 'Coupon reservation was already finalized' };
        redemption.status = 'RELEASED';
        redemption.reversedAt = new Date();
        redemption.reversalReason = this.cleanText(reason, 500);
        await repository.save(redemption, { reload: false });
        return { success: true, message: `${redemption.couponCode} was released` };
    }

    async completeForSellerOrders(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        const repository = this.connection.getRepository(ctx, MarketplaceCouponRedemption);
        const redemption = await repository.findOne({ where: { orderId: String(aggregateOrder.id) } });
        if (!redemption || redemption.status !== 'RESERVED') return;
        if (!sellerOrders.length) throw new Error('Coupon discount could not be allocated without seller orders');

        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendorByChannel = new Map(vendors.flatMap(vendor => vendor.channelId
            ? [[String(vendor.channelId), vendor] as const]
            : []));
        const sellerData = sellerOrders.map(order => {
            const allLines = this.orderLines(order);
            const eligibleLines = allLines.filter(line => couponMatchesLine(redemption.ruleSnapshot, line));
            return {
                order,
                allLines,
                eligibleLines,
                eligibleAmount: eligibleLines.reduce((total, line) => total + line.amount, 0),
            };
        });
        const weights = sellerData.map(item => item.eligibleAmount);
        if (weights.reduce((total, amount) => total + amount, 0) <= 0) {
            throw new Error('Coupon eligibility changed before the order could be placed');
        }
        const sellerDiscounts = allocateCouponByWeight(redemption.amount, weights);
        const allocations: MarketplaceCouponAllocation[] = sellerData.map((item, index) => {
            const vendor = item.order.channels.map(channel => vendorByChannel.get(String(channel.id))).find(Boolean);
            if (!vendor) throw new Error(`Coupon allocation could not identify the vendor for seller order ${item.order.code}`);
            const amount = sellerDiscounts[index]!;
            const lineAllocations = allocateCouponByWeight(amount, item.eligibleLines.map(line => line.amount))
                .map((lineAmount, lineIndex) => ({
                    productId: item.eligibleLines[lineIndex]!.productId,
                    variantId: item.eligibleLines[lineIndex]!.variantId,
                    amount: lineAmount,
                }));
            const vendorGrossAmount = item.allLines.reduce((total, line) => total + line.amount, 0);
            return {
                sellerOrderId: String(item.order.id),
                sellerOrderCode: item.order.code,
                vendorId: String(vendor.id),
                vendorName: vendor.shopName,
                amount,
                vendorGrossAmount,
                customerFundedAmount: Math.max(0, vendorGrossAmount - amount),
                lineAllocations,
            };
        });
        redemption.allocations = allocations;
        redemption.status = 'APPLIED';
        redemption.appliedAt = new Date();
        await repository.save(redemption, { reload: false });

        const ledgerRepository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        for (const allocation of allocations.filter(item => item.amount > 0)) {
            const existing = await ledgerRepository.find({
                where: { beneficiaryType: 'VENDOR', beneficiaryId: allocation.vendorId, orderId: allocation.sellerOrderId },
            });
            if (existing.some(entry => entry.metadata?.couponRedemptionId === String(redemption.id))) continue;
            const marketplaceFunded = redemption.fundingSource === 'MARKETPLACE';
            const availableAt = new Date(
                Date.now() + Math.max(0, this.options.payoutHoldDays) * 24 * 60 * 60 * 1000,
            );
            await ledgerRepository.save(new PayoutLedgerEntry({
                beneficiaryType: 'VENDOR',
                beneficiaryId: allocation.vendorId,
                orderId: allocation.sellerOrderId,
                kind: marketplaceFunded ? 'COUPON_FUNDING' : 'COUPON_DISCOUNT',
                amount: marketplaceFunded ? allocation.amount : -allocation.amount,
                currencyCode: redemption.currencyCode,
                status: marketplaceFunded ? 'AVAILABLE' : 'ON_HOLD',
                availableAt: marketplaceFunded ? new Date() : availableAt,
                reason: marketplaceFunded
                    ? `${redemption.couponCode} coupon funded by the marketplace`
                    : `${redemption.couponCode} coupon funded by the vendor`,
                metadata: {
                    ...(marketplaceFunded ? { accountingEffect: 'INFORMATIONAL' } : {}),
                    source: 'MARKETPLACE_COUPON',
                    couponRedemptionId: String(redemption.id),
                    couponId: redemption.couponId,
                    couponCode: redemption.couponCode,
                    couponScope: redemption.ruleSnapshot.scope,
                    fundingSource: redemption.fundingSource,
                    customerFundedAmount: allocation.customerFundedAmount,
                    vendorGrossAmount: allocation.vendorGrossAmount,
                    aggregateOrderId: String(aggregateOrder.id),
                    aggregateOrderCode: aggregateOrder.code,
                },
            }));
        }
    }

    async reverseForSellerOrder(ctx: RequestContext, sellerOrder: Pick<Order, 'id' | 'code'>, reason: string) {
        const repository = this.connection.getRepository(ctx, MarketplaceCouponRedemption);
        const redemptions = await repository.find();
        const redemption = redemptions.find(item => (item.allocations ?? [])
            .some(allocation => allocation.sellerOrderId === String(sellerOrder.id)));
        if (!redemption || !['APPLIED', 'PARTIALLY_REVERSED'].includes(redemption.status)) return;
        const allocation = redemption.allocations?.find(item => item.sellerOrderId === String(sellerOrder.id));
        if (!allocation || allocation.reversedAt) return;
        allocation.reversedAt = new Date().toISOString();
        const remaining = (redemption.allocations ?? []).some(item => !item.reversedAt);
        redemption.status = remaining ? 'PARTIALLY_REVERSED' : 'REVERSED';
        redemption.reversedAt = remaining ? undefined : new Date();
        redemption.reversalReason = this.cleanText(reason, 500);
        await repository.save(redemption, { reload: false });

        const ledgerRepository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const entries = await ledgerRepository.find({
            where: { beneficiaryType: 'VENDOR', beneficiaryId: allocation.vendorId, orderId: allocation.sellerOrderId },
        });
        for (const entry of entries.filter(item => ['COUPON_FUNDING', 'COUPON_DISCOUNT'].includes(item.kind)
            && item.metadata?.couponRedemptionId === String(redemption.id)
            && item.status !== 'REVERSED')) {
            entry.status = 'REVERSED';
            entry.reason = `${entry.reason}; reversed after order became ${reason}`;
            await ledgerRepository.save(entry, { reload: false });
        }
    }

    async fundingByOrderIds(ctx: RequestContext, orderIds: string[]) {
        const requested = new Set(orderIds);
        const result = new Map<string, {
            code: string;
            amount: number;
            customerFundedAmount: number;
            fundingSource: MarketplaceCouponFundingSource;
        }>();
        if (!requested.size) return result;
        const redemptions = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).find();
        for (const redemption of redemptions.filter(item => item.status !== 'RELEASED')) {
            const allocations = redemption.allocations ?? [];
            if (requested.has(redemption.orderId)) {
                result.set(redemption.orderId, {
                    code: redemption.couponCode,
                    amount: allocations.reduce((total, item) => total + item.amount, 0),
                    customerFundedAmount: allocations.reduce((total, item) => total + item.customerFundedAmount, 0),
                    fundingSource: redemption.fundingSource,
                });
            }
            for (const allocation of allocations) {
                if (!requested.has(allocation.sellerOrderId)) continue;
                result.set(allocation.sellerOrderId, {
                    code: redemption.couponCode,
                    amount: allocation.amount,
                    customerFundedAmount: allocation.customerFundedAmount,
                    fundingSource: redemption.fundingSource,
                });
            }
        }
        return result;
    }

    async reservedAmountForOrder(ctx: RequestContext, orderId: string) {
        const redemption = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).findOne({
            where: { orderId: String(orderId), status: 'RESERVED' },
        });
        return redemption?.amount ?? 0;
    }

    async vendorFundedDiscountForSellerOrder(ctx: RequestContext, orderId: string) {
        const redemptions = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).find({
            where: { fundingSource: 'VENDOR' },
        });
        const redemption = redemptions.find(item => ['APPLIED', 'PARTIALLY_REVERSED'].includes(item.status)
            && (item.allocations ?? []).some(allocation => allocation.sellerOrderId === String(orderId) && !allocation.reversedAt));
        return redemption?.allocations?.find(allocation => allocation.sellerOrderId === String(orderId) && !allocation.reversedAt);
    }

    async dashboard(ctx: RequestContext) {
        const [coupons, redemptions] = await Promise.all([
            this.connection.getRepository(ctx, MarketplaceCoupon).find({ order: { createdAt: 'DESC' } }),
            this.connection.getRepository(ctx, MarketplaceCouponRedemption).find({ order: { createdAt: 'DESC' } }),
        ]);
        const active = redemptions.filter(item => ['APPLIED', 'PARTIALLY_REVERSED'].includes(item.status));
        return {
            activeCoupons: coupons.filter(item => item.status === 'ACTIVE').length,
            totalRedemptions: active.length,
            totalDiscount: active.reduce((total, item) => total + (item.allocations ?? [])
                .filter(allocation => !allocation.reversedAt)
                .reduce((sum, allocation) => sum + allocation.amount, 0), 0),
            marketplaceFunded: active.filter(item => item.fundingSource === 'MARKETPLACE')
                .reduce((total, item) => total + (item.allocations ?? []).filter(a => !a.reversedAt).reduce((sum, a) => sum + a.amount, 0), 0),
            vendorFunded: active.filter(item => item.fundingSource === 'VENDOR')
                .reduce((total, item) => total + (item.allocations ?? []).filter(a => !a.reversedAt).reduce((sum, a) => sum + a.amount, 0), 0),
            recentRedemptions: redemptions.slice(0, 100),
        };
    }

    private async normalizeInput(ctx: RequestContext, input: CreateMarketplaceCouponInput) {
        const code = this.cleanText(input.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, '');
        if (code.length < 3) throw new Error('Coupon code must contain at least 3 letters or numbers');
        const name = this.cleanText(input.name, 120);
        if (name.length < 3) throw new Error('Coupon name must contain at least 3 characters');
        const purpose = String(input.purpose ?? 'PROMOTION').toUpperCase() as MarketplaceCouponPurpose;
        if (!['PROMOTION', 'REWARD'].includes(purpose)) throw new Error('Choose a valid coupon purpose');
        let rewardRecipientType = this.cleanText(input.rewardRecipientType, 40).toUpperCase() as MarketplaceCouponRewardRecipientType | '';
        let rewardRecipientId = this.cleanText(input.rewardRecipientId, 120) || undefined;
        let rewardRecipientCode = this.cleanText(input.rewardRecipientCode, 120) || undefined;
        let rewardRecipientName = this.cleanText(input.rewardRecipientName, 160) || undefined;
        let scope = String(input.scope ?? '').toUpperCase() as MarketplaceCouponScope;
        if (!['GLOBAL', 'VENDOR', 'CATEGORY', 'CAMPAIGN'].includes(scope)) throw new Error('Choose a valid coupon scope');
        let targetId = this.cleanText(input.targetId, 120) || undefined;
        let targetCode = this.cleanText(input.targetCode, 120) || undefined;
        let targetName = this.cleanText(input.targetName, 160) || undefined;
        if (purpose === 'REWARD') {
            if (rewardRecipientType !== 'INFLUENCER' && rewardRecipientType !== 'VENDOR') {
                throw new Error('Choose an influencer or vendor for this reward coupon');
            }
            const recipient = await this.rewardRecipient(ctx, rewardRecipientType, rewardRecipientId, rewardRecipientCode);
            rewardRecipientId = recipient.id;
            rewardRecipientCode = recipient.code;
            rewardRecipientName = recipient.name;
            if (rewardRecipientType === 'INFLUENCER') {
                scope = 'GLOBAL';
                targetId = undefined;
                targetCode = undefined;
                targetName = undefined;
            } else {
                scope = 'VENDOR';
                targetId = recipient.id;
                targetCode = recipient.code;
                targetName = recipient.name;
            }
        } else {
            rewardRecipientType = '';
            rewardRecipientId = undefined;
            rewardRecipientCode = undefined;
            rewardRecipientName = undefined;
        }
        if (scope !== 'GLOBAL' && !targetId && !targetCode) throw new Error('Choose a target for this coupon');
        await this.assertTarget(ctx, scope, targetId, targetCode);
        const discountType = String(input.discountType ?? '').toUpperCase();
        if (!['PERCENTAGE', 'FIXED'].includes(discountType)) throw new Error('Choose percentage or fixed discount');
        const discountValue = Number(input.discountValue);
        if (!Number.isFinite(discountValue) || discountValue <= 0) throw new Error('Discount value must be greater than zero');
        if (discountType === 'PERCENTAGE' && discountValue > 100) throw new Error('Percentage discount cannot exceed 100%');
        if (discountType === 'FIXED' && !Number.isInteger(discountValue)) throw new Error('Fixed discount must use whole PKR units');
        const maximumDiscount = input.maximumDiscount == null || Number(input.maximumDiscount) === 0
            ? undefined
            : this.nonNegativeInteger(input.maximumDiscount, 'Maximum discount');
        const minimumSpend = this.nonNegativeInteger(input.minimumSpend ?? 0, 'Minimum spend');
        const fundingSource = String(input.fundingSource ?? '').toUpperCase() as MarketplaceCouponFundingSource;
        if (!['MARKETPLACE', 'VENDOR'].includes(fundingSource)) throw new Error('Choose who funds this coupon');
        const totalUsageLimit = input.totalUsageLimit == null || Number(input.totalUsageLimit) === 0
            ? undefined
            : this.positiveInteger(input.totalUsageLimit, 'Total usage limit');
        const perCustomerUsageLimit = this.positiveInteger(input.perCustomerUsageLimit ?? 1, 'Per-customer usage limit');
        if (totalUsageLimit && perCustomerUsageLimit > totalUsageLimit) {
            throw new Error('Per-customer usage limit cannot exceed the total usage limit');
        }
        const status = String(input.status ?? 'DRAFT').toUpperCase();
        if (!['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'].includes(status)) throw new Error('Choose a valid coupon status');
        const startsAt = this.dateValue(input.startsAt);
        const endsAt = this.dateValue(input.endsAt);
        if (startsAt && endsAt && endsAt <= startsAt) throw new Error('Coupon end time must be after its start time');
        return {
            code,
            name,
            description: this.cleanText(input.description, 1000) || undefined,
            purpose,
            rewardRecipientType: rewardRecipientType || undefined,
            rewardRecipientId,
            rewardRecipientCode,
            rewardRecipientName,
            scope,
            targetId,
            targetCode,
            targetName,
            discountType: discountType as MarketplaceCoupon['discountType'],
            discountValue,
            maximumDiscount,
            minimumSpend,
            currencyCode: String(input.currencyCode ?? 'PKR').trim().toUpperCase() === 'PKR' ? 'PKR' : 'PKR',
            fundingSource,
            totalUsageLimit,
            perCustomerUsageLimit,
            status: status as MarketplaceCoupon['status'],
            startsAt,
            endsAt,
        };
    }

    private async rewardRecipient(
        ctx: RequestContext,
        type: MarketplaceCouponRewardRecipientType,
        id?: string,
        code?: string,
    ) {
        if (!id && !code) throw new Error('Choose a recipient for this reward coupon');
        if (type === 'INFLUENCER') {
            const repository = this.connection.getRepository(ctx, AffiliateProfile);
            const recipient = (id ? await repository.findOne({ where: { id } }) : undefined)
                ?? (code ? await repository.findOne({ where: { slug: code } }) : undefined)
                ?? (code ? await repository.findOne({ where: { referralCode: code } }) : undefined);
            if (!recipient) throw new Error('Selected influencer was not found');
            if (recipient.status !== 'APPROVED') throw new Error('Reward coupons can only be issued to approved influencers');
            return {
                id: String(recipient.id),
                code: recipient.slug,
                name: recipient.displayName,
            };
        }
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const recipient = (id ? await repository.findOne({ where: { id } }) : undefined)
            ?? (code ? await repository.findOne({ where: { slug: code } }) : undefined);
        if (!recipient) throw new Error('Selected reward vendor was not found');
        if (recipient.status !== 'APPROVED') throw new Error('Reward coupons can only be issued to approved vendors');
        return {
            id: String(recipient.id),
            code: recipient.slug,
            name: recipient.shopName,
        };
    }

    private async assertTarget(ctx: RequestContext, scope: MarketplaceCouponScope, targetId?: string, targetCode?: string) {
        if (scope === 'GLOBAL') return;
        if (scope === 'VENDOR') {
            const target = await this.connection.getRepository(ctx, VendorProfile).findOne({
                where: targetId ? { id: targetId } : { slug: targetCode },
            });
            if (!target) throw new Error('Selected coupon vendor was not found');
        } else if (scope === 'CATEGORY') {
            const target = await this.connection.getRepository(ctx, MarketplaceCategory).findOne({
                where: targetId ? { id: targetId } : { code: targetCode },
            });
            if (!target) throw new Error('Selected coupon category was not found');
        } else {
            const target = await this.connection.getRepository(ctx, PromotionCampaign).findOne({
                where: targetId ? { id: targetId } : { code: targetCode },
            });
            if (!target) throw new Error('Selected coupon campaign was not found');
        }
    }

    private async activeCoupon(ctx: RequestContext, rawCode: string) {
        const code = this.cleanText(rawCode, 40).toUpperCase();
        const coupon = await this.connection.getRepository(ctx, MarketplaceCoupon).findOne({ where: { code } });
        if (!coupon || coupon.status !== 'ACTIVE') throw new Error('Coupon code is invalid or inactive');
        const now = Date.now();
        if (coupon.startsAt && coupon.startsAt.getTime() > now) throw new Error('This coupon is not active yet');
        if (coupon.endsAt && coupon.endsAt.getTime() < now) throw new Error('This coupon has expired');
        return coupon;
    }

    private async assertUsageAvailable(ctx: RequestContext, coupon: MarketplaceCoupon, userId?: string, ignoredId?: ID) {
        const redemptions = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).find({
            where: { couponId: String(coupon.id), status: In(activeRedemptionStatuses) },
        });
        const counted = redemptions.filter(item => ignoredId == null || String(item.id) !== String(ignoredId));
        if (coupon.totalUsageLimit && counted.length >= coupon.totalUsageLimit) throw new Error('This coupon has reached its usage limit');
        if (userId) {
            const customerUses = counted.filter(item => item.customerUserId === userId).length;
            if (customerUses >= coupon.perCustomerUsageLimit) throw new Error('You have already used this coupon the maximum number of times');
        }
    }

    private async snapshot(ctx: RequestContext, coupon: MarketplaceCoupon): Promise<MarketplaceCouponRuleSnapshot> {
        let campaign: PromotionCampaign | undefined;
        let categoryIds: string[] | undefined;
        if (coupon.scope === 'CAMPAIGN') {
            campaign = await this.connection.getRepository(ctx, PromotionCampaign).findOne({
                where: coupon.targetId ? { id: coupon.targetId } : { code: coupon.targetCode },
            }) ?? undefined;
        }
        if (coupon.scope === 'CATEGORY') {
            const categories = await this.connection.getRepository(ctx, MarketplaceCategory).find();
            const target = categories.find(item => String(item.id) === coupon.targetId || item.code === coupon.targetCode);
            if (target) {
                const descendants = new Set<string>([String(target.id)]);
                let changed = true;
                while (changed) {
                    changed = false;
                    for (const category of categories) {
                        if (category.parentId && descendants.has(String(category.parentId)) && !descendants.has(String(category.id))) {
                            descendants.add(String(category.id));
                            changed = true;
                        }
                    }
                }
                categoryIds = [...descendants];
            }
        }
        return {
            couponId: String(coupon.id),
            code: coupon.code,
            name: coupon.name,
            purpose: coupon.purpose,
            rewardRecipientType: coupon.rewardRecipientType,
            rewardRecipientId: coupon.rewardRecipientId,
            rewardRecipientCode: coupon.rewardRecipientCode,
            rewardRecipientName: coupon.rewardRecipientName,
            scope: coupon.scope,
            targetId: coupon.targetId,
            targetCode: coupon.targetCode,
            targetName: coupon.targetName,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            maximumDiscount: coupon.maximumDiscount,
            minimumSpend: coupon.minimumSpend,
            fundingSource: coupon.fundingSource,
            campaignTarget: campaign?.target ?? undefined,
            campaignOwnerType: campaign?.ownerType,
            campaignOwnerId: campaign?.ownerId ?? undefined,
            categoryIds,
        };
    }

    private quoteForLines(coupon: MarketplaceCoupon, snapshot: MarketplaceCouponRuleSnapshot, lines: CouponLine[]) {
        const eligibleSubtotal = lines.filter(line => couponMatchesLine(snapshot, line))
            .reduce((total, line) => total + line.amount, 0);
        if (eligibleSubtotal <= 0) return this.invalidQuote(coupon, 'This coupon does not apply to the products in your basket');
        if (eligibleSubtotal < coupon.minimumSpend) {
            return this.invalidQuote(coupon, `Spend at least PKR ${(coupon.minimumSpend / 100).toLocaleString('en-PK')} on eligible products`);
        }
        const amount = calculateCouponDiscount({
            eligibleSubtotal,
            discountType: coupon.discountType,
            discountValue: coupon.discountValue,
            maximumDiscount: coupon.maximumDiscount,
        });
        return {
            valid: amount > 0,
            message: amount > 0 ? `${coupon.code} applied` : 'This coupon has no discount for the selected products',
            code: coupon.code,
            name: coupon.name,
            scope: coupon.scope,
            fundingSource: coupon.fundingSource,
            eligibleSubtotal,
            amount,
            currencyCode: coupon.currencyCode,
        };
    }

    private invalidQuote(coupon: MarketplaceCoupon, message: string) {
        return {
            valid: false,
            message,
            code: coupon.code,
            name: coupon.name,
            scope: coupon.scope,
            fundingSource: coupon.fundingSource,
            eligibleSubtotal: 0,
            amount: 0,
            currencyCode: coupon.currencyCode,
        };
    }

    private redemptionQuote(redemption: MarketplaceCouponRedemption) {
        return {
            id: String(redemption.id),
            orderId: redemption.orderId,
            orderCode: redemption.orderCode,
            code: redemption.couponCode,
            name: redemption.ruleSnapshot.name,
            scope: redemption.ruleSnapshot.scope,
            fundingSource: redemption.fundingSource,
            eligibleSubtotal: redemption.eligibleSubtotal,
            amount: redemption.amount,
            currencyCode: redemption.currencyCode,
            status: redemption.status,
            valid: true,
            message: `${redemption.couponCode} applied`,
        };
    }

    private async quoteLines(ctx: RequestContext, items: MarketplaceCouponQuoteItemInput[]) {
        const normalized = items.slice(0, 50).map(item => ({
            variantId: String(item.variantId),
            quantity: this.positiveInteger(item.quantity, 'Quantity', 99),
            unitPrice: this.nonNegativeInteger(item.unitPrice, 'Unit price'),
        }));
        if (!normalized.length) throw new Error('Add products before applying a coupon');
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(normalized.map(item => item.variantId)) },
            relations: ['product'],
        });
        const variantById = new Map(variants.map(variant => [String(variant.id), variant]));
        if (variantById.size !== new Set(normalized.map(item => item.variantId)).size) throw new Error('One or more coupon products were not found');
        return normalized.map(item => {
            const variant = variantById.get(item.variantId)!;
            return this.productLine(variant.product, item.variantId, item.quantity * item.unitPrice);
        });
    }

    private orderLines(order: Order): CouponLine[] {
        return order.lines.map(line => this.productLine(
            line.productVariant.product,
            String(line.productVariant.id),
            Math.max(0, Math.round(line.discountedLinePriceWithTax)),
        ));
    }

    private productLine(product: ProductVariant['product'], variantId: string, amount: number): CouponLine {
        const fields = product.customFields as Record<string, unknown> | undefined;
        const metadata = this.jsonObject(fields?.marketplaceMetadata);
        return {
            productId: String(product.id),
            variantId,
            vendorId: String(fields?.vendorProfileId ?? ''),
            categoryId: String(metadata.categoryId ?? ''),
            categoryCode: String(metadata.categoryCode ?? ''),
            categoryName: String(metadata.categoryName ?? ''),
            productSlug: product.slug ?? '',
            amount,
        };
    }

    private async loadOrder(ctx: RequestContext, orderId: string) {
        return this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId },
            relations: ['customer', 'customer.user', 'lines', 'lines.productVariant', 'lines.productVariant.product'],
        });
    }

    private jsonObject(value: unknown) {
        if (typeof value !== 'string' || !value.trim()) return {} as Record<string, unknown>;
        try {
            const parsed = JSON.parse(value) as Record<string, unknown>;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {} as Record<string, unknown>;
        }
    }

    private cleanText(value: unknown, maximum: number) {
        return String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
    }

    private positiveInteger(value: unknown, label: string, maximum = 10_000_000) {
        const number = Number(value);
        if (!Number.isInteger(number) || number <= 0 || number > maximum) throw new Error(`${label} must be a whole number from 1 to ${maximum.toLocaleString('en-PK')}`);
        return number;
    }

    private nonNegativeInteger(value: unknown, label: string, maximum = 100_000_000) {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0 || number > maximum) throw new Error(`${label} must be a whole number from 0 to ${maximum.toLocaleString('en-PK')}`);
        return number;
    }

    private dateValue(value: unknown) {
        if (!value) return undefined;
        const date = new Date(String(value));
        if (Number.isNaN(date.getTime())) throw new Error('Enter a valid coupon date');
        return date;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }
}
