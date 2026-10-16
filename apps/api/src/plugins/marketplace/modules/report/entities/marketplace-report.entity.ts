import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { MarketplaceReportEvidence } from './marketplace-report-evidence.entity';

@Entity()
export class MarketplaceReport extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceReport>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column()
    reportedByUserId: string;

    @Column()
    reporterName: string;

    @Column()
    reporterEmail: string;

    @Column()
    reporterPhone: string;

    @Column({ type: 'varchar' })
    targetType: 'SHOP' | 'LISTING' | 'USER' | 'SUSPICIOUS_ACTIVITY' | 'REVIEW';

    @Column({ nullable: true })
    reportedUserId?: string;

    @Column({ nullable: true })
    reportedUserName?: string;

    @Column({ nullable: true })
    reportedUserEmail?: string;

    @Column({ nullable: true })
    vendorProfileId?: string;

    @Column()
    vendorName: string;

    @Column({ nullable: true })
    productId?: string;

    @Column({ nullable: true })
    reviewId?: string;

    @Column({ nullable: true })
    listingName?: string;

    @Column({ nullable: true })
    reportedUrl?: string;

    @Column({ nullable: true })
    orderCode?: string;

    @Column({ type: 'text', nullable: true })
    orderDetails?: string;

    @Index()
    @Column()
    category: string;

    @Column()
    subject: string;

    @Column({ type: 'text' })
    description: string;

    @Index()
    @Column({ type: 'varchar', default: 'SUBMITTED' })
    status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'ACTION_REQUIRED' | 'ACTION_TAKEN' | 'RESOLVED' | 'DISMISSED';

    @Column({ nullable: true })
    supportConversationId?: string;

    @Column({ type: 'text', nullable: true })
    adminNote?: string;

    @Column({ type: 'text', nullable: true })
    actionTaken?: string;

    @Column({ nullable: true })
    enforcementActionId?: string;

    @Column({ nullable: true })
    enforcementActionType?: string;

    @Column({ type: 'datetime', nullable: true })
    enforcementEndsAt?: Date;

    @Column({ nullable: true })
    reviewedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    reviewedAt?: Date;

    @OneToMany(() => MarketplaceReportEvidence, evidence => evidence.report)
    evidence: MarketplaceReportEvidence[];
}
