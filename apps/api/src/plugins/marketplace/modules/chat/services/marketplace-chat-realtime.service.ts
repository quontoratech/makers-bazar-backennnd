import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

import { MarketplaceChatConversation } from '../entities/marketplace-chat-conversation.entity';

@Injectable()
export class MarketplaceChatRealtimeService {
    private server?: Server;

    attach(server: Server) {
        this.server = server;
    }

    publishMessage(
        conversation: MarketplaceChatConversation,
        message: Record<string, unknown>,
    ) {
        if (!this.server) return;
        const payload = { conversationId: String(conversation.id), message };
        this.server.to([
            this.conversationRoom(String(conversation.id)),
            this.userRoom(conversation.customerUserId),
            this.userRoom(conversation.vendorOwnerUserId),
            this.adminRoom(),
        ]).emit('chat:message', payload);
        this.server.to([
            this.userRoom(conversation.customerUserId),
            this.userRoom(conversation.vendorOwnerUserId),
            this.adminRoom(),
        ]).emit('chat:conversation-updated', {
            conversationId: String(conversation.id),
            lastMessageAt: conversation.lastMessageAt,
            lastMessagePreview: conversation.lastMessagePreview,
            lastSenderRole: conversation.lastSenderRole,
        });
    }

    publishRead(conversationId: string, userId: string, role: string, readAt: Date) {
        this.server?.to(this.conversationRoom(conversationId)).emit('chat:read', {
            conversationId,
            userId,
            role,
            readAt,
        });
    }

    conversationRoom(conversationId: string) {
        return `chat:conversation:${conversationId}`;
    }

    userRoom(userId: string) {
        return `chat:user:${userId}`;
    }

    adminRoom() {
        return 'chat:admins';
    }
}
