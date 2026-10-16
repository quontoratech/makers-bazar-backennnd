import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index(['productId', 'fieldKey'], { unique: true })
export class MarketplaceListingFieldValue extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceListingFieldValue>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Column()
    fieldKey: string;

    @Column({ type: 'simple-json' })
    value: unknown;

    @Column({ type: 'int', default: 1 })
    schemaVersion: number;
}
