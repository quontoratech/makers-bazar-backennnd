import { MarketplaceReviewTargetType } from '../entities/marketplace-review.entity';

export interface MarketplaceReviewFilterInput {
    targetType?: MarketplaceReviewTargetType;
    productId?: string;
    vendorProfileId?: string;
}

export interface SubmitMarketplaceReviewInput {
    id?: string | null;
    orderId: string;
    targetType: MarketplaceReviewTargetType;
    productId?: string | null;
    variantId?: string | null;
    vendorProfileId?: string | null;
    rating: number;
    title?: string | null;
    body?: string | null;
    mediaIds?: string[] | null;
}
