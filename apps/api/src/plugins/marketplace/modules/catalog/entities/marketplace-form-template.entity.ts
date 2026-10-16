import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceListingType =
    | 'PHYSICAL_PRODUCT'
    | 'ARTISAN_PRODUCT'
    | 'FOOD_PRODUCT'
    | 'DIGITAL_PRODUCT'
    | 'SERVICE'
    | 'WORKSHOP_EXPERIENCE'
    | 'EVENT';

export type MarketplaceDynamicFieldType =
    | 'TEXT'
    | 'TEXTAREA'
    | 'NUMBER'
    | 'DECIMAL'
    | 'CURRENCY'
    | 'SELECT'
    | 'MULTI_SELECT'
    | 'CHECKBOX'
    | 'RADIO'
    | 'BOOLEAN'
    | 'DATE'
    | 'TIME'
    | 'DATETIME'
    | 'IMAGE'
    | 'MULTIPLE_IMAGES'
    | 'FILE'
    | 'MULTIPLE_FILES'
    | 'VIDEO'
    | 'RICH_TEXT'
    | 'ADDRESS'
    | 'COORDINATES'
    | 'REPEATER'
    | 'VARIANT_BUILDER';

export interface MarketplaceDynamicFieldDefinition {
    key: string;
    label: string;
    type: MarketplaceDynamicFieldType;
    required?: boolean;
    section?: string;
    helpText?: string;
    placeholder?: string;
    unit?: string;
    options?: string[];
    validation?: Record<string, unknown>;
    ui?: Record<string, unknown>;
    condition?: Record<string, unknown>;
    sortOrder?: number;
}

@Entity()
export class MarketplaceFormTemplate extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceFormTemplate>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    key: string;

    @Column()
    name: string;

    @Index()
    @Column({ type: 'varchar' })
    listingType: MarketplaceListingType;

    @Column({ type: 'int', default: 1 })
    version: number;

    @Index()
    @Column({ default: true })
    isActive: boolean;

    @Column({ type: 'simple-json' })
    schema: MarketplaceDynamicFieldDefinition[];
}
