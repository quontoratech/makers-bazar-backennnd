import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';

import { MarketplaceReport } from './marketplace-report.entity';

@Entity()
export class MarketplaceReportEvidence extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceReportEvidence>) {
        super(input);
    }

    @Index()
    @Column()
    uploadedByUserId: string;

    @Index()
    @Column({ nullable: true })
    reportId?: string;

    @ManyToOne(() => MarketplaceReport, report => report.evidence, { nullable: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'reportId' })
    report?: MarketplaceReport;

    @Column()
    assetId: string;

    @Column()
    name: string;

    @Column()
    preview: string;

    @Column()
    mimeType: string;
}
