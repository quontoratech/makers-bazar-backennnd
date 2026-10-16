import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
export class PayoutLedgerEntry extends VendureEntity {
    constructor(input?: DeepPartial<PayoutLedgerEntry>) {
        super(input);
    }

    @Index()
    @Column({ type: 'varchar' })
    beneficiaryType: 'VENDOR' | 'AFFILIATE';

    @Index()
    @Column()
    beneficiaryId: string;

    @Column({ nullable: true })
    orderId?: string;

    @Column({ type: 'varchar' })
    kind: 'SALE' | 'COMMISSION' | 'PAYMENT_FEE' | 'DELIVERY_ADJUSTMENT' | 'REFUND' | 'TAX' | 'PENALTY' | 'ADJUSTMENT' | 'PAYOUT' | 'REWARD_FUNDING' | 'COUPON_FUNDING' | 'COUPON_DISCOUNT';

    @Column({ type: 'int' })
    amount: number;

    @Column({ length: 3, default: 'PKR' })
    currencyCode: string;

    @Column({ type: 'varchar', default: 'PENDING' })
    status: 'PENDING' | 'ON_HOLD' | 'AVAILABLE' | 'APPROVED' | 'PAID' | 'FAILED' | 'REVERSED';

    @Column({ type: 'datetime', nullable: true })
    availableAt?: Date;

    @Column({ nullable: true })
    externalReference?: string;

    @Column({ type: 'text', nullable: true })
    reason?: string;

    @Column({ type: 'simple-json', nullable: true })
    metadata?: Record<string, string | number | boolean>;
}
