import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceCustomerDataRequestType = 'ACCESS' | 'CORRECTION' | 'EXPORT' | 'DELETION';
export type MarketplaceCustomerDataRequestStatus = 'SUBMITTED' | 'UNDER_REVIEW' | 'COMPLETED' | 'REJECTED';

@Entity()
@Index(['customerId', 'createdAt'])
export class MarketplaceCustomerDataRequest extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCustomerDataRequest>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column()
    customerId: string;

    @Column()
    customerUserId: string;

    @Column()
    customerEmail: string;

    @Index()
    @Column({ type: 'varchar' })
    type: MarketplaceCustomerDataRequestType;

    @Index()
    @Column({ type: 'varchar', default: 'SUBMITTED' })
    status: MarketplaceCustomerDataRequestStatus;

    @Column({ type: 'text' })
    requestNote: string;

    @Column({ type: 'simple-json', nullable: true })
    correction?: {
        firstName?: string;
        lastName?: string;
        phoneNumber?: string;
        emailAddress?: string;
    };

    @Column({ type: 'text', nullable: true })
    adminNote?: string;

    @Column()
    requestedByUserId: string;

    @Column({ nullable: true })
    handledByUserId?: string;

    @Column({ type: 'datetime' })
    dueAt: Date;

    @Column({ type: 'datetime', nullable: true })
    completedAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    exportGeneratedAt?: Date;

    @Column({ type: 'text', nullable: true })
    retentionReason?: string;
}
