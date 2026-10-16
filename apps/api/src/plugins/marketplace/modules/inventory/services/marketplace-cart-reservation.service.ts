import { Injectable } from '@nestjs/common';
import { GlobalFlag } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    GlobalSettingsService,
    Order,
    OrderService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    StockLevelService,
    StockLocationService,
    StockMovementService,
    TransactionalConnection,
} from '@vendure/core';
import { In, LessThan } from 'typeorm';

import {
    MarketplaceCartReservation,
    MarketplaceCartStockAllocation,
} from '../entities/marketplace-cart-reservation.entity';

interface CartReservationInput {
    cartToken: string;
    variantId: string;
    quantity: number;
}

const DEFAULT_CART_RESERVATION_MINUTES = 30;

@Injectable()
export class MarketplaceCartReservationService {
    constructor(
        private connection: TransactionalConnection,
        private productVariantService: ProductVariantService,
        private stockLevelService: StockLevelService,
        private stockLocationService: StockLocationService,
        private globalSettingsService: GlobalSettingsService,
        private orderService: OrderService,
        private stockMovementService: StockMovementService,
    ) {}

    async reserve(ctx: RequestContext, rawInput: CartReservationInput) {
        const input = this.validateInput(rawInput);
        const repository = this.connection.getRepository(ctx, MarketplaceCartReservation);
        let reservation = await repository.findOne({
            where: {
                cartToken: input.cartToken,
                channelId: String(ctx.channelId),
                productVariantId: input.variantId,
            },
        });

        if (reservation?.status === 'ACTIVE' && reservation.expiresAt.getTime() <= Date.now()) {
            await this.releaseReservation(ctx, reservation, 'EXPIRED');
            reservation.status = 'EXPIRED';
            reservation.allocations = [];
        }

        const variant = await this.productVariantService.findOne(ctx, input.variantId, ['product']);
        if (!variant || !variant.enabled || variant.product?.enabled === false) {
            throw new Error('This product variant is not available');
        }
        const maxOrderQuantity = this.positiveInteger(
            (variant.customFields as Record<string, unknown> | undefined)?.maxOrderQuantity,
        );
        if (maxOrderQuantity && input.quantity > maxOrderQuantity) {
            throw new Error(`${variant.name} is limited to ${maxOrderQuantity} per order`);
        }

        const currentQuantity = reservation?.status === 'ACTIVE' ? reservation.quantity : 0;
        const delta = input.quantity - currentQuantity;
        let allocations = reservation?.status === 'ACTIVE' ? [...(reservation.allocations ?? [])] : [];
        const tracksInventory = await this.tracksInventory(ctx, variant);

        if (delta > 0) {
            if (tracksInventory) {
                const saleableStock = await this.productVariantService.getSaleableStockLevel(ctx, variant);
                if (delta > saleableStock) {
                    throw new Error(`Only ${Math.max(0, saleableStock)} units of ${variant.name} are available`);
                }
                allocations = await this.allocateStock(ctx, variant, allocations, delta);
            }
        } else if (delta < 0 && tracksInventory) {
            allocations = await this.releaseQuantity(ctx, String(variant.id), allocations, Math.abs(delta));
        }

        const expiresAt = new Date(Date.now() + this.timeoutMinutes() * 60_000);
        if (reservation) {
            reservation.quantity = input.quantity;
            reservation.allocations = allocations;
            reservation.status = 'ACTIVE';
            reservation.expiresAt = expiresAt;
            reservation.releasedAt = undefined;
        } else {
            reservation = new MarketplaceCartReservation({
                cartToken: input.cartToken,
                channelId: String(ctx.channelId),
                productVariantId: input.variantId,
                quantity: input.quantity,
                allocations,
                status: 'ACTIVE',
                expiresAt,
            });
        }
        await repository.save(reservation);
        const saleableStock = tracksInventory
            ? await this.productVariantService.getSaleableStockLevel(ctx, variant)
            : Math.max(0, (maxOrderQuantity || 99) - input.quantity);
        return {
            cartToken: input.cartToken,
            variantId: String(variant.id),
            quantity: input.quantity,
            expiresAt,
            saleableStock: Math.max(0, saleableStock),
        };
    }

