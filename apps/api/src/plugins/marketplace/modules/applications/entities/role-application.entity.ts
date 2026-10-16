import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceApplicationRole = 'VENDOR' | 'INFLUENCER' | 'ORGANIZER';
export type MarketplaceApplicationStatus =
    | 'PENDING'
    | 'UNDER_REVIEW'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'BLOCKED'
    | 'ACCOUNT_CREATED';

export interface MarketplaceApplicationHistoryEntry {
    status: MarketplaceApplicationStatus | 'UNBLOCKED';
    at: string;
    note?: string;
}

@Entity()
@Index(['role', 'emailAddress'])
export class RoleApplication extends VendureEntity {
    constructor(input?: DeepPartial<RoleApplication>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    reference: string;

    @Index()
    @Column({ type: 'varchar' })
    role: MarketplaceApplicationRole;

    @Column()
    displayName: string;

    @Column()
    firstName: string;

    @Column()
    lastName: string;

    @Index()
    @Column()
    emailAddress: string;

    @Column({ nullable: true })
    phoneNumber?: string;

    @Column({ nullable: true })
    businessType?: string;

    @Column({ nullable: true })
    websiteUrl?: string;

    @Column({ type: 'text' })
    description: string;

    @Column({ type: 'simple-json', nullable: true })
    categories?: string[];

    @Column({ type: 'simple-json', nullable: true })
    operatingLocations?: string[];

    @Column({ type: 'simple-json', nullable: true })
    profileData?: Record<string, unknown>;

    @Index()
    @Column({ type: 'varchar', default: 'PENDING' })
    status: MarketplaceApplicationStatus;

    @Column({ type: 'text', nullable: true })
    reviewNote?: string | null;

    @Column({ type: 'datetime', nullable: true })
    reviewedAt?: Date | null;

    @Column({ type: 'varchar', nullable: true })
    reviewedByUserId?: string | null;

    @Column({ type: 'datetime', nullable: true })
    blockedAt?: Date | null;

    @Column({ type: 'text', nullable: true })
    blockedReason?: string | null;

    @Column({ type: 'varchar', nullable: true })
    blockedByUserId?: string | null;

    @Column({ nullable: true })
    vendorProfileId?: string;

    @Column({ nullable: true })
    provisionedUserId?: string;

    @Column({ default: false })
    mustChangePassword: boolean;

    @Column({ type: 'simple-json', nullable: true })
    history?: MarketplaceApplicationHistoryEntry[];

    get rejectionCount(): number {
        return (this.history ?? []).filter(entry => entry.status === 'REJECTED').length;
    }
}
