import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type PromotionPaymentStatus =
    | 'CHECKOUT_OPEN'
    | 'SUBMITTED'
    | 'VERIFIED'
    | 'REJECTED'
    | 'EXPIRED'
    | 'REFUNDED';

@Entity()
export class MarketplacePromotionPayment extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePromotionPayment>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    key: string;

    @Index()
    @Column()
    requestId: string;

    @Index()
    @Column()
    vendorProfileId: string;

    @Column({ type: 'varchar' })
    method: 'CARD' | 'MANUAL';

    @Column({ type: 'varchar' })
    status: PromotionPaymentStatus;

    @Column({ type: 'int' })
    amount: number;

    @Column({ type: 'int', default: 0 })
    refundedAmount: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Index({ unique: true })
    @Column({ nullable: true })
    reference?: string;

    @Index({ unique: true })
    @Column({ nullable: true })
    checkoutSessionId?: string;

    @Column({ nullable: true })
    cardBrand?: string;

    @Column({ nullable: true, length: 4 })
    cardLast4?: string;

    @Column({ type: 'text', nullable: true })
    note?: string;

    @Index()
    @Column({ type: 'datetime', nullable: true })
    verifiedAt?: Date;

    @Column({ nullable: true })
    verifiedByUserId?: string;
}
