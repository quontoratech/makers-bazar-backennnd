import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { MarketplaceVendorAppeal } from './marketplace-vendor-appeal.entity';

@Entity()
export class MarketplaceVendorAppealEvidence extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceVendorAppealEvidence>) {
        super(input);
    }

    @Index()
    @Column()
    uploadedByUserId: string;

    @Index()
    @Column()
    vendorProfileId: string;

    @Index()
    @Column({ nullable: true })
    appealId?: string;

    @ManyToOne(() => MarketplaceVendorAppeal, appeal => appeal.evidence, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'appealId' })
    appeal?: MarketplaceVendorAppeal;

    @Column()
    assetId: string;

    @Column()
    name: string;

    @Column()
    preview: string;

    @Column()
    mimeType: string;
}
