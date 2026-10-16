import { ID } from '@vendure/core';

export interface CreatePromotionCampaignInput {
    ownerType: 'PLATFORM' | 'VENDOR' | 'COMMERCIAL_BRAND';
    ownerId?: string;
    campaignType: 'PLACEMENT' | 'AFFILIATE' | 'EVENT' | 'COLLECTION' | 'LOYALTY';
    title: string;
    description?: string;
    placement: string;
    budget?: number;
    maxPlacements?: number;
    startsAt: Date;
    endsAt: Date;
    target?: Record<string, string | string[]>;
    creative?: Record<string, string>;
}

export interface UpdatePromotionCampaignInput {
    id: ID;
    title?: string;
    description?: string | null;
    placement?: 'HOME' | 'CATEGORY' | 'BOTH';
    budget?: number;
    maxPlacements?: number;
    startsAt?: Date;
    endsAt?: Date;
    target?: Record<string, string | string[]> | null;
    creative?: Record<string, string> | null;
}

export interface CreatePromotionRateInput {
    id?: ID;
    scope: 'GLOBAL' | 'VENDOR' | 'CATEGORY' | 'VENDOR_CATEGORY' | 'CAMPAIGN';
    placement: 'HOME' | 'CATEGORY' | 'BOTH';
    vendorProfileId?: string;
    categoryId?: string;
    categoryCode?: string;
    campaignId?: string;
    pricePerDay: number;
    currencyCode?: string;
    active?: boolean;
    note?: string;
}

export interface CreatePromotionRequestInput {
    productId?: ID;
    targetType?: 'PRODUCT' | 'VENDOR_CATEGORY';
    categoryId?: ID;
    placement: 'HOME' | 'CATEGORY' | 'BOTH';
    campaignId?: ID;
    startsAt: Date;
    durationDays: number;
    expectedAmount?: number;
}

export interface SubmitPromotionPaymentInput {
    id: ID;
    paymentReference: string;
    paymentNote?: string;
}

export interface ReviewPromotionRequestInput {
    id: ID;
    status: 'APPROVE_SPACE' | 'PAYMENT_VERIFIED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
    paymentStatus?: 'VERIFIED' | 'REJECTED';
    adminNote?: string;
}

export interface ReviewPromotionCampaignInput {
    id: ID;
    status: 'APPROVED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'REJECTED';
}
