import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index(['fileId', 'customerId', 'orderId'])
export class MarketplaceDigitalDownloadGrant extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceDigitalDownloadGrant>) {
        super(input);
    }

    @Index()
    @Column()
    fileId: string;

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    orderId: string;

    @Index({ unique: true })
    @Column()
    tokenHash: string;

    @Index()
    @Column({ type: 'datetime' })
    expiresAt: Date;

    @Column({ type: 'datetime', nullable: true })
    consumedAt?: Date;
}
