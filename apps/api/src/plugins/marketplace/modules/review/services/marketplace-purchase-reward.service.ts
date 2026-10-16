import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ForbiddenError, ID, Order, Product, RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';

import {
    CreateMarketplacePurchaseRewardRuleInput,
    UpdateMarketplacePurchaseRewardRuleInput,
} from '../dto/marketplace-purchase-reward.inputs';
import { MarketplaceCategory } from '../../catalog/entities/marketplace-category.entity';
import { MarketplaceListingCategory } from '../../catalog/entities/marketplace-listing-category.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { MarketplacePurchaseRewardGrant } from '../entities/marketplace-purchase-reward-grant.entity';
import {
    MarketplacePurchaseRewardRule,
    MarketplacePurchaseRewardRuleScope,
    MarketplacePurchaseRewardRuleStatus,
} from '../entities/marketplace-purchase-reward-rule.entity';
import { MarketplaceRewardWalletTransaction } from '../entities/marketplace-reward-wallet-transaction.entity';
import { purchaseRewardScopePrecedence, resolvePurchaseRewardRule } from './purchase-reward-policy';

interface PurchaseRewardContext {
    productId: string;
    productName: string;
    vendorId?: string;
    vendorName?: string;
    vendorSlug?: string;
    categoryId?: string;
    categoryCode?: string;
    categoryName?: string;
    categoryBreadcrumb: string[];
}

@Injectable()
export class MarketplacePurchaseRewardService {
    constructor(private connection: TransactionalConnection) {}

