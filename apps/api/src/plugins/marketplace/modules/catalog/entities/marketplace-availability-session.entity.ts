import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceAvailabilitySession extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceAvailabilitySession>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Column({ type: 'datetime' })
    startsAt: Date;

    @Column({ type: 'datetime' })
    endsAt: Date;

    @Column({ nullable: true })
    name?: string;

    @Index()
    @Column({ type: 'varchar', default: 'ONE_TIME' })
    scheduleType: 'ONE_TIME' | 'SUBSCRIPTION_CLASS';

    @Column({ type: 'simple-json', nullable: true })
    daysOfWeek?: string[];

    @Column({ nullable: true })
    startTime?: string;

    @Column({ nullable: true })
    endTime?: string;

    @Column({ type: 'int', nullable: true })
    price?: number;

    @Column({ type: 'int', nullable: true })
    oneDayPrice?: number;

    @Column({ type: 'int', nullable: true })
    earlyBirdPrice?: number;

    @Column({ type: 'datetime', nullable: true })
    earlyBirdEndsAt?: Date;

    @Column({ type: 'int', default: 5 })
    gracePeriodDays: number;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'int' })
    capacity: number;

    @Column({ type: 'int', default: 0 })
    bookedCount: number;

    @Column({ type: 'datetime', nullable: true })
    bookingDeadline?: Date;

    @Column({ nullable: true })
    recurrenceGroupId?: string;
}
