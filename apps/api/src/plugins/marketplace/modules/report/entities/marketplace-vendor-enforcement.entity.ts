import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceVendorEnforcementType = 'WARNING' | 'RESTRICTION' | 'PERMANENT_REMOVAL';
export type MarketplaceVendorEnforcementStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

@Entity()
@Index(['vendorProfileId', 'createdAt'])
export class MarketplaceVendorEnforcement extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceVendorEnforcement>) {
        super(input);
    }

    @Index()
    @Column()
    vendorProfileId: string;

    @Index()
    @Column()
    reportId: string;

    @Column()
    reportCode: string;

    @Column({ type: 'varchar' })
    type: MarketplaceVendorEnforcementType;

    @Column({ type: 'varchar', default: 'ACTIVE' })
    status: MarketplaceVendorEnforcementStatus;

    @Column({ type: 'text' })
    message: string;

    @Column({ type: 'int', nullable: true })
    durationDays?: number;

    @Column({ type: 'datetime' })
    startsAt: Date;

    @Column({ type: 'datetime', nullable: true })
    endsAt?: Date;

    @Column()
    createdByUserId: string;

    @Column({ type: 'datetime', nullable: true })
    acknowledgedAt?: Date;
}
