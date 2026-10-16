import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplaceDynamicFieldType } from './marketplace-form-template.entity';

export type MarketplaceCategoryFieldOverrideMode = 'REPLACE' | 'HIDE';

@Entity()
@Index(['categoryId', 'fieldKey'], { unique: true })
export class MarketplaceCategoryField extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceCategoryField>) {
        super(input);
    }

    @Index()
    @Column()
    categoryId: string;

    @Column()
    fieldKey: string;

    @Column()
    label: string;

    @Column({ type: 'varchar' })
    inputType: MarketplaceDynamicFieldType;

    @Column({ default: false })
    required: boolean;

    @Column({ default: 'Details' })
    section: string;

    @Column({ type: 'text', nullable: true })
    helpText?: string;

    @Column({ nullable: true })
    placeholder?: string;

    @Column({ nullable: true })
    unit?: string;

    @Column({ type: 'simple-json', nullable: true })
    options?: string[];

    @Column({ type: 'simple-json', nullable: true })
    validation?: Record<string, unknown>;

    @Column({ type: 'simple-json', nullable: true })
    ui?: Record<string, unknown>;

    @Column({ type: 'simple-json', nullable: true })
    condition?: Record<string, unknown>;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'varchar', default: 'REPLACE' })
    overrideMode: MarketplaceCategoryFieldOverrideMode;
}
