import { Controller, Headers, HttpException, Post, Req } from '@nestjs/common';
import { Logger, RequestContextService, TransactionalConnection } from '@vendure/core';
import type { Request } from 'express';
import { PromotionCardGateway } from '../services/promotion-card-gateway.service';
import { PromotionService } from '../services/promotion.service';

@Controller('marketplace-promotions')
export class PromotionPaymentController {
    constructor(
        private gateway: PromotionCardGateway,
        private promotions: PromotionService,
        private contexts: RequestContextService,
        private connection: TransactionalConnection,
    ) {}

    @Post('stripe-webhook')
    async webhook(@Req() request: Request, @Headers('stripe-signature') signature?: string) {
        if (!this.gateway.configured) throw new HttpException('Card payments are not configured', 503);
        if (!signature || !Buffer.isBuffer(request.body))
            throw new HttpException('Invalid payment notification', 400);
        let event;
        try {
            event = this.gateway.event(request.body, signature);
        } catch {
            throw new HttpException('Invalid payment signature', 400);
        }
        try {
            const ctx = await this.contexts.create({ apiType: 'admin' });
            await this.connection.withTransaction(ctx, transaction =>
                this.promotions.handleCardEvent(transaction, event),
            );
        } catch (error) {
            Logger.error(`Payment notification ${event.id} could not be processed`, 'PromotionPayments');
            throw new HttpException('Payment notification processing failed; retry required', 500);
        }
        return { received: true };
    }
}
