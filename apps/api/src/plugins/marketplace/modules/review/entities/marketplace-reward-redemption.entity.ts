import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceRewardRedemptionStatus =
    | 'RESERVED'
    | 'APPLIED'
    | 'PARTIALLY_REVERSED'
    | 'REVERSED'
    | 'RELEASED';

export interface MarketplaceRewardRedemptionAllocation {
    sellerOrderId: string;
    sellerOrderCode: string;
    vendorId: string;
    vendorName: string;
    coins: number;
    amount: number;
    vendorGrossAmount: number;
    customerFundedAmount: number;
    reversedAt?: string;
}

@Entity()
export class MarketplaceRewardRedemption extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceRewardRedemption>) {
        super(input);
    }

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
    coins: number;

    @Column({ type: 'int' })
    amount: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Index()
    @Column({ type: 'varchar', default: 'RESERVED' })
    status: MarketplaceRewardRedemptionStatus;

    @Column({ type: 'datetime' })
    reservedAt: Date;

    @Column({ type: 'datetime', nullable: true })
    appliedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    reversedAt?: Date;

    @Column({ type: 'text', nullable: true })
    reversalReason?: string;

    @Column({ type: 'simple-json', nullable: true })
    allocations?: MarketplaceRewardRedemptionAllocation[];
}
