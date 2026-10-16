import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import {
    AssetService,
    ForbiddenError,
    isGraphQlErrorResult,
    Order,
    RequestContext,
    TransactionalConnection,
    TranslatorService,
} from '@vendure/core';
import { In } from 'typeorm';

import { MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import {
    MarketplaceReviewFilterInput,
    SubmitMarketplaceReviewInput,
} from '../dto/marketplace-review.inputs';
import {
    MarketplaceReview,
    MarketplaceReviewTargetType,
} from '../entities/marketplace-review.entity';
import { MarketplaceReviewMedia } from '../entities/marketplace-review-media.entity';
import { MarketplaceReviewRewardService } from './marketplace-review-reward.service';

type ReviewableOrderLine = Order['lines'][number];

interface VerifiedReviewTarget {
    customerUserId: string;
    customerId: string;
    customerName: string;
    orderId: string;
    orderCode: string;
    targetType: MarketplaceReviewTargetType;
    productId?: string;
    productSlug?: string;
    productName?: string;
    variantId?: string;
    variantName?: string;
    vendorProfileId?: string;
    vendorName?: string;
    vendorSlug?: string;
}

const REVIEW_TARGET_TYPES = new Set<MarketplaceReviewTargetType>([
    'PRODUCT',
    'VENDOR',
    'SERVICE',
    'WORKSHOP',
]);

const PRODUCT_REVIEW_TYPES = new Set<MarketplaceReviewTargetType>(['PRODUCT', 'SERVICE', 'WORKSHOP']);
const VENDOR_RESPONSE_BLOCKED_TERMS = [
    'idiot',
    'stupid',
    'liar',
    'thief',
    'fraudster',
    'scammer',
];
const REVIEW_MEDIA_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'video/mp4',
    'video/webm',
    'video/quicktime',
]);

@Injectable()
export class MarketplaceReviewService {
    constructor(
        private connection: TransactionalConnection,
        private assetService: AssetService,
        private translator: TranslatorService,
        private rewardService: MarketplaceReviewRewardService,
    ) {}

    async uploadMedia(
        ctx: RequestContext,
        inputs: Array<{ file: Promise<{ filename: string; mimetype: string; createReadStream: () => NodeJS.ReadableStream }> }>,
    ) {
        const uploadedByUserId = this.requireCustomerUser(ctx);
        if (!inputs.length) throw new Error('Choose at least one review photo or video');
        if (inputs.length > 5) throw new Error('Upload no more than 5 review files');

        const repository = this.connection.getRepository(ctx, MarketplaceReviewMedia);
        const media: MarketplaceReviewMedia[] = [];
        for (const input of inputs) {
            const file = await input.file;
            if (!REVIEW_MEDIA_MIME_TYPES.has(file.mimetype)) {
                throw new Error(`${file.filename} must be a JPG, PNG, WebP, MP4, MOV, or WebM file`);
            }
            const asset = await this.assetService.create(ctx, { ...input, tags: ['marketplace-review-media'] } as any);
            if (isGraphQlErrorResult(asset)) throw new Error(asset.message);
            media.push(await repository.save(new MarketplaceReviewMedia({
                uploadedByUserId,
                assetId: String(asset.id),
                name: asset.name,
                preview: asset.preview,
                source: asset.source || asset.preview,
                mimeType: asset.mimeType,
                mediaType: asset.mimeType.startsWith('video/') ? 'VIDEO' : 'IMAGE',
            })));
        }
        return media;
    }

    async submit(ctx: RequestContext, input: SubmitMarketplaceReviewInput) {
        const target = await this.verifyTarget(ctx, input);
        const rating = Number(input.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            throw new Error('Choose a rating from 1 to 5');
        }

        const repository = this.connection.getRepository(ctx, MarketplaceReview);
        let review = input.id
            ? await repository.findOne({ where: { id: String(input.id), customerUserId: target.customerUserId } })
            : await this.findExistingReview(ctx, target);
        if (input.id && !review) throw new ForbiddenError();

        const title = this.cleanText(input.title, 140);
        const body = this.cleanText(input.body, 3000);
        if (!title && !body) {
            throw new Error('Write a short title or review detail');
        }
        if (!PRODUCT_REVIEW_TYPES.has(target.targetType) && input.mediaIds?.length) {
            throw new Error('Photos and videos can only be attached to product, service, or workshop reviews');
        }

        review = repository.create({
            ...(review ?? {}),
            ...target,
            rating,
            title,
            body,
            status: 'PUBLISHED',
            verified: true,
        });
        review = await repository.save(review);
        const media = await this.attachMedia(ctx, review, input.mediaIds ?? []);
        await this.rewardService.reconcile(ctx, review, media);
        return this.toResult(review, media);
    }

