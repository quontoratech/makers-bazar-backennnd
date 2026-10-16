import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';
import { MarketplaceReturnSelectionItem } from '../return-policy';

@Entity()
export class SupportCase extends VendureEntity {
    constructor(input?: DeepPartial<SupportCase>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Index()
    @Column()
    openedByUserId: string;

    @Column({ nullable: true })
    assignedAdministratorId?: string;

    @Column({ nullable: true })
    vendorProfileId?: string;

    @Column({ nullable: true })
    orderId?: string;

    @Index()
    @Column({ nullable: true })
    sellerOrderId?: string;

    /** Purchased line IDs and quantities selected when the customer opened the appeal. */
    @Column({ type: 'simple-json', nullable: true })
    returnItems?: MarketplaceReturnSelectionItem[];

    @Column({ nullable: true })
    sellerOrderStatusBeforeReturn?: 'DELIVERED' | 'FULFILLED';

    @Column({ type: 'int', nullable: true })
    returnWindowDays?: number;

    @Column({ type: process.env.DB === 'postgres' ? 'timestamp' : 'datetime', nullable: true })
    returnDeadlineAt?: Date;

    @Column({ type: 'boolean', nullable: true })
    returnRequired?: boolean;

    @Column({ nullable: true })
    refundId?: string;

    @Column({ nullable: true })
    refundStatus?: string;

    @Column()
    category: string;

    @Column()
    subject: string;

    @Column({ type: 'varchar', default: 'NORMAL' })
    priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

    @Column({ type: 'varchar', default: 'OPEN' })
    status: 'OPEN' | 'WAITING_FOR_CUSTOMER' | 'WAITING_FOR_VENDOR' | 'ESCALATED' | 'RESOLVED' | 'CLOSED'
        | 'RETURN_APPROVED' | 'RETURN_REJECTED' | 'RETURN_RECEIVED' | 'REFUND_PENDING' | 'REFUNDED';

    @Column({ type: 'simple-json', nullable: true })
    messages?: Array<{
        authorId: string;
        authorRole: string;
        body: string;
        createdAt: string;
        assetIds?: string[];
    }>;

    /** Administrator/vendor discussion is never exposed by the Shop API. */
    @Column({ type: 'simple-json', nullable: true })
    internalMessages?: Array<{
        authorId: string;
        authorRole: string;
        body: string;
        createdAt: string;
    }>;

    @Column({ type: 'text', nullable: true })
    decision?: string;

    @Column({ type: 'int', nullable: true })
    financialAdjustment?: number;

    @Column({ type: 'datetime', nullable: true })
    resolvedAt?: Date;
}
