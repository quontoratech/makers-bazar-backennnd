import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, OneToMany } from 'typeorm';

import { MarketplaceReviewMedia } from './marketplace-review-media.entity';

export type MarketplaceReviewTargetType = 'PRODUCT' | 'VENDOR' | 'SERVICE' | 'WORKSHOP' | 'DELIVERY';

@Entity()
@Index(['customerUserId', 'orderId', 'targetType', 'productId', 'vendorProfileId'])
export class MarketplaceReview extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceReview>) {
        super(input);
    }

    @Index()
    @Column()
    customerUserId: string;

    @Index()
    @Column()
    customerId: string;

    @Column()
    customerName: string;

    @Index()
    @Column()
    orderId: string;

    @Column()
    orderCode: string;

    @Index()
    @Column()
    targetType: MarketplaceReviewTargetType;

    @Index()
    @Column({ nullable: true })
    productId?: string;

    @Column({ nullable: true })
    productSlug?: string;

    @Column({ nullable: true })
    productName?: string;

    @Column({ nullable: true })
    variantId?: string;

    @Column({ nullable: true })
    variantName?: string;

    @Index()
    @Column({ nullable: true })
    vendorProfileId?: string;

    @Column({ nullable: true })
    vendorName?: string;

    @Column({ nullable: true })
    vendorSlug?: string;

    @Column({ type: 'int' })
    rating: number;

    @Column({ nullable: true })
    title?: string;

    @Column({ type: 'text', nullable: true })
    body?: string;

    @Column({ type: 'varchar', default: 'PUBLISHED' })
    status: 'PUBLISHED' | 'HIDDEN';

    @Column({ default: true })
    verified: boolean;

    @Column({ type: 'text', nullable: true })
    vendorResponse?: string;

    @Column({ nullable: true })
    vendorResponseByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    vendorResponseCreatedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    vendorResponseUpdatedAt?: Date;

    @Column({ type: 'text', nullable: true })
    moderationReason?: string;

    @Column({ nullable: true })
    moderatedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    moderatedAt?: Date;

    @OneToMany(() => MarketplaceReviewMedia, media => media.review)
    media?: MarketplaceReviewMedia[];
}
