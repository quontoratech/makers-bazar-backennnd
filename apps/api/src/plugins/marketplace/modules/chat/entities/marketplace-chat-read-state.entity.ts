import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplaceChatSenderRole } from './marketplace-chat-conversation.entity';

@Entity()
@Index(['conversationId', 'userId'], { unique: true })
export class MarketplaceChatReadState extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceChatReadState>) {
        super(input);
    }

    @Index()
    @Column()
    conversationId: string;

    @Index()
    @Column()
    userId: string;

    @Column({ type: 'varchar' })
    role: MarketplaceChatSenderRole;

    @Column({ type: 'datetime' })
    lastReadAt: Date;
}
