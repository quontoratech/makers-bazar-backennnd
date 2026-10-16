import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceRewardRedemptionSettings extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceRewardRedemptionSettings>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ default: 'GLOBAL' })
    scopeKey: string;

    @Column({ default: true })
    enabled: boolean;

    @Column({ type: 'int', default: 100 })
    minimumWalletBalance: number;

    @Column({ type: 'int', default: 10 })
    coinsPerPkr: number;

    @Column({ nullable: true })
    updatedByUserId?: string;
}
