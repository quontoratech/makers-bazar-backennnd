import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceServicePackage extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceServicePackage>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Column({ type: 'varchar', default: 'PACKAGE' })
    kind: 'PACKAGE' | 'ADD_ON';

    @Column()
    name: string;

    @Column({ type: 'text', nullable: true })
    description?: string;

    @Column({ type: 'simple-json', nullable: true })
    inclusions?: string[];

    @Column({ type: 'int', default: 0 })
    price: number;

    @Column({ type: 'int', nullable: true })
    durationMinutes?: number;

    @Column({ type: 'int', default: 0 })
    sortOrder: number;
}
