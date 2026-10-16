import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class MarketplaceVendorCategoryRequestDocument extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceVendorCategoryRequestDocument>) {
        super(input);
    }

    @Index()
    @Column()
    uploadedByUserId: string;

    @Index()
    @Column({ nullable: true })
    requestId?: string;

    @Column()
    assetId: string;

    @Column()
    name: string;

    @Column()
    preview: string;

    @Column()
    source: string;

    @Column()
    mimeType: string;

    @Column({ default: 'SUPPORTING_DOCUMENT' })
    documentType: string;

    @Column({ default: 'supportingDocuments' })
    fieldKey: string;

    @Column({ nullable: true })
    expiresAt?: Date;
}
