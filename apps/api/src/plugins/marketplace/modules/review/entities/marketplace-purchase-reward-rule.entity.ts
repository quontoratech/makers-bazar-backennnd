import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplacePurchaseRewardRuleScope = 'GLOBAL' | 'VENDOR' | 'CATEGORY';
export type MarketplacePurchaseRewardRuleStatus = 'ACTIVE' | 'PAUSED' | 'DRAFT';

@Entity()
export class MarketplacePurchaseRewardRule extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePurchaseRewardRule>) {
        super(input);
    }

    @Column()
    name: string;

    @Index()
    @Column({ type: 'varchar' })
    scope: MarketplacePurchaseRewardRuleScope;

    @Index()
    @Column({ nullable: true })
    targetId?: string;

    @Index()
    @Column({ nullable: true })
    targetCode?: string;

    @Column({ nullable: true })
    targetName?: string;

    @Column({ type: 'int', default: 0 })
    pointsPerUnit: number;

    @Column({ type: 'int', default: 0 })
    priority: number;

    @Index()
    @Column({ type: 'varchar', default: 'ACTIVE' })
    status: MarketplacePurchaseRewardRuleStatus;

    @Column({ type: 'datetime', nullable: true })
    startsAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    endsAt?: Date;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ nullable: true })
    updatedByUserId?: string;
}
