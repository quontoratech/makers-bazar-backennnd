import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceCartReservationStatus = 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';

export interface MarketplaceCartStockAllocation {
    stockLocationId: string;
    quantity: number;
}

@Entity()
@Index(['cartToken', 'channelId', 'productVariantId'], { unique: true })
export class MarketplaceCartReservation extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCartReservation>) {
        super(input);
    }

    @Index()
    @Column()
    cartToken: string;

    @Index()
    @Column()
    channelId: string;

    @Index()
    @Column()
    productVariantId: string;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'simple-json' })
    allocations: MarketplaceCartStockAllocation[];

    @Index()
    @Column({ type: 'varchar', default: 'ACTIVE' })
    status: MarketplaceCartReservationStatus;

    @Index()
    @Column()
    expiresAt: Date;

    @Column({ nullable: true })
    releasedAt?: Date;
}
