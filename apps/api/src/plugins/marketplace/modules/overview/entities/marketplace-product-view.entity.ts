import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index(['productId', 'sessionId', 'viewedOn'], { unique: true })
export class MarketplaceProductView extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceProductView>) {
        super(input);
    }

    @Index()
    @Column()
    vendorProfileId: string;

    @Index()
    @Column()
    productId: string;

    @Column({ length: 100 })
    sessionId: string;

    @Column({ length: 10 })
    viewedOn: string;
}