    async release(ctx: RequestContext, cartToken: string, variantId?: string) {
        const safeToken = this.validateCartToken(cartToken);
        const repository = this.connection.getRepository(ctx, MarketplaceCartReservation);
        const reservations = await repository.find({
            where: {
                cartToken: safeToken,
                channelId: String(ctx.channelId),
                status: 'ACTIVE',
                ...(variantId ? { productVariantId: String(variantId) } : {}),
            },
        });
        for (const reservation of reservations) {
            await this.releaseReservation(ctx, reservation, 'RELEASED');
        }
        return { success: true, message: `${reservations.length} cart reservation(s) released` };
    }

    async consume(ctx: RequestContext, cartToken: string, rawItems: Array<{ variantId: string; quantity: number }>) {
        const safeToken = this.validateCartToken(cartToken);
        if (!rawItems.length || rawItems.length > 50) throw new Error('The cart must contain between 1 and 50 items');
        const items = rawItems.map(item => ({
            variantId: String(item.variantId),
            quantity: this.validateQuantity(item.quantity),
        }));
        if (new Set(items.map(item => item.variantId)).size !== items.length) {
            throw new Error('Each product variant can only appear once in a cart');
        }
        const repository = this.connection.getRepository(ctx, MarketplaceCartReservation);
        const reservations = await repository.find({
            where: {
                cartToken: safeToken,
                channelId: String(ctx.channelId),
                productVariantId: In(items.map(item => item.variantId)),
                status: 'ACTIVE',
            },
        });
        const now = Date.now();
        for (const item of items) {
            const reservation = reservations.find(candidate => candidate.productVariantId === item.variantId);
            if (!reservation || reservation.expiresAt.getTime() <= now || reservation.quantity !== item.quantity) {
                throw new Error('A cart stock reservation expired or changed. Refresh your basket and try again');
            }
        }
        for (const reservation of reservations) {
            await this.releaseReservation(ctx, reservation, 'CONSUMED');
        }
        return { success: true, message: `${reservations.length} cart reservation(s) transferred to checkout` };
    }

    async prepareCheckout(
        ctx: RequestContext,
        cartToken: string,
        rawItems: Array<{ variantId: string; quantity: number }>,
        orderId: ID,
    ) {
        await this.consume(ctx, cartToken, rawItems);
        const result = await this.orderService.addItemsToOrder(
            ctx,
            orderId,
            rawItems.map(item => ({
                productVariantId: item.variantId,
                quantity: item.quantity,
            })),
        );
        if (result.errorResults.length) {
            throw new Error(result.errorResults[0]?.message ?? 'One of the products is no longer available');
        }
        const order = await this.connection.getEntityOrThrow(ctx, Order, result.order.id, {
            relations: ['lines', 'lines.productVariant'],
        });
        await this.stockMovementService.createAllocationsForOrder(ctx, order);
        return {
            orderId: String(order.id),
            code: order.code,
            state: order.state,
        };
    }

