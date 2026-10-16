import { ID } from '@vendure/core';

export interface ApplyAsAffiliateInput {
    displayName: string;
    slug?: string;
    bio?: string;
    channels?: Array<{ platform: string; url: string; audience?: number }>;
}

export interface ReviewAffiliateInput {
    id: ID;
    status: 'APPROVED' | 'REJECTED' | 'SUSPENDED';
    commissionPercent?: number;
}
