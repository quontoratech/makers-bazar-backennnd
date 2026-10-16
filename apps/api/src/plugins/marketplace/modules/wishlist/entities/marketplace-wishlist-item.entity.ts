import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { MarketplaceWishlist } from './marketplace-wishlist.entity';

@Entity()
@Index(['wishlistId', 'itemType', 'referenceId'], { unique: true })
export class MarketplaceWishlistItem extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceWishlistItem>) {
        super(input);
    }

    @Index()
    @Column()
    wishlistId: string;

    @ManyToOne(() => MarketplaceWishlist, wishlist => wishlist.items, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'wishlistId' })
    wishlist: MarketplaceWishlist;

    @Column({ type: 'varchar' })
    itemType: 'PRODUCT' | 'SERVICE' | 'WORKSHOP' | 'VENDOR';

    @Column()
    referenceId: string;

    @Column()
    name: string;

    @Column()
    slug: string;

    @Column({ nullable: true })
    image?: string;

    @Column({ type: 'int', nullable: true })
    price?: number;

    @Column({ type: 'int', nullable: true })
    compareAtPrice?: number;

    @Column({ nullable: true })
    vendorName?: string;

    @Column({ nullable: true })
    vendorSlug?: string;

    @Column({ nullable: true })
    category?: string;

    @Column({ nullable: true })
    location?: string;
}
