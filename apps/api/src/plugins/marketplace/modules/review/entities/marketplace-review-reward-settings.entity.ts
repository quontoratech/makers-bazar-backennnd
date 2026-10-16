import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceReviewRewardSettings extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceReviewRewardSettings>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ default: 'GLOBAL' })
    scopeKey: string;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: 'int', default: 1 })
    productReviewPoints: number;

    @Column({ type: 'int', default: 2 })
    imageBonusPoints: number;

    @Column({ type: 'int', default: 2 })
    videoBonusPoints: number;

    @Column({ type: 'int', default: 1 })
    vendorReviewPoints: number;

    @Column({ nullable: true })
    updatedByUserId?: string;
}
