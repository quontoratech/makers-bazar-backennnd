import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index(['productId', 'categoryId'], { unique: true })
export class MarketplaceListingCategory extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceListingCategory>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Index()
    @Column()
    categoryId: string;

    @Column({ default: false })
    isPrimary: boolean;
}
