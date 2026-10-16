import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceArticle extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceArticle>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    slug: string;

    @Column()
    title: string;

    @Column({ type: 'text' })
    excerpt: string;

    @Column({ type: 'text' })
    body: string;

    @Column({ nullable: true })
    authorAdministratorId?: string;

    @Column({ nullable: true })
    featuredAssetId?: string;

    @Column({ type: 'varchar', default: 'DRAFT' })
    status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';

    @Column({ type: 'datetime', nullable: true })
    publishedAt?: Date;

    @Column({ type: 'simple-json', nullable: true })
    tags?: string[];

    @Column({ type: 'simple-json', nullable: true })
    relations?: Array<{ entityType: string; entityId: string }>;

    @Column({ type: 'simple-json', nullable: true })
    seo?: { title?: string; description?: string; socialAssetId?: string };
}
