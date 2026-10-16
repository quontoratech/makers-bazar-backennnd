import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { MarketplaceWishlistItem } from './marketplace-wishlist-item.entity';

@Entity()
export class MarketplaceWishlist extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceWishlist>) {
        super(input);
    }

    @Index()
    @Column()
    ownerUserId: string;

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'varchar', default: 'PRIVATE' })
    visibility: 'PUBLIC' | 'PRIVATE';

    @Column({ default: false })
    shareEnabled: boolean;

    @Index({ unique: true })
    @Column({ nullable: true })
    shareToken?: string;

    @Column({ nullable: true })
    shareAccessKey?: string;

    @OneToMany(() => MarketplaceWishlistItem, item => item.wishlist)
    items: MarketplaceWishlistItem[];
}
