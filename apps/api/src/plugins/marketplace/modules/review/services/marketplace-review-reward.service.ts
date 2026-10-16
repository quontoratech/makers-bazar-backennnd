import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ForbiddenError, RequestContext, TransactionalConnection } from '@vendure/core';

import { UpdateMarketplaceReviewRewardSettingsInput } from '../dto/marketplace-review-reward.inputs';
import { MarketplaceReviewMedia } from '../entities/marketplace-review-media.entity';
import {
    MarketplaceReviewRewardComponent,
    MarketplaceReviewRewardGrant,
} from '../entities/marketplace-review-reward-grant.entity';
import { MarketplaceReviewRewardSettings } from '../entities/marketplace-review-reward-settings.entity';
import { MarketplaceReview } from '../entities/marketplace-review.entity';
import { MarketplaceRewardWalletTransaction } from '../entities/marketplace-reward-wallet-transaction.entity';
import { eligibleReviewRewards } from './review-reward-policy';

const componentReasons: Record<MarketplaceReviewRewardComponent, string> = {
    PRODUCT_REVIEW: 'Verified product review',
    IMAGE_BONUS: 'Photo review bonus',
    VIDEO_BONUS: 'Video review bonus',
    VENDOR_REVIEW: 'Verified vendor review',
    PURCHASE_REWARD: 'Completed purchase reward',
    REWARD_REDEMPTION: 'Checkout reward redemption',
};

@Injectable()
export class MarketplaceReviewRewardService {
    constructor(private connection: TransactionalConnection) {}

