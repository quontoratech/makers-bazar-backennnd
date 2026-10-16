import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { MarketplaceReview } from './marketplace-review.entity';

@Entity()
export class MarketplaceReviewMedia extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceReviewMedia>) {
        super(input);
    }

    @Index()
    @Column()
    uploadedByUserId: string;

    @Index()
    @Column({ nullable: true })
    reviewId?: string;

    @ManyToOne(() => MarketplaceReview, review => review.media, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'reviewId' })
    review?: MarketplaceReview;

    @Column()
    assetId: string;

    @Column()
    name: string;

    @Column()
    preview: string;

    @Column()
    source: string;

    @Column()
    mimeType: string;

    @Column()
    mediaType: 'IMAGE' | 'VIDEO';
}
