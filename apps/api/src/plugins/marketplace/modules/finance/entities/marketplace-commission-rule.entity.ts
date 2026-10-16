import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceCommissionRuleScope = 'GLOBAL' | 'VENDOR' | 'CATEGORY' | 'CAMPAIGN';
export type MarketplaceCommissionRuleStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT';

@Entity()
export class MarketplaceCommissionRule extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCommissionRule>) {
        super(input);
    }

    @Column()
    name: string;

    @Index()
    @Column({ type: 'varchar' })
    scope: MarketplaceCommissionRuleScope;

    @Index()
    @Column({ nullable: true })
    targetId?: string;

    @Index()
    @Column({ nullable: true })
    targetCode?: string;

    @Column({ nullable: true })
    targetName?: string;

    @Column({ type: 'float', default: 0 })
    commissionPercent: number;

    @Column({ type: 'float', default: 0 })
    feePercent: number;

    @Column({ type: 'int', default: 0 })
    fixedFee: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'int', default: 0 })
    priority: number;

    @Index()
    @Column({ type: 'varchar', default: 'ACTIVE' })
    status: MarketplaceCommissionRuleStatus;

    @Column({ type: 'datetime', nullable: true })
    startsAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    endsAt?: Date;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'simple-json', nullable: true })
    metadata?: Record<string, string | number | boolean>;
}