    async delete(ctx: RequestContext, id: string) {
        const customerUserId = this.requireCustomerUser(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceReview);
        const review = await repository.findOne({ where: { id: String(id), customerUserId } });
        if (!review) throw new ForbiddenError();
        await this.rewardService.reverseReview(ctx, review);
        await repository.remove(review);
        return { success: true, message: 'Review removed' };
    }

    async respondAsVendor(ctx: RequestContext, input: { id: string; response: string }) {
        const vendor = await this.vendorWorkspace(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceReview);
        const review = await repository.findOne({ where: { id: String(input.id), vendorProfileId: String(vendor.id) } });
        if (!review || review.status !== 'PUBLISHED') throw new ForbiddenError();
        const response = this.cleanText(input.response, 1500);
        this.assertVendorResponseAllowed(response);
        const now = new Date();
        review.vendorResponse = response;
        review.vendorResponseByUserId = this.requireUser(ctx);
        review.vendorResponseCreatedAt = review.vendorResponseCreatedAt ?? now;
        review.vendorResponseUpdatedAt = now;
        await repository.save(review, { reload: false });
        const media = await this.connection.getRepository(ctx, MarketplaceReviewMedia).find({
            where: { reviewId: String(review.id) },
            order: { createdAt: 'ASC' },
        });
        return this.toResult(review, media);
    }

    async hideByAdmin(ctx: RequestContext, id: string, reason?: string | null) {
        const repository = this.connection.getRepository(ctx, MarketplaceReview);
        const review = await repository.findOne({ where: { id: String(id) } });
        if (!review) throw new Error('Linked review was not found');
        review.status = 'HIDDEN';
        review.moderationReason = this.cleanText(reason, 3000) ?? 'Removed by marketplace trust and safety';
        review.moderatedByUserId = this.requireUser(ctx);
        review.moderatedAt = new Date();
        await repository.save(review, { reload: false });
        await this.rewardService.reverseReview(ctx, review);
        return { success: true, message: 'Review removed from public marketplace surfaces' };
    }

    async findMine(ctx: RequestContext, options?: MarketplaceListOptions) {
        const customerUserId = this.requireCustomerUser(ctx);
        const { skip, take } = normalizeListOptions(options);
        const [reviews, totalItems] = await this.connection.getRepository(ctx, MarketplaceReview).findAndCount({
            where: { customerUserId },
            order: { updatedAt: 'DESC' },
            skip,
            take,
        });
        return { items: await this.attachMediaToReviews(ctx, reviews), totalItems };
    }

    async findPublic(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        filter?: MarketplaceReviewFilterInput,
    ) {
        const { skip, take } = normalizeListOptions(options);
        const query = this.connection.getRepository(ctx, MarketplaceReview).createQueryBuilder('review')
            .where('review.status = :status', { status: 'PUBLISHED' });
        if (filter?.targetType) query.andWhere('review.targetType = :targetType', { targetType: filter.targetType });
        if (filter?.productId) query.andWhere('review.productId = :productId', { productId: String(filter.productId) });
        if (filter?.vendorProfileId) query.andWhere('review.vendorProfileId = :vendorProfileId', { vendorProfileId: String(filter.vendorProfileId) });
        const [reviews, totalItems] = await query
            .orderBy('review.updatedAt', 'DESC')
            .skip(skip)
            .take(take)
            .getManyAndCount();
        return { items: await this.attachMediaToReviews(ctx, reviews), totalItems };
    }

    async summaryForProduct(ctx: RequestContext, productId: string) {
        const reviews = await this.connection.getRepository(ctx, MarketplaceReview).createQueryBuilder('review')
            .where('review.status = :status', { status: 'PUBLISHED' })
            .andWhere('review.productId = :productId', { productId: String(productId) })
            .andWhere('review.targetType IN (:...targetTypes)', { targetTypes: [...PRODUCT_REVIEW_TYPES] })
            .getMany();
        return this.summaryFromReviews(reviews);
    }

