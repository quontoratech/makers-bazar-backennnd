import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

export type MarketplaceChatConversationStatus = 'OPEN' | 'CLOSED';
export type MarketplaceChatSenderRole = 'CUSTOMER' | 'VENDOR' | 'ADMIN' | 'SUPER_ADMIN';
export type MarketplaceChatConversationType = 'ORDER' | 'LISTING_INQUIRY' | 'CUSTOMER_APPEAL' | 'VENDOR_APPEAL';

@Entity()
export class MarketplaceChatConversation extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceChatConversation>) {
        super(input);
    }

    @Index({ unique: true })
    @Column({ nullable: true })
    sellerOrderId?: string;

    @Index()
    @Column({ nullable: true })
    sellerOrderCode?: string;

    @Index()
    @Column({ nullable: true })
    customerOrderId?: string;

    @Index()
    @Column({ nullable: true })
    customerOrderCode?: string;

    @Index()
    @Column()
    customerId: string;

    @Index()
    @Column()
    customerUserId: string;

    @Column()
    customerName: string;

    @Column()
    customerEmail: string;

    @Index()
    @Column()
    vendorId: string;

    @Index()
    @Column()
    vendorOwnerUserId: string;

    @Column()
    vendorName: string;

    @Index()
    @Column({ type: 'varchar', default: 'OPEN' })
    status: MarketplaceChatConversationStatus;

    @Index()
    @Column({ type: 'varchar', default: 'ORDER' })
    conversationType: MarketplaceChatConversationType;

    @Index()
    @Column({ nullable: true })
    sourceId?: string;

    @Column({ nullable: true })
    sourceCode?: string;

    @Column({ type: 'datetime', nullable: true })
    closeAt?: Date;

    @Column({ type: 'datetime', nullable: true })
    closedAt?: Date;

    @Column({ nullable: true })
    closedReason?: string;

    @Column({ type: 'datetime' })
    lastMessageAt: Date;

    @Column({ type: 'text' })
    lastMessagePreview: string;

    @Column({ type: 'varchar' })
    lastSenderRole: MarketplaceChatSenderRole;
}
