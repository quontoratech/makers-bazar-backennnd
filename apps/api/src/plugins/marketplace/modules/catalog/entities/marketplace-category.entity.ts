import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index(['parentId', 'slug'], { unique: true })
export class MarketplaceCategory extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCategory>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    code: string;

    @Column()
    slug: string;

    @Column()
    name: string;

    @Index()
    @Column({ nullable: true })
    parentId?: string;

    @Column({ type: 'text', default: '' })
    description: string;

    @Column({ nullable: true })
    icon?: string;

    @Column({ nullable: true })
    imageAssetId?: string;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @Index()
    @Column({ default: true })
    isActive: boolean;

    @Index()
    @Column({ default: false })
    chatEnabled: boolean;

    @Index()
    @Column({ nullable: true })
    formTemplateId?: string;
}
