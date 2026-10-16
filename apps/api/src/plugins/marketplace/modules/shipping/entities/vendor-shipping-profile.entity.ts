import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplaceShippingMode } from '../shipping.constants';

export interface MarketplaceShippingZoneRule {
    id: string;
    name: string;
    cities: string[];
    provinces: string[];
    postalCodes: string[];
    rate: number;
    minDeliveryDays: number;
    maxDeliveryDays: number;
    enabled: boolean;
}

export interface MarketplaceDeliveryProfile {
    id: string;
    name: string;
    description?: string;
    enabled: boolean;
    mode: MarketplaceShippingMode;
    flatRate: number;
    fallbackEnabled: boolean;
    fallbackRate: number;
    processingDays: number;
    defaultMinDeliveryDays: number;
    defaultMaxDeliveryDays: number;
    zones: MarketplaceShippingZoneRule[];
}

@Entity()
export class VendorShippingProfile extends VendureEntity {
    constructor(input?: DeepPartial<VendorShippingProfile>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    vendorProfileId: string;

    @Column({ nullable: true })
    shippingMethodId?: string;

    @Column({ type: 'varchar', default: 'FLAT_RATE' })
    mode: MarketplaceShippingMode;

    @Column({ type: 'int', default: 35_000 })
    flatRate: number;

    @Column({ type: 'int', default: 35_000 })
    fallbackRate: number;

    @Column({ type: 'int', default: 1 })
    processingDays: number;

    @Column({ type: 'int', default: 3 })
    defaultMinDeliveryDays: number;

    @Column({ type: 'int', default: 5 })
    defaultMaxDeliveryDays: number;

    @Column({ type: 'simple-json', nullable: true })
    zones?: MarketplaceShippingZoneRule[];

    @Column({ nullable: true })
    defaultProfileId?: string;

    @Column({ type: 'simple-json', nullable: true })
    deliveryProfiles?: MarketplaceDeliveryProfile[];
}
