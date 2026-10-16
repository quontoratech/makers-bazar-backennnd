import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplacePurchaseRewardRuleScope } from './marketplace-purchase-reward-rule.entity';

@Entity()
@Index(['orderId', 'orderLineId'], { unique: true })
export class MarketplacePurchaseRewardGrant extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePurchaseRewardGrant>) {
        super(input);
    }

    @Index()
    @Column()
    orderId: string;

    @Column()
    orderCode: string;

    @Column()
    sellerOrderCode: string;

    @Column()
    orderLineId: string;

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
    productId: string;

    @Column()
    productName: string;

    @Index()
    @Column({ nullable: true })
    vendorId?: string;

    @Column({ nullable: true })
    vendorName?: string;

    @Index()
    @Column({ nullable: true })
    categoryId?: string;

    @Column({ nullable: true })
    categoryCode?: string;

    @Column({ nullable: true })
    categoryName?: string;

    @Index()
    @Column()
    ruleId: string;

    @Column()
    ruleName: string;

    @Column({ type: 'varchar' })
    ruleScope: MarketplacePurchaseRewardRuleScope;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int' })
    pointsPerUnit: number;

    @Column({ type: 'int' })
    points: number;

    @Column({ default: true })
    active: boolean;

    @Column()
    awardedAt: Date;

    @Column({ nullable: true })
    reversedAt?: Date;
}
