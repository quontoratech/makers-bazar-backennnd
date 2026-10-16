import { ID } from '@vendure/core';

import { VendorApplicationStatus } from '../../../types';
import { MarketplaceVendorServiceArea } from '../vendor-location';
import { MarketplaceVendorUnavailableDate, MarketplaceVendorWeeklyHours } from '../vendor-availability';

export interface RegisterVendorInput {
    shopName: string;
    slug?: string;
    ownerFirstName: string;
    ownerLastName: string;
    ownerEmailAddress: string;
    phoneNumber?: string;
    businessType?: string;
    description?: string;
    categories?: string[];
    operatingLocations?: string[];
}

export interface ReviewVendorInput {
    id: ID;
    status: Extract<
        VendorApplicationStatus,
        'CHANGES_REQUESTED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED'
    >;
    reviewNote: string;
    commissionPercent?: number;
    payoutSchedule?: string;
}

export interface ProvisionVendorInput {
    vendorProfileId: ID;
    temporaryPassword: string;
}

export interface UpdateVendorStorefrontInput {
    description?: string | null;
    featuredProductId?: string | null;
    logoAssetId?: string | null;
    logoUrl?: string | null;
    bannerAssetId?: string | null;
    bannerUrl?: string | null;
    contactEmail?: string | null;
    phoneNumber?: string | null;
    policies?: Record<string, unknown> | null;
    serviceAreas?: MarketplaceVendorServiceArea[] | null;
    availabilityPaused?: boolean;
    availabilityPauseReason?: string | null;
    availabilityTimezone?: string;
    weeklyHours?: MarketplaceVendorWeeklyHours[] | null;
    unavailableDates?: MarketplaceVendorUnavailableDate[] | null;
    holidayModeEnabled?: boolean;
    holidayStartsAt?: Date | string | null;
    holidayEndsAt?: Date | string | null;
    holidayReason?: string | null;
}
