import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import {
    MarketplaceCouponFundingSource,
    MarketplaceCouponPurpose,
    MarketplaceCouponRewardRecipientType,
    MarketplaceCouponScope,
} from './marketplace-coupon.entity';

export type MarketplaceCouponRedemptionStatus =
    | 'RESERVED'
    | 'APPLIED'
    | 'PARTIALLY_REVERSED'
    | 'REVERSED'
    | 'RELEASED';

export interface MarketplaceCouponLineAllocation {
    productId: string;
    variantId: string;
    amount: number;
}

export interface MarketplaceCouponAllocation {
    sellerOrderId: string;
    sellerOrderCode: string;
    vendorId: string;
    vendorName: string;
    amount: number;
    vendorGrossAmount: number;
    customerFundedAmount: number;
    lineAllocations: MarketplaceCouponLineAllocation[];
    reversedAt?: string;
}

export interface MarketplaceCouponRuleSnapshot {
    couponId: string;
    code: string;
    name: string;
    purpose?: MarketplaceCouponPurpose;
    rewardRecipientType?: MarketplaceCouponRewardRecipientType;
    rewardRecipientId?: string;
    rewardRecipientCode?: string;
    rewardRecipientName?: string;
    scope: MarketplaceCouponScope;
    targetId?: string;
    targetCode?: string;
    targetName?: string;
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    maximumDiscount?: number;
    minimumSpend: number;
    fundingSource: MarketplaceCouponFundingSource;
    campaignTarget?: Record<string, string | string[]>;
    campaignOwnerType?: string;
    campaignOwnerId?: string;
    categoryIds?: string[];
}

@Entity()
export class MarketplaceCouponRedemption extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCouponRedemption>) {
        super(input);
    }

    @Index()
    @Column()
    couponId: string;

    @Index()
    @Column()
    couponCode: string;

    @Index({ unique: true })
    @Column()
    orderId: string;

    @Index()
    @Column()
    orderCode: string;

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    customerUserId: string;

    @Column()
    customerName: string;

    @Column({ type: 'int' })
    eligibleSubtotal: number;

    @Column({ type: 'int' })
    amount: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'varchar' })
    fundingSource: MarketplaceCouponFundingSource;

    @Index()
    @Column({ type: 'varchar', default: 'RESERVED' })
    status: MarketplaceCouponRedemptionStatus;

    @Column({ type: 'datetime' })
    reservedAt: Date;

    @Column({ type: 'datetime', nullable: true })
    appliedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    reversedAt?: Date;

    @Column({ type: 'text', nullable: true })
    reversalReason?: string;

    @Column({ type: 'simple-json' })
    ruleSnapshot: MarketplaceCouponRuleSnapshot;

    @Column({ type: 'simple-json', nullable: true })
    allocations?: MarketplaceCouponAllocation[];
}
