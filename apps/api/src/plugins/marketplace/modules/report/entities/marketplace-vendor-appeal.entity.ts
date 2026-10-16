import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { MarketplaceVendorAppealEvidence } from './marketplace-vendor-appeal-evidence.entity';

@Entity()
export class MarketplaceVendorAppeal extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceVendorAppeal>) {
        super(input);
    }

    @Index()
    @Column()
    vendorProfileId: string;

    @Index({ unique: true })
    @Column()
    enforcementId: string;

    @Column()
    reportCode: string;

    @Column()
    vendorName: string;

    @Column({ type: 'text' })
    statement: string;

    @Index()
    @Column({ type: 'varchar', default: 'SUBMITTED' })
    status: 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';

    @Column()
    submittedByUserId: string;

    @Column({ type: 'text', nullable: true })
    adminNote?: string;

    @Column({ nullable: true })
    supportConversationId?: string;

    @Column({ nullable: true })
    reviewedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    reviewedAt?: Date;

    @OneToMany(() => MarketplaceVendorAppealEvidence, evidence => evidence.appeal)
    evidence: MarketplaceVendorAppealEvidence[];
}
