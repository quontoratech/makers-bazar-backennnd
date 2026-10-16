import { MarketplaceReviewRewardComponent } from '../entities/marketplace-review-reward-grant.entity';

const PRODUCT_REVIEW_TYPES = new Set(['PRODUCT', 'SERVICE', 'WORKSHOP']);

export interface ReviewRewardPolicy {
    productReviewPoints: number;
    imageBonusPoints: number;
    videoBonusPoints: number;
    vendorReviewPoints: number;
}

export function eligibleReviewRewards(
    targetType: string,
    mediaTypes: string[],
    settings: ReviewRewardPolicy,
) {
    const rewards = new Map<MarketplaceReviewRewardComponent, number>();
    if (PRODUCT_REVIEW_TYPES.has(targetType)) {
        rewards.set('PRODUCT_REVIEW', settings.productReviewPoints);
        const imageCount = mediaTypes.filter(mediaType => mediaType === 'IMAGE').length;
        if (imageCount > 0) rewards.set('IMAGE_BONUS', settings.imageBonusPoints * imageCount);
        if (mediaTypes.includes('VIDEO')) rewards.set('VIDEO_BONUS', settings.videoBonusPoints);
    }
    if (targetType === 'VENDOR') rewards.set('VENDOR_REVIEW', settings.vendorReviewPoints);
    return rewards;
}
