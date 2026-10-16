import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class PromotionCampaign extends VendureEntity {
    constructor(input?: DeepPartial<PromotionCampaign>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Column({ type: 'varchar' })
    ownerType: 'PLATFORM' | 'VENDOR' | 'COMMERCIAL_BRAND';

    @Column({ type: 'varchar', nullable: true })
    ownerId?: string | null;

    @Column({ type: 'varchar' })
    campaignType: 'PLACEMENT' | 'AFFILIATE' | 'EVENT' | 'COLLECTION' | 'LOYALTY';

    @Column()
    title: string;

    @Column({ type: 'text', nullable: true })
    description?: string | null;

    @Column()
    placement: string;

    @Column({ type: 'int', default: 0 })
    budget: number;

    @Column({ type: 'int', default: 3 })
    maxPlacements: number;

    @Column({ type: 'varchar', default: 'DRAFT' })
    status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'REJECTED';

    @Column({ type: 'datetime' })
    startsAt: Date;

    @Column({ type: 'datetime' })
    endsAt: Date;

    @Column({ type: 'simple-json', nullable: true })
    target?: Record<string, string | string[]> | null;

    @Column({ type: 'simple-json', nullable: true })
    creative?: Record<string, string> | null;

    @Column({ type: 'simple-json', nullable: true })
    metrics?: Record<string, number> | null;
}
