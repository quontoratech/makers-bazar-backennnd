import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class EmailVerificationChallenge extends VendureEntity {
    constructor(input?: DeepPartial<EmailVerificationChallenge>) {
        super(input);
    }

    @Index({ unique: true })
    @Column()
    emailAddress: string;

    @Column()
    codeHash: string;

    @Column()
    verificationToken: string;

    @Column({ type: 'datetime' })
    expiresAt: Date;

    @Column({ type: 'datetime' })
    lastSentAt: Date;

    @Column({ type: 'int', default: 0 })
    attemptCount: number;

    @Column({ type: 'datetime', nullable: true })
    consumedAt?: Date;
}
