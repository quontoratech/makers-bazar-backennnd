import { ID } from '@vendure/core';

import {
    MarketplaceApplicationRole,
    MarketplaceApplicationStatus,
} from '../entities/role-application.entity';

export interface SubmitRoleApplicationInput {
    role: MarketplaceApplicationRole;
    displayName: string;
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber?: string;
    businessType?: string;
    websiteUrl?: string;
    description: string;
    categories?: string[];
    operatingLocations?: string[];
    profileData?: Record<string, unknown>;
}

export interface ReviewRoleApplicationInput {
    id: ID;
    status: Extract<
        MarketplaceApplicationStatus,
        'UNDER_REVIEW' | 'CHANGES_REQUESTED' | 'REJECTED'
    >;
    reviewNote?: string;
}
