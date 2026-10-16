import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity } from 'typeorm';

export type MarketplacePayoutSchedule = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'MANUAL';

@Entity()
export class MarketplacePayoutSettings extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePayoutSettings>) {
        super(input);
    }

    @Column({ type: 'int', default: 7 })
    holdingPeriodDays: number;

    @Column({ type: 'float', default: 0 })
    reservePercent: number;

    @Column({ type: 'int', default: 0 })
    minimumPayoutThreshold: number;

    @Column({ type: 'varchar', default: 'MONTHLY' })
    payoutSchedule: MarketplacePayoutSchedule;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ default: false })
    requireSeparateApproval: boolean;

    @Column({ type: 'simple-json', nullable: true })
    adjustmentRules?: Record<string, string | number | boolean>;
}
