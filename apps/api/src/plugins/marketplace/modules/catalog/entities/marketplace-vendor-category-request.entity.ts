import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplaceListingType } from './marketplace-form-template.entity';

export type MarketplaceVendorCategoryRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

@Entity()
export class MarketplaceVendorCategoryRequest extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceVendorCategoryRequest>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column()
    vendorProfileId: string;

    @Column()
    vendorName: string;

    @Index()
    @Column()
    requestedCategoryId: string;

    @Column()
    requestedCategoryCode: string;

    @Column()
    requestedCategoryName: string;

    @Column({ type: 'simple-json' })
    requestedCategoryBreadcrumb: string[];

    @Index()
    @Column({ type: 'varchar' })
    listingType: MarketplaceListingType;

    @Column({ type: 'simple-json', nullable: true })
    listingTypes?: MarketplaceListingType[];

    @Column({ type: 'text' })
    businessReason: string;

    @Column({ type: 'text' })
    experience: string;

    @Column({ type: 'text' })
    fulfilmentPlan: string;

    @Column({ type: 'simple-json', nullable: true })
    categoryData?: Record<string, unknown>;

    @Column({ type: 'simple-json', nullable: true })
    kycData?: Record<string, unknown>;

    @Column({ default: false })
    complianceConfirmed: boolean;

    @Index()
    @Column({ type: 'varchar', default: 'PENDING' })
    status: MarketplaceVendorCategoryRequestStatus;

    @Column()
    submittedByUserId: string;

    @Column()
    submittedAt: Date;

    @Column({ nullable: true })
    reviewedByUserId?: string;

    @Column({ type: 'text', nullable: true })
    adminNote?: string;

    @Column({ nullable: true })
    reviewedAt?: Date;
}
