import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceEventTicketType extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceEventTicketType>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Column()
    name: string;

    @Column({ type: 'int' })
    price: number;

    @Column({ type: 'int' })
    quantity: number;

    @Column({ type: 'int', default: 0 })
    soldCount: number;

    @Column({ type: 'datetime', nullable: true })
    saleStartsAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    saleEndsAt?: Date;

    @Column({ type: 'simple-json', nullable: true })
    rules?: Record<string, unknown>;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;
}
