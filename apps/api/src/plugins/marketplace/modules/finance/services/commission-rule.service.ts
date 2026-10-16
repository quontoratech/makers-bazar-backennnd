import { Inject, Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { assertFound, ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

import { MARKETPLACE_PLUGIN_OPTIONS } from '../../../constants';
import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplacePluginOptions } from '../../../types';
import { couponCommissionBase } from '../../promotion/coupon-policy';
import { PromotionCampaign } from '../../promotion/entities/promotion-campaign.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { MarketplaceCouponService } from '../../promotion/services/marketplace-coupon.service';
import {
    CreateMarketplaceCommissionRuleInput,
    MarketplaceCommissionRuleFilterInput,
    UpdateMarketplaceCommissionRuleInput,
} from '../dto/commission-rule.inputs';
import { MarketplaceCommissionRule } from '../entities/marketplace-commission-rule.entity';
import { MarketplacePayoutSettings } from '../entities/marketplace-payout-settings.entity';
import { PayoutLedgerEntry } from '../entities/payout-ledger-entry.entity';
import { marketplaceEarningsAvailableAt, marketplaceOrderCanReleaseEarnings } from '../order-earnings-policy';
import { withPayoutTransaction } from '../payout-transaction';

const ledgerSource = 'MARKETPLACE_COMMISSION_RULES';
const scopePrecedence: Record<MarketplaceCommissionRule['scope'], number> = {
    CAMPAIGN: 4,
    CATEGORY: 3,
    VENDOR: 2,
    GLOBAL: 1,
};

interface ResolvedRuleSnapshot {
    id?: string;
    name: string;
    scope: MarketplaceCommissionRule['scope'] | 'DEFAULT';
    targetId?: string;
    targetCode?: string;
    targetName?: string;
    commissionPercent: number;
    feePercent: number;
    fixedFee: number;
}

interface OrderLineCommissionContext {
    lineId: string;
    productId: string;
    variantId: string;
    productName: string;
    productSlug: string;
    categoryCode?: string;
    categoryName?: string;
    lineTotal: number;
    taxAmount: number;
}

export interface MarketplaceCommissionCalculation {
    orderId: string;
    orderCode: string;
    vendorId?: string;
    vendorName?: string;
    currencyCode: string;
    saleAmount: number;
    commissionAmount: number;
    feeAmount: number;
    taxAmount: number;
    totalFeeAmount: number;
    lineBreakdown: Array<OrderLineCommissionContext & {
        rule: ResolvedRuleSnapshot;
        commissionBase: number;
        couponDiscount: number;
        commissionAmount: number;
        feeAmount: number;
        fixedFeeAmount: number;
    }>;
}

@Injectable()
export class MarketplaceCommissionRuleService {
    constructor(
        private connection: TransactionalConnection,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
        private marketplaceCouponService: MarketplaceCouponService,
    ) {}

    async ensureDefaultGlobalRule(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplaceCommissionRule);
        const existingGlobal = await repository.findOne({ where: { scope: 'GLOBAL' } });
        if (existingGlobal) return existingGlobal;
        return repository.save(new MarketplaceCommissionRule({
            name: 'Global marketplace commission',
            scope: 'GLOBAL',
            targetName: 'All vendors and categories',
            commissionPercent: this.validPercent(this.options.defaultCommissionPercent, 10),
            feePercent: 0,
            fixedFee: 0,
            currencyCode: 'PKR',
            status: 'ACTIVE',
            priority: 0,
            description: 'Default platform commission applied when no narrower rule is active.',
        }));
    }

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        filter?: MarketplaceCommissionRuleFilterInput,
    ): Promise<MarketplaceList<MarketplaceCommissionRule>> {
        const { skip, take } = normalizeListOptions(options);
        const query = this.connection.getRepository(ctx, MarketplaceCommissionRule)
            .createQueryBuilder('rule')
            .orderBy('rule.priority', 'DESC')
            .addOrderBy('rule.createdAt', 'DESC')
            .skip(skip)
            .take(take);

        if (filter?.scope) query.andWhere('rule.scope = :scope', { scope: filter.scope });
        if (filter?.status) query.andWhere('rule.status = :status', { status: filter.status });
        if (filter?.targetId) query.andWhere('rule.targetId = :targetId', { targetId: filter.targetId });
        if (filter?.targetCode) query.andWhere('rule.targetCode = :targetCode', { targetCode: filter.targetCode });
        if (filter?.term?.trim()) {
            query.andWhere(
                '(LOWER(rule.name) LIKE :term OR LOWER(rule.targetName) LIKE :term OR LOWER(rule.targetCode) LIKE :term OR LOWER(rule.description) LIKE :term)',
                { term: `%${filter.term.trim().toLowerCase()}%` },
            );
        }

        const [items, totalItems] = await query.getManyAndCount();
        return { items, totalItems };
    }

    findOne(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, MarketplaceCommissionRule).findOne({ where: { id } });
    }

    async create(ctx: RequestContext, input: CreateMarketplaceCommissionRuleInput) {
        const normalized = this.normalizeRuleInput(input);
        const rule = await this.connection.getRepository(ctx, MarketplaceCommissionRule).save(
            new MarketplaceCommissionRule(normalized),
        );
        return assertFound(this.findOne(ctx, rule.id));
    }

    async update(ctx: RequestContext, input: UpdateMarketplaceCommissionRuleInput) {
        const rule = await assertFound(this.findOne(ctx, input.id));
        Object.assign(rule, this.normalizeRuleInput(input));
        await this.connection.getRepository(ctx, MarketplaceCommissionRule).save(rule, { reload: false });
        return assertFound(this.findOne(ctx, rule.id));
    }

    async delete(ctx: RequestContext, id: ID) {
        const rule = await assertFound(this.findOne(ctx, id));
        await this.connection.getRepository(ctx, MarketplaceCommissionRule).remove(rule);
        return { success: true, message: 'Commission rule deleted' };
    }

    async calculateForSellerOrder(
        ctx: RequestContext,
        sellerOrder: Pick<Order, 'id'>,
    ): Promise<MarketplaceCommissionCalculation> {
        const order = await this.loadCommissionOrder(ctx, sellerOrder.id);
        const vendor = await this.vendorForOrder(ctx, order);
        const rules = (await this.activeRules(ctx, order.orderPlacedAt ?? new Date()))
            .filter(rule => rule.currencyCode === String(order.currencyCode));
        const campaigns = await this.activeCampaigns(ctx, order.orderPlacedAt ?? new Date());
        const campaignCodes = this.orderCampaignCodes(order);
        const chargedFixedFeeRules = new Set<string>();
        const currencyCode = String(order.currencyCode);
        const vendorCoupon = await this.marketplaceCouponService.vendorFundedDiscountForSellerOrder(ctx, String(order.id));
        const couponByVariant = new Map<string, number>();
        for (const allocation of vendorCoupon?.lineAllocations ?? []) {
            couponByVariant.set(allocation.variantId, (couponByVariant.get(allocation.variantId) ?? 0) + allocation.amount);
        }
        const lineBreakdown = order.lines.map(line => {
            const context = this.lineContext(line);
            const rule = this.resolveLineRule(context, vendor, rules, campaigns, campaignCodes);
            const fixedFeeAmount = rule.fixedFee && !chargedFixedFeeRules.has(this.ruleKey(rule))
                ? rule.fixedFee
                : 0;
            chargedFixedFeeRules.add(this.ruleKey(rule));
            const couponDiscount = Math.min(context.lineTotal, couponByVariant.get(context.variantId) ?? 0);
            const commissionBase = couponCommissionBase(context.lineTotal, couponDiscount, 'VENDOR');
            const commissionAmount = Math.round(commissionBase * (rule.commissionPercent / 100));
            const percentFeeAmount = Math.round(commissionBase * (rule.feePercent / 100));
            return {
                ...context,
                rule,
                commissionBase,
                couponDiscount,
                commissionAmount,
                feeAmount: percentFeeAmount + fixedFeeAmount,
                fixedFeeAmount,
            };
        });
        const saleAmount = lineBreakdown.reduce((total, line) => total + line.lineTotal, 0);
        const commissionAmount = lineBreakdown.reduce((total, line) => total + line.commissionAmount, 0);
        const feeAmount = lineBreakdown.reduce((total, line) => total + line.feeAmount, 0);
        const taxAmount = lineBreakdown.reduce((total, line) => total + line.taxAmount, 0);
        return {
            orderId: String(order.id),
            orderCode: order.code,
            vendorId: vendor ? String(vendor.id) : undefined,
            vendorName: vendor?.shopName,
            currencyCode,
            saleAmount,
            commissionAmount,
            feeAmount,
            taxAmount,
            totalFeeAmount: commissionAmount + feeAmount,
            lineBreakdown,
        };
    }

    async currentBaseCommissionPercent(ctx: RequestContext, vendor: Pick<VendorProfile, 'id' | 'slug' | 'shopName'>) {
        const rules = (await this.activeRules(ctx, new Date()))
            .filter(rule => rule.scope === 'GLOBAL' || (rule.scope === 'VENDOR' && this.ruleMatchesVendor(rule, vendor)))
            .sort((left, right) => (
                scopePrecedence[right.scope] - scopePrecedence[left.scope]
                || right.priority - left.priority
                || right.createdAt.getTime() - left.createdAt.getTime()
            ));
        return rules[0]?.commissionPercent ?? this.validPercent(this.options.defaultCommissionPercent, 10);
    }

    async createLedgerEntriesForSellerOrder(ctx: RequestContext, sellerOrder: Order) {
        return withPayoutTransaction(this.connection, ctx, transactionCtx =>
            this.createLedgerEntries(transactionCtx, sellerOrder));
    }

    private async createLedgerEntries(ctx: RequestContext, sellerOrder: Order) {
        const paidOrder = await this.loadCommissionOrder(ctx, sellerOrder.id);
        if (!marketplaceOrderCanReleaseEarnings(paidOrder)) return [];
        const calculation = await this.calculateForSellerOrder(ctx, sellerOrder);
        if (!calculation.vendorId) return [];
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const existing = await repository.find({
            where: {
                beneficiaryType: 'VENDOR',
                beneficiaryId: calculation.vendorId,
                orderId: calculation.orderId,
            },
        });
        const generated = existing.filter(entry => entry.metadata?.source === ledgerSource);
        if (generated.length) {
            if (calculation.taxAmount > 0 && !generated.some(entry => entry.kind === 'TAX')) {
                const saleEntry = generated.find(entry => entry.kind === 'SALE');
                const taxEntry = await repository.save(new PayoutLedgerEntry({
                    beneficiaryType: 'VENDOR',
                    beneficiaryId: calculation.vendorId,
                    orderId: calculation.orderId,
                    kind: 'TAX',
                    amount: -calculation.taxAmount,
                    currencyCode: calculation.currencyCode,
                    status: saleEntry?.status === 'REVERSED' ? 'REVERSED' : saleEntry?.status ?? 'ON_HOLD',
                    availableAt: saleEntry?.availableAt,
                    reason: `Tax withheld for seller order ${calculation.orderCode}`,
                    metadata: this.ledgerMetadata(calculation),
                }));
                return [...generated, taxEntry];
            }
            return generated;
        }

        const settings = await this.connection.getRepository(ctx, MarketplacePayoutSettings).findOne({ where: {} });
        const availableAt = marketplaceEarningsAvailableAt(
            paidOrder,
            settings?.holdingPeriodDays ?? this.options.payoutHoldDays ?? 7,
        );
        const metadata = this.ledgerMetadata(calculation);
        const entries = [
            new PayoutLedgerEntry({
                beneficiaryType: 'VENDOR',
                beneficiaryId: calculation.vendorId,
                orderId: calculation.orderId,
                kind: 'SALE',
                amount: calculation.saleAmount,
                currencyCode: calculation.currencyCode,
                status: 'ON_HOLD',
                availableAt,
                reason: `Sale recorded for seller order ${calculation.orderCode}`,
                metadata,
            }),
        ];
        if (calculation.commissionAmount > 0) {
            entries.push(new PayoutLedgerEntry({
                beneficiaryType: 'VENDOR',
                beneficiaryId: calculation.vendorId,
                orderId: calculation.orderId,
                kind: 'COMMISSION',
                amount: -calculation.commissionAmount,
                currencyCode: calculation.currencyCode,
                status: 'ON_HOLD',
                availableAt,
                reason: `Marketplace commission for seller order ${calculation.orderCode}`,
                metadata,
            }));
        }
        if (calculation.feeAmount > 0) {
            entries.push(new PayoutLedgerEntry({
                beneficiaryType: 'VENDOR',
                beneficiaryId: calculation.vendorId,
                orderId: calculation.orderId,
                kind: 'PAYMENT_FEE',
                amount: -calculation.feeAmount,
                currencyCode: calculation.currencyCode,
                status: 'ON_HOLD',
                availableAt,
                reason: `Marketplace fees for seller order ${calculation.orderCode}`,
                metadata,
            }));
        }
        if (calculation.taxAmount > 0) {
            entries.push(new PayoutLedgerEntry({
                beneficiaryType: 'VENDOR',
                beneficiaryId: calculation.vendorId,
                orderId: calculation.orderId,
                kind: 'TAX',
                amount: -calculation.taxAmount,
                currencyCode: calculation.currencyCode,
                status: 'ON_HOLD',
                availableAt,
                reason: `Tax withheld for seller order ${calculation.orderCode}`,
                metadata,
            }));
        }
        return repository.save(entries);
    }

    async reverseLedgerEntriesForSellerOrder(
        ctx: RequestContext,
        sellerOrder: Pick<Order, 'id' | 'code'>,
        terminalStatus: 'REJECTED' | 'CANCELLED' | 'REFUNDED',
    ) {
        return withPayoutTransaction(this.connection, ctx, transactionCtx =>
            this.reverseLedgerEntries(transactionCtx, sellerOrder, terminalStatus));
    }

    private async reverseLedgerEntries(
        ctx: RequestContext,
        sellerOrder: Pick<Order, 'id' | 'code'>,
        terminalStatus: 'REJECTED' | 'CANCELLED' | 'REFUNDED',
    ) {
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const orderId = String(sellerOrder.id);
        const generated = (await repository.find({ where: { orderId } }))
            .filter(entry => entry.metadata?.source === ledgerSource);
        const reversible = generated.filter(entry => entry.status !== 'REVERSED');
        const reversedAt = new Date().toISOString();

        if (reversible.length) {
            await repository.save(reversible.map(entry => {
                const previousStatus = entry.status;
                entry.status = 'REVERSED';
                entry.reason = `${entry.reason ?? `Ledger entry for seller order ${sellerOrder.code}`}; reversed after order became ${terminalStatus}`;
                entry.metadata = {
                    ...(entry.metadata ?? {}),
                    previousStatus,
                    reversedAt,
                    reversedForStatus: terminalStatus,
                };
                return entry;
            }), { reload: false });
        }

        const beneficiaryIds = [...new Set(generated.map(entry => entry.beneficiaryId))];
        const duplicateRefunds = terminalStatus === 'REFUNDED' && beneficiaryIds.length
            ? await this.duplicateUnpaidManualRefunds(
                ctx,
                beneficiaryIds,
                [orderId, sellerOrder.code],
            )
            : [];
        if (duplicateRefunds.length) {
            await repository.save(duplicateRefunds.map(entry => {
                entry.status = 'REVERSED';
                entry.reason = `${entry.reason ?? `Manual refund for seller order ${sellerOrder.code}`}; reversed because the order ledger was already reversed`;
                entry.metadata = {
                    ...(entry.metadata ?? {}),
                    previousStatus: 'AVAILABLE',
                    reversedAt,
                    reversedForStatus: terminalStatus,
                    duplicateOfOrderReversal: true,
                };
                return entry;
            }), { reload: false });
        }

        const refundEntries = terminalStatus === 'REFUNDED'
            ? await this.recordOrderRefundActivity(ctx, sellerOrder, generated)
            : 0;

        return {
            generatedEntries: reversible.length,
            duplicateRefundEntries: duplicateRefunds.length,
            refundEntries,
        };
    }

    private normalizeRuleInput(input: CreateMarketplaceCommissionRuleInput) {
        const name = this.cleanText(input.name, 120);
        if (!name || name.length < 3) throw new Error('Commission rule name must contain at least 3 characters');
        const scope = String(input.scope ?? '').trim().toUpperCase();
        if (!['GLOBAL', 'VENDOR', 'CATEGORY', 'CAMPAIGN'].includes(scope)) {
            throw new Error('Choose a valid commission rule scope');
        }

        const targetId = this.cleanText(input.targetId, 120);
        const targetCode = this.cleanText(input.targetCode, 120);
        const targetName = this.cleanText(input.targetName, 160);
        if (scope !== 'GLOBAL' && !targetId && !targetCode) {
            throw new Error('Vendor, category, and campaign rules need a target');
        }

        const startsAt = this.dateValue(input.startsAt);
        const endsAt = this.dateValue(input.endsAt);
        if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
            throw new Error('Commission rule end time must be after its start time');
        }

        const commissionPercent = this.validPercent(input.commissionPercent, 0);
        const feePercent = this.validPercent(input.feePercent, 0);
        const fixedFee = this.nonNegativeInteger(input.fixedFee, 0);
        if (commissionPercent === 0 && feePercent === 0 && fixedFee === 0) {
            throw new Error('Add a commission percentage, fee percentage, or fixed fee');
        }
        const status = String(input.status ?? 'ACTIVE').trim().toUpperCase();
        if (!['ACTIVE', 'PAUSED', 'DRAFT'].includes(status)) {
            throw new Error('Choose a valid commission rule status');
        }

        return {
            name,
            scope: scope as MarketplaceCommissionRule['scope'],
            targetId,
            targetCode,
            targetName,
            commissionPercent,
            feePercent,
            fixedFee,
            currencyCode: this.currencyCode(input.currencyCode),
            priority: this.nonNegativeInteger(input.priority, 0),
            status: status as MarketplaceCommissionRule['status'],
            startsAt,
            endsAt,
            description: this.cleanText(input.description, 1000),
            metadata: input.metadata,
        };
    }

    private async loadCommissionOrder(ctx: RequestContext, orderId: ID) {
        return this.connection.getEntityOrThrow(ctx, Order, orderId, {
            relations: [
                'channels',
                'aggregateOrder',
                'aggregateOrder.payments',
                'aggregateOrder.payments.refunds',
                'payments',
                'payments.refunds',
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
                'lines.productVariant.product.translations',
            ],
        });
    }

    private async duplicateUnpaidManualRefunds(
        ctx: RequestContext,
        beneficiaryIds: string[],
        orderReferences: string[],
    ) {
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const entries = await repository.createQueryBuilder('entry')
            .where('entry.beneficiaryType = :beneficiaryType', { beneficiaryType: 'VENDOR' })
            .andWhere('entry.beneficiaryId IN (:...beneficiaryIds)', { beneficiaryIds })
            .andWhere('entry.orderId IN (:...orderReferences)', { orderReferences })
            .andWhere('entry.kind = :kind', { kind: 'REFUND' })
            .andWhere('entry.status = :status', { status: 'AVAILABLE' })
            .getMany();
        return entries.filter(entry => entry.metadata?.source === 'MANUAL_FINANCE_ADJUSTMENT');
    }

    private async recordOrderRefundActivity(
        ctx: RequestContext,
        sellerOrder: Pick<Order, 'id' | 'code'>,
        generated: PayoutLedgerEntry[],
    ) {
        if (!generated.length) return 0;
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const existing = (await repository.find({
            where: { orderId: String(sellerOrder.id), kind: 'REFUND' },
        })).some(entry => entry.metadata?.source === 'MARKETPLACE_ORDER_REFUND');
        if (existing) return 0;

        const saleEntry = generated.find(entry => entry.kind === 'SALE');
        const saleAmount = Math.abs(Number(saleEntry?.metadata?.saleAmount ?? saleEntry?.amount ?? 0));
        if (!saleEntry || !saleAmount) return 0;
        await repository.save(new PayoutLedgerEntry({
            beneficiaryType: saleEntry.beneficiaryType,
            beneficiaryId: saleEntry.beneficiaryId,
            orderId: String(sellerOrder.id),
            kind: 'REFUND',
            amount: -saleAmount,
            currencyCode: saleEntry.currencyCode,
            status: 'PAID',
            availableAt: new Date(),
            reason: `Customer refund recorded for seller order ${sellerOrder.code}`,
            metadata: {
                source: 'MARKETPLACE_ORDER_REFUND',
                sellerOrderCode: sellerOrder.code,
                accountingEffect: 'INFORMATIONAL',
            },
        }));
        return 1;
    }

    private async vendorForOrder(ctx: RequestContext, order: Order) {
        const channelIds = order.channels.map(channel => String(channel.id));
        if (!channelIds.length) return undefined;
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find({
            where: { channelId: In(channelIds) },
        });
        return vendors[0];
    }

    private async activeRules(ctx: RequestContext, at: Date) {
        const rules = await this.connection.getRepository(ctx, MarketplaceCommissionRule).find({
            where: { status: 'ACTIVE' },
            order: { priority: 'DESC', createdAt: 'DESC' },
        });
        return rules.filter(rule => this.isActiveAt(rule, at));
    }

    private async activeCampaigns(ctx: RequestContext, at: Date) {
        const campaigns = await this.connection.getRepository(ctx, PromotionCampaign).find({
            where: { status: 'ACTIVE' },
            order: { createdAt: 'DESC' },
        });
        return campaigns.filter(campaign => campaign.startsAt.getTime() <= at.getTime()
            && campaign.endsAt.getTime() >= at.getTime());
    }

    private resolveLineRule(
        line: OrderLineCommissionContext,
        vendor: VendorProfile | undefined,
        rules: MarketplaceCommissionRule[],
        campaigns: PromotionCampaign[],
        campaignCodes: Set<string>,
    ): ResolvedRuleSnapshot {
        const matchingRules = rules.filter(rule => {
            if (rule.scope === 'GLOBAL') return true;
            if (rule.scope === 'VENDOR') return this.ruleMatchesVendor(rule, vendor);
            if (rule.scope === 'CATEGORY') return this.ruleMatchesCategory(rule, line);
            return this.ruleMatchesCampaign(rule, line, vendor, campaigns, campaignCodes);
        }).sort((left, right) => (
            scopePrecedence[right.scope] - scopePrecedence[left.scope]
            || right.priority - left.priority
            || right.createdAt.getTime() - left.createdAt.getTime()
        ));
        const rule = matchingRules[0];
        if (rule) return this.snapshot(rule);
        return {
            name: 'Plugin default commission',
            scope: 'DEFAULT',
            commissionPercent: this.validPercent(this.options.defaultCommissionPercent, 10),
            feePercent: 0,
            fixedFee: 0,
        };
    }

    private ruleMatchesVendor(rule: MarketplaceCommissionRule, vendor?: Pick<VendorProfile, 'id' | 'slug' | 'shopName'>) {
        if (!vendor) return false;
        const targets = this.ruleTargets(rule);
        return targets.has(this.normalizeTarget(String(vendor.id)))
            || targets.has(this.normalizeTarget(vendor.slug))
            || targets.has(this.normalizeTarget(vendor.shopName));
    }

    private ruleMatchesCategory(rule: MarketplaceCommissionRule, line: OrderLineCommissionContext) {
        const targets = this.ruleTargets(rule);
        return targets.has(this.normalizeTarget(line.categoryCode))
            || targets.has(this.normalizeTarget(line.categoryName));
    }

    private ruleMatchesCampaign(
        rule: MarketplaceCommissionRule,
        line: OrderLineCommissionContext,
        vendor: VendorProfile | undefined,
        campaigns: PromotionCampaign[],
        campaignCodes: Set<string>,
    ) {
        const targets = this.ruleTargets(rule);
        const matchesOrderCode = [...targets].some(target => campaignCodes.has(target));
        const campaign = campaigns.find(item => targets.has(this.normalizeTarget(String(item.id)))
            || targets.has(this.normalizeTarget(item.code))
            || targets.has(this.normalizeTarget(item.title)));
        if (!campaign) return matchesOrderCode;
        return matchesOrderCode || this.campaignTargetsLine(campaign, line, vendor);
    }

    private campaignTargetsLine(campaign: PromotionCampaign, line: OrderLineCommissionContext, vendor?: VendorProfile) {
        const target = campaign.target ?? {};
        const ownerMatches = campaign.ownerType !== 'VENDOR'
            || !campaign.ownerId
            || String(campaign.ownerId) === String(vendor?.id);
        if (!ownerMatches) return false;
        const targetChecks = [
            this.targetValues(target, ['vendorId', 'vendorIds', 'vendors'])
                .some(value => this.normalizeTarget(value) === this.normalizeTarget(String(vendor?.id ?? ''))),
            this.targetValues(target, ['categoryCode', 'categoryCodes', 'categories'])
                .some(value => {
                    const expected = String(value).trim().toLowerCase();
                    const categoryCode = String(line.categoryCode ?? '').trim().toLowerCase();
                    return categoryCode === expected
                        || categoryCode.startsWith(`${expected}/`)
                        || this.normalizeTarget(value) === this.normalizeTarget(line.categoryName);
                }),
            this.targetValues(target, ['productId', 'productIds', 'products'])
                .some(value => this.normalizeTarget(value) === this.normalizeTarget(line.productId)),
            this.targetValues(target, ['productSlug', 'productSlugs', 'slugs'])
                .some(value => this.normalizeTarget(value) === this.normalizeTarget(line.productSlug)),
        ];
        const hasTargeting = ['vendorId', 'vendorIds', 'vendors', 'categoryCode', 'categoryCodes', 'categories', 'productId', 'productIds', 'products', 'productSlug', 'productSlugs', 'slugs']
            .some(key => target[key] != null);
        return hasTargeting ? targetChecks.some(Boolean) : true;
    }

    private lineContext(line: Order['lines'][number]): OrderLineCommissionContext {
        const product = line.productVariant.product;
        const metadata = this.productMetadata(product?.customFields as Record<string, unknown> | undefined);
        return {
            lineId: String(line.id),
            productId: product ? String(product.id) : '',
            variantId: String(line.productVariant.id),
            productName: product?.name ?? line.productVariant.name ?? 'Marketplace item',
            productSlug: product?.slug ?? '',
            categoryCode: this.cleanText(metadata.categoryCode, 120),
            categoryName: this.cleanText(metadata.categoryName, 160),
            lineTotal: this.lineTotal(line),
            taxAmount: this.lineTax(line),
        };
    }

    private productMetadata(customFields?: Record<string, unknown>) {
        const raw = customFields?.marketplaceMetadata;
        if (typeof raw !== 'string' || !raw.trim()) return {} as Record<string, unknown>;
        try {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch {
            return {};
        }
    }

    private orderCampaignCodes(order: Order) {
        const codes = new Set<string>();
        for (const source of [order, order.aggregateOrder]) {
            const customFields = source?.customFields as Record<string, unknown> | undefined;
            for (const key of ['affiliateCode', 'campaignCode', 'marketplaceCampaignCode']) {
                const value = this.normalizeTarget(customFields?.[key]);
                if (value) codes.add(value);
            }
        }
        return codes;
    }

    private lineTotal(line: Order['lines'][number]) {
        const candidate = Number(
            (line as unknown as { discountedLinePriceWithTax?: number }).discountedLinePriceWithTax
            ?? (line as unknown as { linePriceWithTax?: number }).linePriceWithTax
            ?? line.listPrice * line.quantity,
        );
        return Number.isFinite(candidate) && candidate > 0 ? Math.round(candidate) : 0;
    }

    private lineTax(line: Order['lines'][number]) {
        const withTax = this.lineTotal(line);
        const withoutTax = Number(
            (line as unknown as { discountedLinePrice?: number }).discountedLinePrice
            ?? (line as unknown as { linePrice?: number }).linePrice
            ?? withTax,
        );
        return Number.isFinite(withoutTax) ? Math.max(0, withTax - Math.round(withoutTax)) : 0;
    }

    private snapshot(rule: MarketplaceCommissionRule): ResolvedRuleSnapshot {
        return {
            id: String(rule.id),
            name: rule.name,
            scope: rule.scope,
            targetId: rule.targetId,
            targetCode: rule.targetCode,
            targetName: rule.targetName,
            commissionPercent: rule.commissionPercent,
            feePercent: rule.feePercent,
            fixedFee: rule.fixedFee,
        };
    }

    private ledgerMetadata(calculation: MarketplaceCommissionCalculation): Record<string, string | number | boolean> {
        return {
            source: ledgerSource,
            saleAmount: calculation.saleAmount,
            commissionAmount: calculation.commissionAmount,
            feeAmount: calculation.feeAmount,
            taxAmount: calculation.taxAmount,
            totalFeeAmount: calculation.totalFeeAmount,
            ruleSummary: JSON.stringify(calculation.lineBreakdown.map(line => ({
                lineId: line.lineId,
                productId: line.productId,
                categoryCode: line.categoryCode,
                ruleId: line.rule.id,
                ruleName: line.rule.name,
                scope: line.rule.scope,
                commissionAmount: line.commissionAmount,
                commissionBase: line.commissionBase,
                couponDiscount: line.couponDiscount,
                feeAmount: line.feeAmount,
            }))),
        };
    }

    private ruleTargets(rule: MarketplaceCommissionRule) {
        return new Set([
            this.normalizeTarget(rule.targetId),
            this.normalizeTarget(rule.targetCode),
            this.normalizeTarget(rule.targetName),
        ].filter(Boolean));
    }

    private ruleKey(rule: ResolvedRuleSnapshot) {
        return rule.id ?? `${rule.scope}:${rule.name}`;
    }

    private isActiveAt(rule: MarketplaceCommissionRule, at: Date) {
        if (rule.startsAt && rule.startsAt.getTime() > at.getTime()) return false;
        if (rule.endsAt && rule.endsAt.getTime() < at.getTime()) return false;
        return true;
    }

    private targetValues(target: Record<string, string | string[]>, keys: string[]) {
        return keys.flatMap(key => {
            const value = target[key];
            return Array.isArray(value) ? value : value ? [value] : [];
        });
    }

    private validPercent(value: unknown, fallback: number) {
        const numeric = value == null ? fallback : Number(value);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
            throw new Error('Percentages must be between 0 and 100');
        }
        return Math.round(numeric * 100) / 100;
    }

    private nonNegativeInteger(value: unknown, fallback: number) {
        const numeric = value == null || value === '' ? fallback : Number(value);
        if (!Number.isInteger(numeric) || numeric < 0) throw new Error('Fixed fees and priorities must be zero or more');
        return numeric;
    }

    private currencyCode(value: unknown) {
        const code = String(value ?? 'PKR').trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code)) throw new Error('Currency code must be a 3-letter ISO code');
        return code;
    }

    private dateValue(value: unknown) {
        if (value == null || value === '') return undefined;
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) throw new Error('Choose valid commission rule dates');
        return date;
    }

    private cleanText(value: unknown, maxLength: number) {
        if (typeof value !== 'string' && typeof value !== 'number') return undefined;
        return String(value).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, maxLength) || undefined;
    }

    private normalizeTarget(value: unknown) {
        const text = this.cleanText(value, 160);
        return text ? normalizeString(text, '-').toLowerCase() : '';
    }
}
