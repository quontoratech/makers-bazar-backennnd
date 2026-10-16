import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { VendorApplicationStatus } from '../../../types';
import { MarketplaceVendorServiceArea } from '../vendor-location';
import {
    getMarketplaceVendorAvailability,
    MarketplaceVendorUnavailableDate,
    MarketplaceVendorWeeklyHours,
} from '../vendor-availability';

export interface MarketplaceVendorPayoutAccount {
    method: 'BANK_TRANSFER' | 'EASYPAISA' | 'JAZZCASH';
    accountHolderName: string;
    bankName?: string;
    accountIdentifier: string;
    verificationStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
    submittedAt: string;
    verifiedAt?: string;
    verifiedByUserId?: string;
    verificationNote?: string;
}

@Entity()
export class VendorProfile extends VendureEntity {
    constructor(input?: DeepPartial<VendorProfile>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    slug: string;

    @Column()
    shopName: string;

    @Column()
    ownerFirstName: string;

    @Column()
    ownerLastName: string;

    @Index()
    @Column()
    ownerEmailAddress: string;

    @Column({ nullable: true })
    contactEmail?: string;

    @Column({ nullable: true })
    phoneNumber?: string;

    @Column({ nullable: true })
    businessType?: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ nullable: true })
    featuredProductId?: string;

    @Column({ nullable: true })
    logoAssetId?: string;

    @Column({ type: 'text', nullable: true })
    logoUrl?: string;

    @Column({ nullable: true })
    bannerAssetId?: string;

    @Column({ type: 'text', nullable: true })
    bannerUrl?: string;

    @Column({ type: 'varchar', default: 'PENDING' })
    status: VendorApplicationStatus;

    @Column({ nullable: true })
    sellerId?: string;

    @Column({ nullable: true })
    channelId?: string;

    @Column({ nullable: true })
    ownerUserId?: string;

    @Column({ type: 'simple-json', nullable: true })
    categories?: string[];

    @Column({ type: 'simple-json', nullable: true })
    operatingLocations?: string[];

    @Column({ type: 'simple-json', nullable: true })
    serviceAreas?: MarketplaceVendorServiceArea[];

    @Column({ type: 'simple-json', nullable: true })
    documentReferences?: Array<{ type: string; assetId: string; expiresAt?: string }>;

    @Column({ type: 'simple-json', nullable: true })
    policies?: Record<string, string>;

    @Column({ type: 'float', default: 10 })
    commissionPercent: number;

    @Column({ default: 'MONTHLY' })
    payoutSchedule: string;

    @Column({ type: 'simple-json', nullable: true })
    payoutAccount?: MarketplaceVendorPayoutAccount;

    @Column({ type: 'int', default: 100 })
    healthScore: number;

    @Column({ default: false })
    verified: boolean;

    @Column({ default: false })
    paused: boolean;

    @Column({ default: false })
    availabilityPaused: boolean;

    @Column({ type: 'text', nullable: true })
    availabilityPauseReason?: string;

    @Column({ type: 'varchar', default: 'Asia/Karachi' })
    availabilityTimezone: string;

    @Column({ type: 'simple-json', nullable: true })
    weeklyHours?: MarketplaceVendorWeeklyHours[];

    @Column({ type: 'simple-json', nullable: true })
    unavailableDates?: MarketplaceVendorUnavailableDate[];

    @Column({ default: false })
    holidayModeEnabled: boolean;

    @Column({ type: 'varchar', default: 'ACTIVE' })
    enforcementStatus: 'ACTIVE' | 'RESTRICTED' | 'REMOVED';

    @Column({ type: 'datetime', nullable: true })
    restrictedUntil?: Date;

    @Column({ type: 'text', nullable: true })
    enforcementReason?: string;

    @Column({ default: false })
    restrictionPreviousPaused: boolean;

    @Column({ type: 'int', default: 0 })
    warningCount: number;

    @Column({ type: 'datetime', nullable: true })
    removedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    holidayStartsAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    holidayEndsAt?: Date;

    @Column({ type: 'text', nullable: true })
    holidayReason?: string;

    @Column({ type: 'text', nullable: true })
    reviewNote?: string;

    get availability() {
        return getMarketplaceVendorAvailability(this);
    }
}
