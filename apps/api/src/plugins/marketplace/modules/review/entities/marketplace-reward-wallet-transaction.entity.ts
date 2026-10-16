import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplaceReviewRewardComponent } from './marketplace-review-reward-grant.entity';

export type MarketplaceRewardTransactionType = 'CREDIT' | 'REVERSAL' | 'DEBIT';

@Entity()
export class MarketplaceRewardWalletTransaction extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceRewardWalletTransaction>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    eventKey: string;

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    customerUserId: string;

    @Column()
    customerName: string;

    @Index()
    @Column()
    reviewId: string;

    @Column()
    orderCode: string;

    @Column()
    reviewTargetType: string;

    @Column({ type: 'varchar' })
    component: MarketplaceReviewRewardComponent;

    @Column({ type: 'varchar' })
    type: MarketplaceRewardTransactionType;

    @Column({ type: 'int' })
    points: number;

    @Column()
    reason: string;

    @Index()
    @Column()
    grantId: string;
}
