import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { BookingStatus } from '../../../types';

@Entity()
export class MarketplaceBooking extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceBooking>) {
        super(input);
    }

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    vendorProfileId: string;

    @Column({ nullable: true })
    orderId?: string;

    @Column()
    productVariantId: string;

    @Index()
    @Column({ nullable: true })
    availabilitySessionId?: string;

    @Index()
    @Column({ nullable: true })
    eventTicketTypeId?: string;

    @Column({ type: 'varchar' })
    bookingType: 'SERVICE' | 'WORKSHOP' | 'EXPERIENCE' | 'TICKET';

    @Column()
    title: string;

    @Column({ type: 'datetime' })
    startsAt: Date;

    @Column({ type: 'datetime' })
    endsAt: Date;

    @Column({ type: 'int', default: 1 })
    quantity: number;

    @Column({ type: 'int', nullable: true })
    capacity?: number;

    @Column({ type: 'varchar', default: 'PENDING' })
    status: BookingStatus;

    @Index()
    @Column({ type: 'varchar', default: 'ONE_TIME' })
    billingModel: 'ONE_TIME' | 'MONTHLY';

    @Column({ type: 'datetime', nullable: true })
    paidAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    renewalReminderSentAt?: Date | null;

    @Index()
    @Column({ type: 'varchar', default: 'UNPAID' })
    paymentStatus: 'UNPAID' | 'PAID' | 'GRACE' | 'TERMINATED';

    @Column({ type: 'int', nullable: true })
    agreedPrice?: number;

    @Column({ nullable: true })
    subscriptionClassName?: string;

    @Index({ unique: true })
    @Column({ type: 'varchar', nullable: true })
    renewalToken?: string | null;

    @Column({ type: 'datetime', nullable: true })
    graceEndsAt?: Date | null;

    @Column({ nullable: true })
    lastRenewalOrderId?: string;

    @Column({ type: 'datetime', nullable: true })
    cancellationRequestedAt?: Date | null;

    @Column({ type: 'datetime', nullable: true })
    cancelledAt?: Date;

    @Column({ nullable: true })
    customerName?: string;

    @Column({ nullable: true })
    customerEmail?: string;

    @Column({ type: 'simple-json', nullable: true })
    attendeeDetails?: Array<Record<string, string>>;

    @Column({ type: 'text', nullable: true })
    customerNote?: string;

    @Column({ type: 'text', nullable: true })
    internalNote?: string;

    @Column({ nullable: true })
    secureAccessReference?: string;
}
