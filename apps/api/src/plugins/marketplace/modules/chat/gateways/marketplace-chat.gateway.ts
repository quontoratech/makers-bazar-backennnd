import { Logger } from '@nestjs/common';
import {
    ConnectedSocket,
    MessageBody,
    OnGatewayConnection,
    OnGatewayInit,
    SubscribeMessage,
    WebSocketGateway,
    WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { SendMarketplaceChatMessageInput } from '../dto/marketplace-chat.inputs';
import { MarketplaceChatPrincipal, MarketplaceChatService } from '../services/marketplace-chat.service';
import { MarketplaceChatRealtimeService } from '../services/marketplace-chat-realtime.service';

const allowedOrigins = (process.env.WEB_ORIGIN ?? 'http://localhost:3001')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);

interface AuthenticatedChatSocket extends Socket {
    data: { principal?: MarketplaceChatPrincipal };
}

@WebSocketGateway({
    namespace: '/marketplace-chat',
    cors: { origin: allowedOrigins, credentials: true },
    transports: ['websocket', 'polling'],
})
export class MarketplaceChatGateway implements OnGatewayInit, OnGatewayConnection {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(MarketplaceChatGateway.name);

    constructor(
        private chatService: MarketplaceChatService,
        private realtime: MarketplaceChatRealtimeService,
    ) {}

    afterInit(server: Server) {
        this.realtime.attach(server);
    }

    async handleConnection(socket: AuthenticatedChatSocket) {
        try {
            const principal = this.chatService.verifySocketTicket(socket.handshake.auth?.ticket);
            await this.chatService.validateSocketPrincipal(principal);
            socket.data.principal = principal;
            await socket.join(this.realtime.userRoom(principal.userId));
            if (principal.role === 'ADMIN' || principal.role === 'SUPER_ADMIN') {
                await socket.join(this.realtime.adminRoom());
            }
            socket.emit('chat:ready', { userId: principal.userId, role: principal.role });
        } catch (error) {
            socket.emit('chat:error', { message: this.errorMessage(error) });
            socket.disconnect(true);
        }
    }

    @SubscribeMessage('chat:list')
    async list(
        @ConnectedSocket() socket: AuthenticatedChatSocket,
        @MessageBody() body: { term?: string; status?: string; take?: number },
    ) {
        try {
            return { ok: true, data: await this.chatService.listForSocket(this.principal(socket), body) };
        } catch (error) {
            return { ok: false, message: this.errorMessage(error) };
        }
    }

    @SubscribeMessage('chat:join')
    async join(
        @ConnectedSocket() socket: AuthenticatedChatSocket,
        @MessageBody() body: { conversationId?: string },
    ) {
        try {
            const conversationId = String(body?.conversationId ?? '');
            const principal = this.principal(socket);
            const conversation = await this.chatService.getForSocket(principal, conversationId);
            await socket.join(this.realtime.conversationRoom(conversationId));
            await this.chatService.markReadForSocket(principal, conversationId);
            return { ok: true, data: conversation };
        } catch (error) {
            return { ok: false, message: this.errorMessage(error) };
        }
    }

    @SubscribeMessage('chat:leave')
    async leave(
        @ConnectedSocket() socket: AuthenticatedChatSocket,
        @MessageBody() body: { conversationId?: string },
    ) {
        const conversationId = String(body?.conversationId ?? '');
        if (conversationId) await socket.leave(this.realtime.conversationRoom(conversationId));
        return { ok: true };
    }

    @SubscribeMessage('chat:send')
    async send(
        @ConnectedSocket() socket: AuthenticatedChatSocket,
        @MessageBody() input: SendMarketplaceChatMessageInput,
    ) {
        try {
            return { ok: true, data: await this.chatService.sendForSocket(this.principal(socket), input) };
        } catch (error) {
            return { ok: false, message: this.errorMessage(error) };
        }
    }

    @SubscribeMessage('chat:read')
    async read(
        @ConnectedSocket() socket: AuthenticatedChatSocket,
        @MessageBody() body: { conversationId?: string },
    ) {
        try {
            return {
                ok: true,
                data: await this.chatService.markReadForSocket(
                    this.principal(socket),
                    String(body?.conversationId ?? ''),
                ),
            };
        } catch (error) {
            return { ok: false, message: this.errorMessage(error) };
        }
    }

    private principal(socket: AuthenticatedChatSocket) {
        if (!socket.data.principal) throw new Error('Chat connection is not authenticated');
        return socket.data.principal;
    }

    private errorMessage(error: unknown) {
        const message = error instanceof Error ? error.message : 'Unable to complete the chat request';
        this.logger.debug(message);
        return message;
    }
}
