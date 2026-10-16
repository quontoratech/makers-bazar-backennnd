import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceCouponScope = 'GLOBAL' | 'VENDOR' | 'CATEGORY' | 'CAMPAIGN';
export type MarketplaceCouponDiscountType = 'PERCENTAGE' | 'FIXED';
export type MarketplaceCouponFundingSource = 'MARKETPLACE' | 'VENDOR';
export type MarketplaceCouponStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type MarketplaceCouponPurpose = 'PROMOTION' | 'REWARD';
export type MarketplaceCouponRewardRecipientType = 'INFLUENCER' | 'VENDOR';

@Entity()
export class MarketplaceCoupon extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCoupon>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Index()
    @Column({ type: 'varchar', default: 'PROMOTION' })
    purpose: MarketplaceCouponPurpose;

    @Index()
    @Column({ type: 'varchar', nullable: true })
    rewardRecipientType?: MarketplaceCouponRewardRecipientType;

    @Index()
    @Column({ nullable: true })
    rewardRecipientId?: string;

    @Column({ nullable: true })
    rewardRecipientCode?: string;

    @Column({ nullable: true })
    rewardRecipientName?: string;

    @Index()
    @Column({ type: 'varchar' })
    scope: MarketplaceCouponScope;

    @Column({ nullable: true })
    targetId?: string;

    @Column({ nullable: true })
    targetCode?: string;

    @Column({ nullable: true })
    targetName?: string;

    @Column({ type: 'varchar' })
    discountType: MarketplaceCouponDiscountType;

    /** Human percentage (5 = 5%) or fixed minor currency units. */
    @Column({ type: 'float' })
    discountValue: number;

    @Column({ type: 'int', nullable: true })
    maximumDiscount?: number;

    @Column({ type: 'int', default: 0 })
    minimumSpend: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'varchar', default: 'MARKETPLACE' })
    fundingSource: MarketplaceCouponFundingSource;

    @Column({ type: 'int', nullable: true })
    totalUsageLimit?: number;

    @Column({ type: 'int', default: 1 })
    perCustomerUsageLimit: number;

    @Index()
    @Column({ type: 'varchar', default: 'DRAFT' })
    status: MarketplaceCouponStatus;

    @Column({ type: 'datetime', nullable: true })
    startsAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    endsAt?: Date;

    @Column({ nullable: true })
    createdByUserId?: string;

    @Column({ nullable: true })
    updatedByUserId?: string;
}
