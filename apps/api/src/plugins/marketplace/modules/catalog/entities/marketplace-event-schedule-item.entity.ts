import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceEventScheduleItem extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceEventScheduleItem>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Column()
    name: string;

    @Column({ type: 'datetime' })
    startsAt: Date;

    @Column({ type: 'datetime' })
    endsAt: Date;

    @Column({ nullable: true })
    personName?: string;

    @Column({ nullable: true })
    location?: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;
}
