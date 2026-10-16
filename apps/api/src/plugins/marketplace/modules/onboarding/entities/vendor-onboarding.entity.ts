import type { Answers } from '@marketplace/contracts/onboarding';
import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class VendorOnboarding extends VendureEntity {
    constructor(input?: DeepPartial<VendorOnboarding>) {
        super(input);
    }
    @Index({ unique: true }) @Column() ownerUserId: string;
    @Index() @Column() emailAddress: string;
    @Column({ default: '' }) storeName: string;
    @Column({ default: '' }) city: string;
    @Column({ default: '' }) businessType: string;
    @Column({ default: 1 }) version: number;
    @Column({ default: 0 }) currentStep: number;
    @Column({ type: 'simple-json' }) sections: Record<string, Answers>;
    @Column({ nullable: true }) applicationId?: string;
    @Column({ nullable: true }) firstProductId?: string;
}

@Entity()
@Index(['onboardingId', 'fieldKey'])
export class VendorOnboardingFile extends VendureEntity {
    constructor(input?: DeepPartial<VendorOnboardingFile>) {
        super(input);
    }
    @Column() onboardingId: string;
    @Column() fieldKey: string;
    @Column() name: string;
    @Column() mimeType: string;
    @Column() size: number;
    @Column() checksum: string;
    @Column() storageKey: string;
    @Column({ default: 'UNAVAILABLE' }) scanStatus: string;
}
