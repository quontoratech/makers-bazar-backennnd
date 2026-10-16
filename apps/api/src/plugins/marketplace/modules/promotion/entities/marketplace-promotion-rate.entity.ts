import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplacePromotionRateScope = 'GLOBAL' | 'VENDOR' | 'CATEGORY' | 'VENDOR_CATEGORY' | 'CAMPAIGN';

export type MarketplacePromotionPlacement = 'HOME' | 'CATEGORY' | 'BOTH';

@Entity()
@Index(['scope', 'placement'])
@Index(['vendorProfileId', 'categoryId', 'campaignId'])
export class MarketplacePromotionRate extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePromotionRate>) {
        super(input);
    }

    @Column({ type: 'varchar' })
    scope: MarketplacePromotionRateScope;

    @Column({ type: 'varchar', default: 'BOTH' })
    placement: MarketplacePromotionPlacement;

    @Index()
    @Column({ nullable: true })
    vendorProfileId?: string;

    @Index()
    @Column({ nullable: true })
    categoryId?: string;

    @Column({ nullable: true })
    categoryCode?: string;

    @Index()
    @Column({ nullable: true })
    campaignId?: string;

    @Column({ type: 'int' })
    pricePerDay: number;

    @Column({ type: 'varchar', length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ default: true })
    active: boolean;

    @Column({ type: 'text', nullable: true })
    note?: string;
}
