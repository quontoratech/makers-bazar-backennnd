import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplacePromotionSettings extends VendureEntity {
    constructor(input?: DeepPartial<MarketplacePromotionSettings>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ default: 'default' })
    key: string;

    @Column({ type: 'int', default: 3 })
    homeSlots: number;

    @Column({ type: 'int', default: 3 })
    categorySlots: number;

    @Column({ type: 'int', default: 48 })
    paymentWindowHours: number;

    @Column({ type: 'text', default: '' })
    paymentInstructions: string;
}
