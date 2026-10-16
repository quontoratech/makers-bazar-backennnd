import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceDigitalFileScanStatus = 'PENDING' | 'CLEAN' | 'REJECTED' | 'UNAVAILABLE';
export type MarketplaceDigitalFileIntegrityStatus = 'PENDING' | 'VALID' | 'INVALID' | 'UNAVAILABLE';

@Entity()
export class MarketplaceDigitalFile extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceDigitalFile>) {
        super(input);
    }

    @Index()
    @Column()
    productId: string;

    @Column({ type: 'varchar', default: 'MAIN' })
    kind: 'MAIN' | 'PREVIEW' | 'LICENSE_DOCUMENT';

    @Column()
    fileName: string;

    @Column()
    storageKey: string;

    @Column()
    mimeType: string;

    @Column({ type: 'int' })
    sizeBytes: number;

    @Column({ nullable: true })
    checksum?: string;

    @Column({ default: true })
    isPrivate: boolean;

    @Index()
    @Column({ type: 'varchar', default: 'PENDING' })
    scanStatus: MarketplaceDigitalFileScanStatus;

    @Column({ type: 'varchar', default: 'PENDING' })
    integrityStatus: MarketplaceDigitalFileIntegrityStatus;

    @Column({ type: 'int', nullable: true })
    downloadLimit?: number;

    @Column({ type: 'datetime', nullable: true })
    expiresAt?: Date;

    @Column({ type: 'simple-json', nullable: true })
    metadata?: Record<string, unknown>;
}
