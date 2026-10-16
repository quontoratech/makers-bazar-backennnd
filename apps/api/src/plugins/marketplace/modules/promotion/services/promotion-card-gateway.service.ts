import { Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import type { MarketplacePromotionRequest } from '../entities/marketplace-promotion-request.entity';

@Injectable()
export class PromotionCardGateway {
    get configured() {
        return Boolean(
            process.env.PROMOTION_STRIPE_SECRET_KEY && process.env.PROMOTION_STRIPE_WEBHOOK_SECRET,
        );
    }

    private client() {
        if (!this.configured)
            throw new Error(
                'Card payments are not configured. Contact marketplace finance or use bank transfer.',
            );
        return new Stripe(process.env.PROMOTION_STRIPE_SECRET_KEY!, {
            maxNetworkRetries: 2,
            timeout: 15_000,
        });
    }

    async create(request: MarketplacePromotionRequest, key: string) {
        const origin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:3001').origin;
        if (process.env.APP_ENV === 'production' && !origin.startsWith('https://'))
            throw new Error('Card payment return URLs require HTTPS in production');
        const now = Math.floor(Date.now() / 1000);
        const expires = Math.min(now + 86_400, Math.floor(request.paymentDueAt!.getTime() / 1000));
        if (expires < now + 1800)
            throw new Error(
                'Less than 30 minutes remain to pay. Ask marketplace finance to extend the payment window.',
            );
        return this.client().checkout.sessions.create(
            {
                mode: 'payment',
                payment_method_types: ['card'],
                client_reference_id: String(request.id),
                metadata: {
                    promotionRequestId: String(request.id),
                    vendorProfileId: request.vendorProfileId,
                    paymentKey: key,
                },
                payment_intent_data: {
                    metadata: { promotionRequestId: String(request.id), paymentKey: key },
                },
                line_items: [
                    {
                        quantity: 1,
                        price_data: {
                            currency: request.currencyCode.toLowerCase(),
                            unit_amount: request.amount,
                            product_data: {
                                name: `Promotion: ${request.productName}`.slice(0, 250),
                                description: `${request.code} | ${request.durationDays} days | ${request.placement}`,
                            },
                        },
                    },
                ],
                success_url: `${origin}/dashboard/vendor/promotions?payment_session={CHECKOUT_SESSION_ID}`,
                cancel_url: `${origin}/dashboard/vendor/promotions?payment_cancelled=1`,
                expires_at: expires,
            },
            { idempotencyKey: key },
        );
    }

    retrieve(id: string) {
        return this.client().checkout.sessions.retrieve(id, { expand: ['payment_intent.latest_charge'] });
    }

    expire(id: string) {
        return this.client().checkout.sessions.expire(id);
    }

    event(body: Buffer, signature: string) {
        return this.client().webhooks.constructEvent(
            body,
            signature,
            process.env.PROMOTION_STRIPE_WEBHOOK_SECRET!,
        );
    }

    charge(id: string) {
        return this.client().charges.retrieve(id);
    }
}
