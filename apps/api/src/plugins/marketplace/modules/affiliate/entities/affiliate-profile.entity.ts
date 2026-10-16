import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class AffiliateProfile extends VendureEntity {
    constructor(input?: DeepPartial<AffiliateProfile>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    customerId: string;

    @Index({ unique: true })
    @Column()
    slug: string;

    @Index({ unique: true })
    @Column()
    referralCode: string;

    @Column()
    displayName: string;

    @Column({ type: 'text', nullable: true })
    bio?: string;

    @Column({ type: 'varchar', default: 'PENDING' })
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

    @Column({ type: 'simple-json', nullable: true })
    channels?: Array<{ platform: string; url: string; audience?: number }>;

    @Column({ type: 'float', default: 5 })
    commissionPercent: number;

    @Column({ type: 'int', default: 0 })
    attributedOrderCount: number;

    @Column({ type: 'int', default: 0 })
    availableBalance: number;

    @Column({ type: 'simple-json', nullable: true })
    payoutAccount?: Record<string, string>;
}
