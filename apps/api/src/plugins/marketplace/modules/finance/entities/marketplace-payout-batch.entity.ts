import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplacePayoutBatchStatus =
    | 'PENDING_APPROVAL'
    | 'APPROVED'
    | 'PROCESSING'
    | 'PAID'
    | 'PARTIALLY_PAID'
    | 'FAILED'
    | 'CANCELLED';

@Entity()
export class MarketplacePayoutBatch extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePayoutBatch>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column({ type: 'varchar', default: 'PENDING_APPROVAL' })
    status: MarketplacePayoutBatchStatus;

    @Column({ type: 'int', default: 0 })
    totalAmount: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'simple-json', nullable: true })
    vendorIds?: string[];

    @Column({ type: 'simple-json', nullable: true })
    payoutEntryIds?: string[];

    @Column({ nullable: true })
    createdByUserId?: string;

    @Column({ nullable: true })
    approvedByUserId?: string;

    @Column({ nullable: true })
    processedByUserId?: string;

    @Column({ type: 'datetime', nullable: true })
    approvedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    processedAt?: Date;

    @Column({ nullable: true })
    externalReference?: string;

    @Column({ type: 'text', nullable: true })
    note?: string;

    @Column({ type: 'text', nullable: true })
    failureReason?: string;

    @Column({ type: 'simple-json', nullable: true })
    metadata?: Record<string, string | number | boolean>;
}