    async releaseExpired(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplaceCartReservation);
        const reservations = await repository.find({
            where: { status: 'ACTIVE', expiresAt: LessThan(new Date()) },
            take: 200,
        });
        for (const reservation of reservations) {
            await this.releaseReservation(ctx, reservation, 'EXPIRED');
        }
        return reservations.length;
    }

    private async allocateStock(
        ctx: RequestContext,
        variant: ProductVariant,
        current: MarketplaceCartStockAllocation[],
        quantity: number,
    ) {
        const stockLevels = await this.stockLevelService.getStockLevelsForVariant(ctx, variant.id);
        if (!stockLevels.length) {
            const location = await this.stockLocationService.defaultStockLocation(ctx);
            if (!location) throw new Error('No stock location is configured for this product');
            stockLevels.push(await this.stockLevelService.getStockLevel(ctx, variant.id, location.id));
        }
        let remaining = quantity;
        const next = current.map(item => ({ ...item }));
        for (const stockLevel of stockLevels) {
            const availableAtLocation = Math.max(0, stockLevel.stockOnHand - stockLevel.stockAllocated);
            const quantityToAllocate = Math.min(remaining, availableAtLocation);
            if (quantityToAllocate > 0) {
                await this.changeAllocation(ctx, variant.id, stockLevel.stockLocationId, quantityToAllocate);
                this.addAllocation(next, String(stockLevel.stockLocationId), quantityToAllocate);
                remaining -= quantityToAllocate;
            }
            if (remaining === 0) break;
        }
        if (remaining > 0) {
            const fallbackLocationId = String(stockLevels[0]!.stockLocationId);
            await this.changeAllocation(ctx, variant.id, fallbackLocationId, remaining);
            this.addAllocation(next, fallbackLocationId, remaining);
        }
        return next;
    }

    private async releaseQuantity(
        ctx: RequestContext,
        variantId: ID,
        current: MarketplaceCartStockAllocation[],
        quantity: number,
    ) {
        let remaining = quantity;
        const next = current.map(item => ({ ...item }));
        for (let index = next.length - 1; index >= 0 && remaining > 0; index -= 1) {
            const allocation = next[index]!;
            const quantityToRelease = Math.min(remaining, allocation.quantity);
            await this.changeAllocation(ctx, variantId, allocation.stockLocationId, -quantityToRelease);
            allocation.quantity -= quantityToRelease;
            remaining -= quantityToRelease;
        }
        return next.filter(item => item.quantity > 0);
    }

    private async releaseReservation(
        ctx: RequestContext,
        reservation: MarketplaceCartReservation,
        status: 'CONSUMED' | 'RELEASED' | 'EXPIRED',
    ) {
        for (const allocation of reservation.allocations ?? []) {
            await this.changeAllocation(
                ctx,
                reservation.productVariantId,
                allocation.stockLocationId,
                -allocation.quantity,
            );
        }
        reservation.allocations = [];
        reservation.status = status;
        reservation.releasedAt = new Date();
        await this.connection.getRepository(ctx, MarketplaceCartReservation).save(reservation);
    }

    private changeAllocation(ctx: RequestContext, variantId: ID, stockLocationId: ID, change: number) {
        return this.stockLevelService.updateStockAllocatedForLocation(ctx, variantId, stockLocationId, change);
    }

    private addAllocation(allocations: MarketplaceCartStockAllocation[], stockLocationId: string, quantity: number) {
        const existing = allocations.find(item => item.stockLocationId === stockLocationId);
        if (existing) existing.quantity += quantity;
        else allocations.push({ stockLocationId, quantity });
    }

    private async tracksInventory(ctx: RequestContext, variant: ProductVariant) {
        const globalSettings = await this.globalSettingsService.getSettings(ctx);
        return variant.trackInventory === GlobalFlag.TRUE ||
            (variant.trackInventory === GlobalFlag.INHERIT && globalSettings.trackInventory);
    }

    private validateInput(input: CartReservationInput): CartReservationInput {
        return {
            cartToken: this.validateCartToken(input.cartToken),
            variantId: String(input.variantId || ''),
            quantity: this.validateQuantity(input.quantity),
        };
    }

    private validateCartToken(value: string) {
        const token = String(value || '').trim();
        if (!/^[A-Za-z0-9_-]{20,128}$/.test(token)) throw new Error('The cart token is invalid');
        return token;
    }

    private validateQuantity(value: number) {
        const quantity = Number(value);
        if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
            throw new Error('Cart quantity must be a whole number between 1 and 99');
        }
        return quantity;
    }

    private positiveInteger(value: unknown) {
        return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
    }

    private timeoutMinutes() {
        const configuredMinutes = Number(process.env.CART_RESERVATION_TIMEOUT_MINUTES ?? DEFAULT_CART_RESERVATION_MINUTES);
        return Number.isFinite(configuredMinutes) && configuredMinutes >= 1
            ? Math.floor(configuredMinutes)
            : DEFAULT_CART_RESERVATION_MINUTES;
    }
}
