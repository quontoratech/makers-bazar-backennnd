import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

@Entity()
@Index(['conversationId', 'messageId'])
export class MarketplaceChatAttachment extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceChatAttachment>) {
        super(input);
    }

    @Index()
    @Column()
    conversationId: string;

    @Index()
    @Column({ nullable: true })
    messageId?: string;

    @Index()
    @Column()
    uploadedByUserId: string;

    @Column()
    name: string;

    @Column()
    mimeType: string;

    @Column({ type: 'integer' })
    size: number;

    @Index({ unique: true })
    @Column()
    storageKey: string;

    @Column()
    checksum: string;
}
