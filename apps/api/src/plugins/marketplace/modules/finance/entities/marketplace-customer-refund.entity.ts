import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import type { MarketplaceReturnSelectionItem } from '../../support/return-policy';

export type MarketplaceCustomerRefundStatus = 'UNPAID' | 'PAID' | 'REJECTED';
export type MarketplaceCustomerRefundScope = 'FULL_WITH_DELIVERY' | 'PRODUCT_ONLY';
export type MarketplaceCustomerRefundMethod = 'BANK_TRANSFER' | 'EASYPAISA' | 'JAZZCASH';

@Entity()
export class MarketplaceCustomerRefund extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCustomerRefund>) {
        super(input);
    }

    @Index()
    @Column()
    sellerOrderId: string;

    /** One refund per appeal, while a seller order can have several disjoint partial appeals. */
    @Index({ unique: true })
    @Column({ nullable: true })
    supportCaseId?: string;

    @Column({ type: 'simple-json', nullable: true })
    returnItems?: MarketplaceReturnSelectionItem[];

    @Index()
    @Column()
    sellerOrderCode: string;

    @Index()
    @Column()
    customerOrderId: string;

    @Index()
    @Column()
    customerOrderCode: string;

    @Index()
    @Column()
    customerId: string;

    @Column()
    customerName: string;

    @Column()
    customerEmail: string;

    @Index()
    @Column()
    vendorId: string;

    @Column()
    vendorName: string;

    @Column({ type: 'varchar' })
    orderStatus: 'CANCELLED' | 'REJECTED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';

    @Column({ type: 'varchar' })
    refundScope: MarketplaceCustomerRefundScope;

    @Column({ type: 'int' })
    productAmount: number;

    @Column({ type: 'int' })
    customerPaidProductAmount: number;

    @Column({ type: 'int', default: 0 })
    deliveryAmount: number;

    @Column({ type: 'int', default: 0 })
    marketplaceFundingAmount: number;

    @Column({ type: 'int', default: 0 })
    rewardCoins: number;

    @Column({ nullable: true })
    couponCode?: string;

    @Column({ type: 'int', default: 0 })
    couponDiscountAmount: number;

    @Column({ nullable: true })
    couponFundingSource?: 'MARKETPLACE' | 'VENDOR';

    @Column({ type: 'int' })
    cashAmount: number;

    @Column({ type: 'int' })
    grossAmount: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Index()
    @Column({ type: 'varchar', default: 'UNPAID' })
    status: MarketplaceCustomerRefundStatus;

    @Column({ type: 'varchar' })
    method: MarketplaceCustomerRefundMethod;

    @Column()
    accountHolderName: string;

    @Column({ nullable: true })
    bankName?: string;

    @Column()
    accountIdentifier: string;

    @Column({ type: 'text' })
    reason: string;

    @Column()
    requestedByUserId: string;

    @Column({ nullable: true })
    paidByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    paidAt?: Date;

    @Column({ nullable: true })
    transactionReference?: string;

    @Column({ nullable: true })
    rejectedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    rejectedAt?: Date;

    @Column({ type: 'text', nullable: true })
    decisionNote?: string;
}
