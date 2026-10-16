import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceCustomerConsentType = 'TERMS' | 'PRIVACY' | 'MARKETING';

@Entity()
@Index(['customerId', 'type', 'recordedAt'])
export class MarketplaceCustomerConsentRecord extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCustomerConsentRecord>) {
        super(input);
    }

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    userId: string;

    @Column({ type: 'varchar' })
    type: MarketplaceCustomerConsentType;

    @Column()
    granted: boolean;

    @Column({ default: '1.0' })
    version: string;

    @Column({ default: 'CUSTOMER_REGISTRATION' })
    source: string;

    @Column({ type: 'datetime' })
    recordedAt: Date;
}