    async settings(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplaceReviewRewardSettings);
        const existing = await repository.findOne({ where: { scopeKey: 'GLOBAL' } });
        if (existing) return existing;
        try {
            return await repository.save(repository.create({ scopeKey: 'GLOBAL' }));
        } catch (error) {
            const concurrentlyCreated = await repository.findOne({ where: { scopeKey: 'GLOBAL' } });
            if (concurrentlyCreated) return concurrentlyCreated;
            throw error;
        }
    }

    async updateSettings(ctx: RequestContext, input: UpdateMarketplaceReviewRewardSettingsInput) {
        const settings = await this.settings(ctx);
        settings.enabled = Boolean(input.enabled);
        settings.productReviewPoints = this.points(input.productReviewPoints, 'Product review');
        settings.imageBonusPoints = this.points(input.imageBonusPoints, 'Photo bonus');
        settings.videoBonusPoints = this.points(input.videoBonusPoints, 'Video bonus');
        settings.vendorReviewPoints = this.points(input.vendorReviewPoints, 'Vendor review');
        settings.updatedByUserId = this.requireUser(ctx);
        return this.connection.getRepository(ctx, MarketplaceReviewRewardSettings).save(settings);
    }

    async reconcile(ctx: RequestContext, review: MarketplaceReview, media: MarketplaceReviewMedia[]) {
        const settings = await this.settings(ctx);
        const desired = eligibleReviewRewards(review.targetType, media.map(item => item.mediaType), settings);
        const grantRepository = this.connection.getRepository(ctx, MarketplaceReviewRewardGrant);
        const grants = await grantRepository.find({ where: { reviewId: String(review.id) } });
        const grantByComponent = new Map(grants.map(grant => [grant.component, grant]));

        for (const grant of grants) {
            if (grant.active && !desired.has(grant.component)) {
                await this.reverseGrant(ctx, review, grant);
            }
        }
        const canCredit = settings.enabled && review.status === 'PUBLISHED';

        for (const [component, points] of desired) {
            if (points <= 0) continue;
            const existing = grantByComponent.get(component);
            if (existing?.active) {
                if (existing.points !== points && (points < existing.points || canCredit)) {
                    await this.adjustGrant(ctx, review, existing, points);
                }
                continue;
            }
            if (!canCredit) continue;
            await this.creditGrant(ctx, review, component, points, existing);
        }
    }

    async reverseReview(ctx: RequestContext, review: MarketplaceReview) {
        const grants = await this.connection.getRepository(ctx, MarketplaceReviewRewardGrant).find({
            where: { reviewId: String(review.id), active: true },
        });
        for (const grant of grants) await this.reverseGrant(ctx, review, grant);
    }

    async myWallet(ctx: RequestContext) {
        const customerUserId = this.requireUser(ctx);
        const allTransactions = await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).find({
            where: { customerUserId },
            order: { createdAt: 'DESC' },
        });
        return {
            settings: await this.settings(ctx),
            ...this.walletSummary(allTransactions),
            transactions: allTransactions.slice(0, 100),
        };
    }

    async adminDashboard(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction);
        const allTransactions = await repository.find({ order: { createdAt: 'DESC' } });
        const customerUserIds = new Set(allTransactions.map(item => item.customerUserId));
        return {
            settings: await this.settings(ctx),
            ...this.walletSummary(allTransactions),
            rewardedCustomers: customerUserIds.size,
            recentTransactions: allTransactions.slice(0, 100),
        };
    }

    private async creditGrant(
        ctx: RequestContext,
        review: MarketplaceReview,
        component: MarketplaceReviewRewardComponent,
        points: number,
        existing?: MarketplaceReviewRewardGrant,
    ) {
        const grantRepository = this.connection.getRepository(ctx, MarketplaceReviewRewardGrant);
        const now = new Date();
        const grant = existing ?? grantRepository.create({
            reviewId: String(review.id),
            customerId: review.customerId,
            customerUserId: review.customerUserId,
            component,
        });
        grant.points = points;
        grant.active = true;
        grant.awardedAt = now;
        grant.reversedAt = undefined;
        const saved = await grantRepository.save(grant);
        await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).save({
            eventKey: randomUUID(),
            customerId: review.customerId,
            customerUserId: review.customerUserId,
            customerName: review.customerName,
            reviewId: String(review.id),
            orderCode: review.orderCode,
            reviewTargetType: review.targetType,
            component,
            type: 'CREDIT',
            points,
            reason: componentReasons[component],
            grantId: String(saved.id),
        });
    }

    private async reverseGrant(
        ctx: RequestContext,
        review: MarketplaceReview,
        grant: MarketplaceReviewRewardGrant,
    ) {
        if (!grant.active) return;
        grant.active = false;
        grant.reversedAt = new Date();
        await this.connection.getRepository(ctx, MarketplaceReviewRewardGrant).save(grant, { reload: false });
        await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).save({
            eventKey: randomUUID(),
            customerId: review.customerId,
            customerUserId: review.customerUserId,
            customerName: review.customerName,
            reviewId: String(review.id),
            orderCode: review.orderCode,
            reviewTargetType: review.targetType,
            component: grant.component,
            type: 'REVERSAL',
            points: -grant.points,
            reason: `${componentReasons[grant.component]} reversed`,
            grantId: String(grant.id),
        });
    }

    private async adjustGrant(
        ctx: RequestContext,
        review: MarketplaceReview,
        grant: MarketplaceReviewRewardGrant,
        points: number,
    ) {
        const difference = points - grant.points;
        if (difference === 0) return;
        grant.points = points;
        await this.connection.getRepository(ctx, MarketplaceReviewRewardGrant).save(grant, { reload: false });
        await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).save({
            eventKey: randomUUID(),
            customerId: review.customerId,
            customerUserId: review.customerUserId,
            customerName: review.customerName,
            reviewId: String(review.id),
            orderCode: review.orderCode,
            reviewTargetType: review.targetType,
            component: grant.component,
            type: difference > 0 ? 'CREDIT' : 'REVERSAL',
            points: difference,
            reason: `${componentReasons[grant.component]} adjusted`,
            grantId: String(grant.id),
        });
    }

    private walletSummary(transactions: MarketplaceRewardWalletTransaction[]) {
        const balance = transactions.reduce((total, item) => total + item.points, 0);
        const lifetimeEarned = transactions
            .filter(item => item.component !== 'REWARD_REDEMPTION' && item.points > 0)
            .reduce((total, item) => total + item.points, 0);
        const lifetimeReversed = Math.abs(transactions
            .filter(item => item.component !== 'REWARD_REDEMPTION' && item.points < 0)
            .reduce((total, item) => total + item.points, 0));
        const lifetimeSpent = Math.abs(transactions
            .filter(item => item.component === 'REWARD_REDEMPTION' && item.points < 0)
            .reduce((total, item) => total + item.points, 0));
        return { balance, lifetimeEarned, lifetimeReversed, lifetimeSpent };
    }

    private points(value: unknown, label: string) {
        const points = Number(value);
        if (!Number.isInteger(points) || points < 0 || points > 10000) {
            throw new Error(`${label} points must be a whole number from 0 to 10,000`);
        }
        return points;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }
}
