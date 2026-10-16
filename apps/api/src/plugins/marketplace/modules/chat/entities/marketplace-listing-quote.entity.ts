import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceListingQuoteStatus = 'SENT' | 'PAID' | 'SUPERSEDED' | 'CANCELLED' | 'EXPIRED';

export interface MarketplaceListingQuoteAddOn {
    name: string;
    included: string[];
    price: number;
}

@Entity()
export class MarketplaceListingQuote extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceListingQuote>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column()
    conversationId: string;

    @Index()
    @Column()
    productId: string;

    @Index()
    @Column()
    productVariantId: string;

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    customerUserId: string;

    @Index()
    @Column()
    vendorId: string;

    @Index()
    @Column()
    vendorOwnerUserId: string;

    @Column({ type: 'int' })
    amount: number;

    @Column({ default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'text', default: '' })
    description: string;

    @Column({ type: 'simple-json', nullable: true })
    addOns?: MarketplaceListingQuoteAddOn[];

    @Index()
    @Column({ type: 'varchar', default: 'SENT' })
    status: MarketplaceListingQuoteStatus;

    @Column({ type: 'datetime' })
    validUntil: Date;

    @Index()
    @Column({ nullable: true })
    orderId?: string;

    @Column({ nullable: true })
    orderCode?: string;
}