    async ensureDefaultGlobalRule(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplacePurchaseRewardRule);
        const existing = await repository.findOne({ where: { scope: 'GLOBAL' }, order: { createdAt: 'ASC' } });
        if (existing) return existing;
        return repository.save(new MarketplacePurchaseRewardRule({
            name: 'Global purchase reward',
            scope: 'GLOBAL',
            targetName: 'All marketplace products',
            pointsPerUnit: 5,
            priority: 0,
            status: 'ACTIVE',
            description: 'Default coins awarded per purchased unit when no category or vendor rule applies.',
        }));
    }

    async findAll(ctx: RequestContext) {
        await this.ensureDefaultGlobalRule(ctx);
        return this.connection.getRepository(ctx, MarketplacePurchaseRewardRule).find({
            order: { priority: 'DESC', createdAt: 'DESC' },
        });
    }

    async create(ctx: RequestContext, input: CreateMarketplacePurchaseRewardRuleInput) {
        const repository = this.connection.getRepository(ctx, MarketplacePurchaseRewardRule);
        return repository.save(new MarketplacePurchaseRewardRule({
            ...this.normalizeInput(input),
            updatedByUserId: this.requireUser(ctx),
        }));
    }

    async update(ctx: RequestContext, input: UpdateMarketplacePurchaseRewardRuleInput) {
        const repository = this.connection.getRepository(ctx, MarketplacePurchaseRewardRule);
        const rule = await repository.findOne({ where: { id: input.id } });
        if (!rule) throw new Error('Purchase reward rule was not found');
        Object.assign(rule, this.normalizeInput(input), { updatedByUserId: this.requireUser(ctx) });
        return repository.save(rule);
    }

    async delete(ctx: RequestContext, id: ID) {
        const repository = this.connection.getRepository(ctx, MarketplacePurchaseRewardRule);
        const rule = await repository.findOne({ where: { id } });
        if (!rule) throw new Error('Purchase reward rule was not found');
        await repository.remove(rule);
        return { success: true, message: 'Purchase reward rule deleted' };
    }

    async quoteForProduct(ctx: RequestContext, productId: ID) {
        const product = await this.connection.getEntityOrThrow(ctx, Product, productId);
        const context = this.productContext(product);
        const vendor = context.vendorId
            ? await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: context.vendorId } })
            : null;
        if (vendor) {
            context.vendorName = vendor.shopName;
            context.vendorSlug = vendor.slug;
        }
        const categories = await this.connection.getRepository(ctx, MarketplaceCategory).find();
        const categoryTargets = await this.categoryTargetsByProduct(ctx, [context], categories);
        const rule = this.resolveRule(
            context,
            await this.activeRules(ctx, new Date()),
            categoryTargets.get(context.productId) ?? new Set(),
        );
        return {
            enabled: Boolean(rule && rule.pointsPerUnit > 0),
            pointsPerUnit: rule?.pointsPerUnit ?? 0,
            ruleId: rule ? String(rule.id) : undefined,
            ruleName: rule?.name,
            ruleScope: rule?.scope,
        };
    }

    async awardForSellerOrder(ctx: RequestContext, sellerOrder: Pick<Order, 'id'>) {
        const order = await this.loadOrder(ctx, sellerOrder.id);
        if (!order.customer?.user) return [];
        const customerId = String(order.customer.id);
        const customerUserId = String(order.customer.user.id);
        const customerName = `${order.customer.firstName} ${order.customer.lastName}`.trim() || 'Customer';
        const orderCode = order.aggregateOrder?.code ?? order.code;
        const vendor = await this.vendorForOrder(ctx, order);
        const rules = await this.activeRules(ctx, new Date());
        const categories = await this.connection.getRepository(ctx, MarketplaceCategory).find();
        const contexts = order.lines.map(line => {
            const context = this.productContext(line.productVariant.product, line.productVariant.name);
            if (vendor) {
                context.vendorId = String(vendor.id);
                context.vendorName = vendor.shopName;
                context.vendorSlug = vendor.slug;
            }
            return context;
        });
        const categoryTargets = await this.categoryTargetsByProduct(ctx, contexts, categories);
        const grantRepository = this.connection.getRepository(ctx, MarketplacePurchaseRewardGrant);
        const existing = await grantRepository.find({ where: { orderId: String(order.id) } });
        const existingLineIds = new Set(existing.map(grant => grant.orderLineId));
        const granted: MarketplacePurchaseRewardGrant[] = [];

        for (const [index, line] of order.lines.entries()) {
            const orderLineId = String(line.id);
            if (existingLineIds.has(orderLineId)) continue;
            const context = contexts[index]!;
            const rule = this.resolveRule(
                context,
                rules,
                categoryTargets.get(context.productId) ?? new Set(),
            );
            const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0));
            const points = quantity * (rule?.pointsPerUnit ?? 0);
            if (!rule || points <= 0) continue;
            const now = new Date();
            const grant = await grantRepository.save(new MarketplacePurchaseRewardGrant({
                orderId: String(order.id),
                orderCode,
                sellerOrderCode: order.code,
                orderLineId,
                customerId,
                customerUserId,
                customerName,
                productId: context.productId,
                productName: context.productName,
                vendorId: context.vendorId,
                vendorName: context.vendorName,
                categoryId: context.categoryId,
                categoryCode: context.categoryCode,
                categoryName: context.categoryName,
                ruleId: String(rule.id),
                ruleName: rule.name,
                ruleScope: rule.scope,
                quantity,
                pointsPerUnit: rule.pointsPerUnit,
                points,
                active: true,
                awardedAt: now,
            }));
            await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).save({
                eventKey: randomUUID(),
                customerId,
                customerUserId,
                customerName,
                reviewId: `purchase:${grant.id}`,
                orderCode,
                reviewTargetType: 'PURCHASE',
                component: 'PURCHASE_REWARD',
                type: 'CREDIT',
                points,
                reason: `${context.productName} purchase reward (${quantity} x ${rule.pointsPerUnit})`,
                grantId: `purchase:${grant.id}`,
            });
            granted.push(grant);
        }
        return granted;
    }

    async reverseForSellerOrder(ctx: RequestContext, sellerOrder: Pick<Order, 'id' | 'code'>) {
        const repository = this.connection.getRepository(ctx, MarketplacePurchaseRewardGrant);
        const walletRepository = this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction);
        const grants = await repository.find({ where: { orderId: String(sellerOrder.id), active: true } });
        const reversed: MarketplacePurchaseRewardGrant[] = [];
        for (const grant of grants) {
            const remaining = await this.remainingGrantPoints(ctx, grant);
            grant.active = false;
            grant.reversedAt = new Date();
            await repository.save(grant, { reload: false });
            if (!remaining) continue;
            await walletRepository.save({
                eventKey: randomUUID(),
                customerId: grant.customerId,
                customerUserId: grant.customerUserId,
                customerName: grant.customerName,
                reviewId: `purchase:${grant.id}`,
                orderCode: grant.orderCode,
                reviewTargetType: 'PURCHASE',
                component: 'PURCHASE_REWARD',
                type: 'REVERSAL',
                points: -remaining,
                reason: `${grant.productName} purchase reward reversed for ${sellerOrder.code}`,
                grantId: `purchase:${grant.id}`,
            });
            reversed.push(grant);
        }
        return reversed;
    }

    async reverseForReturnedItems(
        ctx: RequestContext,
        sellerOrder: Pick<Order, 'id' | 'code'>,
        supportCaseId: string,
        items: Array<{ orderLineId: string; quantity: number }>,
    ) {
        const grants = await this.connection.getRepository(ctx, MarketplacePurchaseRewardGrant).find({
            where: { orderId: String(sellerOrder.id) },
        });
        const byLine = new Map(grants.map(grant => [grant.orderLineId, grant]));
        const walletRepository = this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction);
        for (const item of items) {
            const grant = byLine.get(item.orderLineId);
            if (!grant) continue;
            const eventKey = `partial-return:${supportCaseId}:${grant.id}`;
            if (await walletRepository.findOne({ where: { eventKey } })) continue;
            const remaining = await this.remainingGrantPoints(ctx, grant);
            const points = item.quantity * grant.pointsPerUnit;
            if (!Number.isSafeInteger(points) || points < 0 || points > remaining) {
                throw new Error('Purchase reward reversal exceeds the earned coins');
            }
            if (!points) continue;
            await walletRepository.save(new MarketplaceRewardWalletTransaction({
                eventKey,
                customerId: grant.customerId,
                customerUserId: grant.customerUserId,
                customerName: grant.customerName,
                reviewId: `purchase:${grant.id}`,
                orderCode: grant.orderCode,
                reviewTargetType: 'PURCHASE',
                component: 'PURCHASE_REWARD',
                type: 'REVERSAL',
                points: -points,
                reason: `${item.quantity} returned ${grant.productName} unit(s) for ${sellerOrder.code}`,
                grantId: `purchase:${grant.id}`,
            }));
            if (points === remaining) {
                grant.active = false;
                grant.reversedAt = new Date();
                await this.connection.getRepository(ctx, MarketplacePurchaseRewardGrant).save(grant, { reload: false });
            }
        }
    }

    private async remainingGrantPoints(ctx: RequestContext, grant: MarketplacePurchaseRewardGrant) {
        const reversals = await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).find({
            where: { grantId: `purchase:${grant.id}`, type: 'REVERSAL' },
        });
        return Math.max(0, grant.points + reversals.reduce((sum, item) => sum + item.points, 0));
    }

    private async loadOrder(ctx: RequestContext, orderId: ID) {
        return this.connection.getEntityOrThrow(ctx, Order, orderId, {
            relations: [
                'customer',
                'customer.user',
                'channels',
                'aggregateOrder',
                'lines',
                'lines.productVariant',
                'lines.productVariant.product',
            ],
        });
    }

    private async vendorForOrder(ctx: RequestContext, order: Order) {
        const channelIds = order.channels.map(channel => String(channel.id));
        if (!channelIds.length) return undefined;
        return (await this.connection.getRepository(ctx, VendorProfile).find({
            where: { channelId: In(channelIds) },
        }))[0];
    }

    private productContext(product: Product, fallbackName?: string): PurchaseRewardContext {
        const customFields = product.customFields as Record<string, unknown> | undefined;
        const metadata = this.productMetadata(customFields);
        return {
            productId: String(product.id),
            productName: String(product.name ?? fallbackName ?? 'Marketplace product'),
            vendorId: this.cleanText(customFields?.vendorProfileId, 80),
            categoryId: this.cleanText(metadata.categoryId, 80),
            categoryCode: this.cleanText(metadata.categoryCode, 160),
            categoryName: this.cleanText(metadata.categoryName, 180),
            categoryBreadcrumb: Array.isArray(metadata.categoryBreadcrumb)
                ? metadata.categoryBreadcrumb.map(value => String(value)).filter(Boolean)
                : [],
        };
    }

    private async categoryTargetsByProduct(
        ctx: RequestContext,
        contexts: PurchaseRewardContext[],
        categories: MarketplaceCategory[],
    ) {
        const productIds = [...new Set(contexts.map(context => context.productId))];
        const listings = productIds.length
            ? await this.connection.getRepository(ctx, MarketplaceListingCategory).find({
                where: { productId: In(productIds) },
            })
            : [];
        const listedCategoryIds = new Map<string, string[]>();
        for (const listing of listings) {
            const ids = listedCategoryIds.get(listing.productId) ?? [];
            ids.push(listing.categoryId);
            listedCategoryIds.set(listing.productId, ids);
        }
        const categoryById = new Map(categories.map(category => [String(category.id), category]));
        return new Map(contexts.map(context => {
            const targets = new Set([
                context.categoryId,
                context.categoryCode,
                context.categoryName,
                ...context.categoryBreadcrumb,
            ].map(value => this.normalize(value)).filter(Boolean));
            const pending = [...new Set([
                context.categoryId,
                ...(listedCategoryIds.get(context.productId) ?? []),
            ].filter((value): value is string => Boolean(value)))];
            const visited = new Set<string>();
            while (pending.length) {
                const id = pending.shift()!;
                if (visited.has(id)) continue;
                visited.add(id);
                const category = categoryById.get(id);
                if (!category) continue;
                [String(category.id), category.code, category.name, category.slug]
                    .map(value => this.normalize(value))
                    .filter(Boolean)
                    .forEach(value => targets.add(value));
                if (category.parentId) pending.push(String(category.parentId));
            }
            return [context.productId, targets] as const;
        }));
    }

    private async activeRules(ctx: RequestContext, at: Date) {
        await this.ensureDefaultGlobalRule(ctx);
        const rules = await this.connection.getRepository(ctx, MarketplacePurchaseRewardRule).find({
            where: { status: 'ACTIVE' },
            order: { priority: 'DESC', createdAt: 'DESC' },
        });
        return rules.filter(rule => (!rule.startsAt || rule.startsAt.getTime() <= at.getTime())
            && (!rule.endsAt || rule.endsAt.getTime() >= at.getTime()));
    }

    private resolveRule(
        context: PurchaseRewardContext,
        rules: MarketplacePurchaseRewardRule[],
        categoryTargets: Set<string>,
    ) {
        return resolvePurchaseRewardRule(
            rules,
            [context.vendorId, context.vendorName, context.vendorSlug],
            categoryTargets,
        );
    }

    private normalizeInput(input: CreateMarketplacePurchaseRewardRuleInput) {
        const scope = String(input.scope ?? '').toUpperCase() as MarketplacePurchaseRewardRuleScope;
        if (!Object.hasOwn(purchaseRewardScopePrecedence, scope)) throw new Error('Choose global, vendor, or category scope');
        const status = String(input.status ?? 'ACTIVE').toUpperCase() as MarketplacePurchaseRewardRuleStatus;
        if (!['ACTIVE', 'PAUSED', 'DRAFT'].includes(status)) throw new Error('Choose a valid reward rule status');
        const name = this.cleanText(input.name, 160);
        if (!name) throw new Error('Add a purchase reward rule name');
        const targetId = scope === 'GLOBAL' ? undefined : this.cleanText(input.targetId, 100);
        const targetCode = scope === 'GLOBAL' ? undefined : this.cleanText(input.targetCode, 160);
        const targetName = scope === 'GLOBAL'
            ? 'All marketplace products'
            : this.cleanText(input.targetName, 200);
        if (scope !== 'GLOBAL' && !targetId && !targetCode && !targetName) {
            throw new Error(`Choose a ${scope.toLowerCase()} for this purchase reward rule`);
        }
        const pointsPerUnit = Number(input.pointsPerUnit);
        if (!Number.isInteger(pointsPerUnit) || pointsPerUnit < 0 || pointsPerUnit > 10000) {
            throw new Error('Purchase reward coins must be a whole number from 0 to 10,000');
        }
        const priority = Number(input.priority ?? 0);
        if (!Number.isInteger(priority) || priority < 0 || priority > 10000) {
            throw new Error('Priority must be a whole number from 0 to 10,000');
        }
        const startsAt = this.date(input.startsAt, 'start');
        const endsAt = this.date(input.endsAt, 'end');
        if (startsAt && endsAt && startsAt.getTime() >= endsAt.getTime()) {
            throw new Error('Reward rule end must be after its start');
        }
        return {
            name,
            scope,
            targetId,
            targetCode,
            targetName,
            pointsPerUnit,
            priority,
            status,
            startsAt,
            endsAt,
            description: this.cleanText(input.description, 1000),
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

    private date(value: Date | string | null | undefined, label: string) {
        if (!value) return undefined;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error(`Purchase reward ${label} date is invalid`);
        return date;
    }

    private cleanText(value: unknown, maxLength: number) {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        return text ? text.slice(0, maxLength) : undefined;
    }

    private normalize(value: unknown) {
        return String(value ?? '').trim().toLowerCase();
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }
}
