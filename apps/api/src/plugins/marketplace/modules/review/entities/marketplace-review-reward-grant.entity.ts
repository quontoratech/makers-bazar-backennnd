import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceReviewRewardComponent =
    | 'PRODUCT_REVIEW'
    | 'IMAGE_BONUS'
    | 'VIDEO_BONUS'
    | 'VENDOR_REVIEW'
    | 'PURCHASE_REWARD'
    | 'REWARD_REDEMPTION';

@Entity()
@Index(['reviewId', 'component'], { unique: true })
export class MarketplaceReviewRewardGrant extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceReviewRewardGrant>) {
        super(input);
    }

    @Index()
    @Column()
    reviewId: string;

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    customerUserId: string;

    @Column({ type: 'varchar' })
    component: MarketplaceReviewRewardComponent;

    @Column({ type: 'int' })
    points: number;

    @Column({ default: true })
    active: boolean;

    @Column()
    awardedAt: Date;

    @Column({ nullable: true })
    reversedAt?: Date;
}