    async summaryForVendor(ctx: RequestContext, vendorProfileId: string) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: String(vendorProfileId) } });
        const reviews = await this.connection.getRepository(ctx, MarketplaceReview).createQueryBuilder('review')
            .where('review.status = :status', { status: 'PUBLISHED' })
            .andWhere('review.vendorProfileId = :vendorProfileId', { vendorProfileId: String(vendorProfileId) })
            .getMany();
        const summary = this.summaryFromReviews(reviews);
        const fulfillmentPerformance = vendor ? await this.fulfillmentPerformance(ctx, vendor) : this.emptyFulfillmentPerformance();
        return {
            ...summary,
            fulfillmentPerformance,
            badges: this.vendorBadges(vendor, summary, fulfillmentPerformance),
        };
    }

    async vendorDashboard(ctx: RequestContext, options?: MarketplaceListOptions) {
        const vendor = await this.vendorWorkspace(ctx);
        const { skip, take } = normalizeListOptions(options);
        const repository = this.connection.getRepository(ctx, MarketplaceReview);
        const [reviews, totalItems] = await repository.findAndCount({
            where: { vendorProfileId: String(vendor.id), status: 'PUBLISHED' },
            order: { updatedAt: 'DESC' },
            skip,
            take,
        });
        const allReviews = await repository.find({
            where: { vendorProfileId: String(vendor.id), status: 'PUBLISHED' },
            order: { updatedAt: 'DESC' },
        });
        const summary = this.summaryFromReviews(allReviews);
        const fulfillmentPerformance = await this.fulfillmentPerformance(ctx, vendor);
        const respondedReviews = allReviews.filter(review => Boolean(review.vendorResponse?.trim())).length;
        const responseRate = allReviews.length ? Math.round((respondedReviews / allReviews.length) * 100) : null;
        const baseBadges = this.vendorBadges(vendor, summary, fulfillmentPerformance);
        const performanceBadges = [
            ...baseBadges,
            ...(responseRate != null && responseRate >= 90 && allReviews.length >= 5 ? ['Responsive seller'] : []),
            ...(fulfillmentPerformance.acceptanceRate != null && fulfillmentPerformance.acceptanceRate >= 95 && fulfillmentPerformance.totalOrders >= 5 ? ['High acceptance'] : []),
        ];
        return {
            summary: {
                ...summary,
                fulfillmentPerformance,
                badges: [...new Set(performanceBadges)],
            },
            targetSummaries: this.reviewTargetSummaries(allReviews),
            reviews: { items: await this.attachMediaToReviews(ctx, reviews), totalItems },
            totalReviews: allReviews.length,
            respondedReviews,
            responseRate,
            performanceBadges: [...new Set(performanceBadges)],
            qualityWarnings: this.qualityWarnings(vendor, summary, responseRate, fulfillmentPerformance),
        };
    }

    private async verifyTarget(
        ctx: RequestContext,
        input: SubmitMarketplaceReviewInput,
    ): Promise<VerifiedReviewTarget> {
        const customerUserId = this.requireCustomerUser(ctx);
        const targetType = this.cleanTargetType(input.targetType);
        const order = await this.reviewableOrder(ctx, String(input.orderId), customerUserId);
        if (!order?.customer) {
            throw new Error('Only verified marketplace purchases can be reviewed');
        }

        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendorById = new Map(vendors.map(vendor => [String(vendor.id), vendor]));
        const vendorByChannel = new Map(vendors.flatMap(vendor => vendor.channelId ? [[String(vendor.channelId), vendor] as const] : []));
        const customerName = `${order.customer.firstName} ${order.customer.lastName}`.trim() || 'Customer';
        const base = {
            customerUserId,
            customerId: String(order.customer.id),
            customerName,
            orderId: String(order.id),
            orderCode: order.code,
        };

        if (PRODUCT_REVIEW_TYPES.has(targetType)) {
            const productId = String(input.productId ?? '').trim();
            if (!productId) throw new Error('Choose the purchased product to review');
            const line = order.lines.find(item => {
                const product = item.productVariant.product;
                return product && String(product.id) === productId
                    && (!input.variantId || String(item.productVariant.id) === String(input.variantId));
            });
            if (!line?.productVariant.product) {
                throw new Error('This product was not found in your verified order');
            }
            const product = this.translator.translate(line.productVariant.product, ctx);
            const variant = this.translator.translate(line.productVariant, ctx);
            const productType = this.productType(line);
            const expectedTargetType = productType === 'SERVICE' || productType === 'WORKSHOP'
                ? productType
                : 'PRODUCT';
            if (targetType !== expectedTargetType) {
                throw new Error(`This order item should be reviewed as a ${expectedTargetType.toLowerCase()}`);
            }
            const vendor = this.vendorForLine(line, vendorById, vendorByChannel);
            return {
                ...base,
                targetType,
                productId: String(product.id),
                productSlug: String(product.slug ?? ''),
                productName: String(product.name ?? variant.name ?? ''),
                variantId: String(variant.id),
                variantName: String(variant.name ?? variant.sku ?? ''),
                vendorProfileId: vendor ? String(vendor.id) : undefined,
                vendorName: vendor?.shopName,
                vendorSlug: vendor?.slug,
            };
        }

        const vendorProfileId = String(input.vendorProfileId ?? '').trim();
        if (!vendorProfileId) throw new Error('Choose the vendor connected to this order');
        const vendor = vendorById.get(vendorProfileId);
        if (!vendor) throw new Error('The selected vendor is not available');
        const hasVendorLine = order.lines.some(line => String(this.vendorForLine(line, vendorById, vendorByChannel)?.id ?? '') === vendorProfileId);
        if (!hasVendorLine) throw new Error('This vendor was not found in your verified order');

        return {
            ...base,
            targetType,
            vendorProfileId: String(vendor.id),
            vendorName: vendor.shopName,
            vendorSlug: vendor.slug,
        };
    }

    private async reviewableOrder(ctx: RequestContext, orderId: string, customerUserId: string) {
        return this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('customer.user', 'customerUser')
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'productVariant')
            .leftJoinAndSelect('productVariant.product', 'product')
            .leftJoinAndSelect('product.translations', 'productTranslations')
            .leftJoinAndSelect('productVariant.translations', 'productVariantTranslations')
            .where('order.id = :orderId', { orderId })
            .andWhere('customerUser.id = :customerUserId', { customerUserId })
            .andWhere('order.active = :active', { active: false })
            .andWhere('order.type IN (:...types)', { types: [OrderType.Aggregate, OrderType.Regular] })
            .getOne();
    }

    private async findExistingReview(ctx: RequestContext, target: VerifiedReviewTarget) {
        const query = this.connection.getRepository(ctx, MarketplaceReview).createQueryBuilder('review')
            .where('review.customerUserId = :customerUserId', { customerUserId: target.customerUserId })
            .andWhere('review.orderId = :orderId', { orderId: target.orderId })
            .andWhere('review.targetType = :targetType', { targetType: target.targetType });
        if (target.productId) query.andWhere('review.productId = :productId', { productId: target.productId });
        else query.andWhere('review.productId IS NULL');
        if (target.vendorProfileId) query.andWhere('review.vendorProfileId = :vendorProfileId', { vendorProfileId: target.vendorProfileId });
        else query.andWhere('review.vendorProfileId IS NULL');
        return query.getOne();
    }

    private async attachMedia(ctx: RequestContext, review: MarketplaceReview, rawMediaIds: string[]) {
        const mediaIds = [...new Set(rawMediaIds.map(id => String(id).trim()).filter(Boolean))];
        if (mediaIds.length > 5) throw new Error('Attach no more than 5 photos or videos');

        const repository = this.connection.getRepository(ctx, MarketplaceReviewMedia);
        const existing = await repository.find({ where: { reviewId: String(review.id) } });
        const nextIds = new Set(mediaIds);
        for (const item of existing) {
            if (!nextIds.has(String(item.id))) {
                item.reviewId = undefined;
                await repository.save(item, { reload: false });
            }
        }
        if (!mediaIds.length) return [];

        const media = await repository.find({
            where: { id: In(mediaIds), uploadedByUserId: review.customerUserId },
        });
        if (media.length !== mediaIds.length) throw new Error('One or more review media files are invalid');
        for (const item of media) {
            if (item.reviewId && String(item.reviewId) !== String(review.id)) {
                throw new Error('One or more review media files are already attached to another review');
            }
            item.reviewId = String(review.id);
        }
        await repository.save(media, { reload: false });
        return media;
    }

    private async attachMediaToReviews(ctx: RequestContext, reviews: MarketplaceReview[]) {
        if (!reviews.length) return [];
        const media = await this.connection.getRepository(ctx, MarketplaceReviewMedia).find({
            where: { reviewId: In(reviews.map(review => String(review.id))) },
            order: { createdAt: 'ASC' },
        });
        const mediaByReviewId = new Map<string, MarketplaceReviewMedia[]>();
        for (const item of media) {
            const items = mediaByReviewId.get(String(item.reviewId)) ?? [];
            items.push(item);
            mediaByReviewId.set(String(item.reviewId), items);
        }
        return reviews.map(review => this.toResult(review, mediaByReviewId.get(String(review.id)) ?? []));
    }

    private toResult(review: MarketplaceReview, media: MarketplaceReviewMedia[] = []) {
        return {
            ...review,
            id: String(review.id),
            media: media.map(item => ({
                id: String(item.id),
                createdAt: item.createdAt,
                assetId: item.assetId,
                name: item.name,
                preview: item.preview,
                source: item.source,
                mimeType: item.mimeType,
                mediaType: item.mediaType,
            })),
        };
    }

    private summaryFromReviews(reviews: MarketplaceReview[]) {
        const count = reviews.length;
        const average = count
            ? Math.round((reviews.reduce((total, review) => total + review.rating, 0) / count) * 10) / 10
            : null;
        const ratingBreakdown = {
            5: reviews.filter(review => review.rating === 5).length,
            4: reviews.filter(review => review.rating === 4).length,
            3: reviews.filter(review => review.rating === 3).length,
            2: reviews.filter(review => review.rating === 2).length,
            1: reviews.filter(review => review.rating === 1).length,
        };
        return { average, count, ratingBreakdown };
    }

    private async fulfillmentPerformance(ctx: RequestContext, vendor: VendorProfile) {
        if (!vendor.channelId) return this.emptyFulfillmentPerformance();
        const orders = await this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoin('order.channels', 'channel')
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .andWhere('channel.id = :channelId', { channelId: vendor.channelId })
            .getMany();
        const statuses = orders.map(order => this.orderStatus(order));
        const totalOrders = statuses.length;
        const cancelledOrders = statuses.filter(status => ['REJECTED', 'CANCELLED'].includes(status)).length;
        const completedOrders = statuses.filter(status => ['DELIVERED', 'FULFILLED', 'RETURN_REQUESTED', 'RETURN_APPROVED', 'RETURN_REJECTED', 'RETURNED', 'REFUNDED'].includes(status)).length;
        const activeOrders = Math.max(0, totalOrders - cancelledOrders);
        const acceptanceRate = totalOrders ? Math.round(((totalOrders - cancelledOrders) / totalOrders) * 100) : null;
        const completionRate = activeOrders ? Math.round((completedOrders / activeOrders) * 100) : null;
        return {
            totalOrders,
            completedOrders,
            cancelledOrders,
            acceptanceRate,
            completionRate,
            label: totalOrders
                ? `${completionRate ?? 0}% fulfilled from ${activeOrders} accepted order${activeOrders === 1 ? '' : 's'}`
                : 'No fulfilment history yet',
        };
    }

    private emptyFulfillmentPerformance() {
        return {
            totalOrders: 0,
            completedOrders: 0,
            cancelledOrders: 0,
            acceptanceRate: null,
            completionRate: null,
            label: 'No fulfilment history yet',
        };
    }

    private vendorBadges(
        vendor: VendorProfile | null,
        summary: { average: number | null; count: number },
        fulfillmentPerformance: { totalOrders: number; completionRate: number | null },
    ) {
        const badges: string[] = [];
        if (vendor?.verified) badges.push('Verified vendor');
        if (summary.average != null && summary.average >= 4.5 && summary.count >= 5) badges.push('Top rated');
        if (fulfillmentPerformance.totalOrders >= 5 && (fulfillmentPerformance.completionRate ?? 0) >= 90) {
            badges.push('Strong fulfilment');
        }
        if (!summary.count) badges.push('New shop');
        return badges;
    }

    private reviewTargetSummaries(reviews: MarketplaceReview[]) {
        return [...REVIEW_TARGET_TYPES].map(targetType => {
            const targetReviews = reviews.filter(review => review.targetType === targetType);
            return {
                targetType,
                ...this.summaryFromReviews(targetReviews),
            };
        });
    }

    private qualityWarnings(
        vendor: VendorProfile,
        summary: { average: number | null; count: number },
        responseRate: number | null,
        fulfillmentPerformance: { totalOrders: number; acceptanceRate: number | null; completionRate: number | null },
    ) {
        const warnings: string[] = [];
        if (summary.count >= 3 && (summary.average ?? 0) < 3.5) {
            warnings.push('Average rating is below the platform quality target.');
        }
        if (summary.count >= 3 && (responseRate ?? 0) < 50) {
            warnings.push('Review response rate is below 50%.');
        }
        if (fulfillmentPerformance.totalOrders >= 5 && (fulfillmentPerformance.acceptanceRate ?? 0) < 80) {
            warnings.push('Order acceptance rate is below the marketplace service target.');
        }
        if (fulfillmentPerformance.totalOrders >= 5 && (fulfillmentPerformance.completionRate ?? 0) < 85) {
            warnings.push('Fulfilment completion rate is below the marketplace service target.');
        }
        if (vendor.warningCount > 0) {
            warnings.push(`${vendor.warningCount} active quality warning${vendor.warningCount === 1 ? '' : 's'} on this shop.`);
        }
        return warnings;
    }

    private assertVendorResponseAllowed(response: string | undefined) {
        if (!response || response.length < 3) throw new Error('Write a public response before saving');
        if (/https?:\/\//i.test(response) || /[^\s@]+@[^\s@]+\.[^\s@]+/i.test(response) || /\+?\d[\d\s().-]{7,}\d/.test(response)) {
            throw new Error('Public responses cannot include links, email addresses, phone numbers, or private contact details');
        }
        const normalized = response.toLowerCase();
        const blocked = VENDOR_RESPONSE_BLOCKED_TERMS.find(term => normalized.includes(term));
        if (blocked) {
            throw new Error(`Public response contains language that is not allowed by moderation rules: ${blocked}`);
        }
    }

    private async vendorWorkspace(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new ForbiddenError();
        return vendor;
    }

    private vendorForLine(
        line: ReviewableOrderLine,
        vendorById: Map<string, VendorProfile>,
        vendorByChannel: Map<string, VendorProfile>,
    ) {
        const channelVendor = vendorByChannel.get(String(line.sellerChannelId ?? ''));
        if (channelVendor) return channelVendor;
        const productVendorId = String((line.productVariant.product?.customFields as Record<string, unknown> | undefined)?.vendorProfileId ?? '');
        return productVendorId ? vendorById.get(productVendorId) : undefined;
    }

    private productType(line: ReviewableOrderLine) {
        return String((line.productVariant.product?.customFields as Record<string, unknown> | undefined)?.marketplaceType ?? 'PHYSICAL');
    }

    private orderStatus(order: Order) {
        const storedStatus = String((order.customFields as Record<string, unknown>)?.marketplaceStatus ?? 'PENDING');
        const legacy: Record<string, string> = {
            PLACED: 'PENDING',
            READY_FOR_DISPATCH: 'PACKED',
            SHIPPED: 'DISPATCHED',
        };
        return legacy[storedStatus] ?? storedStatus;
    }

    private cleanTargetType(value: unknown): MarketplaceReviewTargetType {
        const targetType = String(value ?? '').trim().toUpperCase() as MarketplaceReviewTargetType;
        if (!REVIEW_TARGET_TYPES.has(targetType)) throw new Error('Choose a valid review type');
        return targetType;
    }

    private cleanText(value: unknown, maxLength: number) {
        const text = String(value ?? '')
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return text ? text.slice(0, maxLength).trim() : undefined;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }

    private requireCustomerUser(ctx: RequestContext) {
        return this.requireUser(ctx);
    }
}
