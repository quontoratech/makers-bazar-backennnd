import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplacePromotionRequestStatus =
    | 'PENDING_REVIEW'
    | 'PENDING_PAYMENT'
    | 'PAYMENT_SUBMITTED'
    | 'PAYMENT_VERIFIED'
    | 'APPROVED'
    | 'REJECTED'
    | 'CANCELLED'
    | 'EXPIRED';

export type MarketplacePromotionPaymentStatus = 'UNPAID' | 'SUBMITTED' | 'VERIFIED' | 'REJECTED';

@Entity()
@Index(['status', 'startsAt', 'endsAt'])
@Index(['placement', 'categoryCode', 'startsAt', 'endsAt'])
@Index(['vendorProfileId', 'status'])
export class MarketplacePromotionRequest extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePromotionRequest>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column({ nullable: true })
    productId?: string;

    @Column({ type: 'varchar', default: 'PRODUCT' })
    targetType: 'PRODUCT' | 'VENDOR_CATEGORY';

    @Column()
    productName: string;

    @Column()
    productSlug: string;

    @Index()
    @Column()
    vendorProfileId: string;

    @Column()
    vendorName: string;

    @Column({ nullable: true })
    categoryId?: string;

    @Index()
    @Column()
    categoryCode: string;

    @Column()
    categoryName: string;

    @Column({ type: 'varchar' })
    placement: 'HOME' | 'CATEGORY' | 'BOTH';

    @Column({ nullable: true })
    campaignId?: string;

    @Column({ nullable: true })
    campaignCode?: string;

    @Column({ type: 'datetime' })
    startsAt: Date;

    @Column({ type: 'datetime' })
    endsAt: Date;

    @Column({ type: 'int' })
    durationDays: number;

    @Column({ type: 'int' })
    pricePerDay: number;

    @Column({ type: 'int' })
    amount: number;

    @Column({ type: 'varchar', length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'varchar' })
    rateScope: string;

    @Column({ type: 'varchar', default: 'PENDING_REVIEW' })
    status: MarketplacePromotionRequestStatus;

    @Column({ type: 'varchar', default: 'UNPAID' })
    paymentStatus: MarketplacePromotionPaymentStatus;

    @Index({ unique: true })
    @Column({ nullable: true })
    paymentReference?: string;

    @Column({ type: 'text', nullable: true })
    paymentNote?: string;

    @Column({ type: 'text', nullable: true })
    adminNote?: string;

    @Column({ type: 'datetime' })
    submittedAt: Date;

    @Column({ type: 'datetime', nullable: true })
    reviewedAt?: Date;

    @Column({ nullable: true })
    reviewedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    paymentDueAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    paymentSubmittedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    paymentVerifiedAt?: Date;

    @Column({ nullable: true })
    paymentVerifiedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    approvedAt?: Date;

    @Column({ type: 'int', default: 0 })
    priority: number;
}
