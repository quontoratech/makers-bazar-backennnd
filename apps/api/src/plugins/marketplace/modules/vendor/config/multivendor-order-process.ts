import { OrderType } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ChannelService,
    CustomOrderProcess,
    idsAreEqual,
    Order,
    orderItemsAreDelivered,
    orderItemsArePartiallyDelivered,
    orderItemsArePartiallyShipped,
    orderItemsAreShipped,
    OrderService,
    RequestContext,
    RequestContextService,
    ProductVariant,
    StockMovementService,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { In } from 'typeorm';

import { marketplaceListingRequiresShipping } from '../../catalog/catalog-shipping-policy';
import { MarketplaceCategory } from '../../catalog/entities/marketplace-category.entity';
import { MarketplaceFormTemplate } from '../../catalog/entities/marketplace-form-template.entity';
import { MarketplaceListingCategory } from '../../catalog/entities/marketplace-listing-category.entity';
import { MarketplaceListingQuote } from '../../chat/entities/marketplace-listing-quote.entity';

let connection: TransactionalConnection;
let orderService: OrderService;
let channelService: ChannelService;
let requestContextService: RequestContextService;
let stockMovementService: StockMovementService;

export const multivendorOrderProcess: CustomOrderProcess<any> = {
    init(injector) {
        connection = injector.get(TransactionalConnection);
        orderService = injector.get(OrderService);
        channelService = injector.get(ChannelService);
        requestContextService = injector.get(RequestContextService);
        stockMovementService = injector.get(StockMovementService);
    },

    async onTransitionStart(fromState, toState, data) {
        const { ctx, order } = data;
        if (fromState === 'AddingItems' && toState === 'ArrangingPayment') {
            for (const line of data.order.lines) {
                if (!line.shippingLineId && await lineRequiresShippingAssignment(ctx, line)) {
                    return 'not all lines have shipping';
                }
            }
            const variantIds = data.order.lines.map(line => line.productVariant.id);
            const variants = variantIds.length
                ? await connection.getRepository(ctx, ProductVariant).find({
                    where: { id: In(variantIds) },
                })
                : [];
            const variantsById = new Map(variants.map(variant => [String(variant.id), variant]));
            for (const line of data.order.lines) {
                const variant = variantsById.get(String(line.productVariant.id));
                const rawLimit = (variant?.customFields as Record<string, unknown> | undefined)?.maxOrderQuantity;
                const maxOrderQuantity = typeof rawLimit === 'number' && Number.isInteger(rawLimit) && rawLimit > 0
                    ? rawLimit
                    : 0;
                if (maxOrderQuantity && line.quantity > maxOrderQuantity) {
                    return `${variant?.name || line.productVariant.name} is limited to ${maxOrderQuantity} per order`;
                }
            }
        }

        // Aggregate orders are allowed to transition to these states without validating
        // fulfillments, since aggregate orders do not have fulfillments, but will get
        // transitioned based on the status of the sellerOrders' fulfillments.
        if (order.type !== OrderType.Aggregate) {
            if (toState === 'PartiallyShipped') {
                const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                if (!orderItemsArePartiallyShipped(orderWithFulfillments)) {
                    return `message.cannot-transition-unless-some-order-items-shipped`;
                }
            }
            if (toState === 'Shipped') {
                const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                if (!orderItemsAreShipped(orderWithFulfillments)) {
                    return `message.cannot-transition-unless-all-order-items-shipped`;
                }
            }
            if (toState === 'PartiallyDelivered') {
                const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                if (!orderItemsArePartiallyDelivered(orderWithFulfillments)) {
                    return `message.cannot-transition-unless-some-order-items-delivered`;
                }
            }
            if (toState === 'Delivered') {
                const orderWithFulfillments = await findOrderWithFulfillments(ctx, order.id);
                if (!orderItemsAreDelivered(orderWithFulfillments)) {
                    return `message.cannot-transition-unless-all-order-items-delivered`;
                }
            }
        }
    },
    async onTransitionEnd(fromState, toState, data) {
        const { ctx, order } = data;
        if (
            (fromState === 'ArrangingPayment' && (toState === 'AddingItems' || toState === 'Cancelled')) ||
            (fromState === 'AddingItems' && toState === 'Cancelled')
        ) {
            await stockMovementService.createReleasesForOrderLines(ctx, order.lines.map(line => ({
                orderLineId: line.id,
                quantity: line.quantity,
            })));
        }
        if (order.type === OrderType.Seller) {
            const aggregateOrder = await orderService.getAggregateOrder(ctx, order);
            if (aggregateOrder) {
                // Create a new RequestContext on the default Channel, since the current
                // RequestContext may be scoped to the Seller channel, and will not be able to
                // update the AggregateOrder.
                const defaultChannel = await channelService.getDefaultChannel();
                const defaultChannelCtx = await requestContextService.create({
                    apiType: 'admin',
                    channelOrToken: defaultChannel,
                    req: ctx.req,
                    languageCode: ctx.languageCode,
                    user: ctx.activeUserId ? new User({ id: ctx.activeUserId }) : undefined,
                });

                // This part is responsible for automatically updating the state of the aggregate Order
                // based on the fulfillment state of all the associated seller Orders.
                const otherSellerOrders = (await orderService.getSellerOrders(ctx, aggregateOrder)).filter(
                    so => !idsAreEqual(so.id, order.id),
                );

                const sellerOrderStates = [...otherSellerOrders.map(so => so.state), toState];
                if (sellerOrderStates.every(state => state === 'Shipped')) {
                    await orderService.transitionToState(defaultChannelCtx, aggregateOrder.id, 'Shipped');
                } else if (sellerOrderStates.every(state => state === 'Delivered')) {
                    await orderService.transitionToState(defaultChannelCtx, aggregateOrder.id, 'Delivered');
                } else if (sellerOrderStates.some(state => state === 'Delivered')) {
                    await orderService.transitionToState(
                        defaultChannelCtx,
                        aggregateOrder.id,
                        'PartiallyDelivered',
                    );
                } else if (sellerOrderStates.some(state => state === 'Shipped')) {
                    await orderService.transitionToState(
                        defaultChannelCtx,
                        aggregateOrder.id,
                        'PartiallyShipped',
                    );
                }
            }
        }
    },
};

async function lineRequiresShippingAssignment(ctx: RequestContext, line: Order['lines'][number]) {
    const quoteId = String((line.customFields as Record<string, unknown> | undefined)?.marketplaceQuoteId ?? '').trim();
    if (quoteId) {
        const quote = await connection.getRepository(ctx, MarketplaceListingQuote).findOne({ where: { id: quoteId } });
        if (!quote
            || quote.status !== 'SENT'
            || quote.validUntil.getTime() <= Date.now()
            || quote.customerUserId !== String(ctx.activeUserId ?? '')
            || quote.productVariantId !== String(line.productVariant.id)) {
            return true;
        }
    }
    const variant = await connection.getRepository(ctx, ProductVariant).findOne({
        where: { id: line.productVariant.id },
        relations: ['product'],
    });
    const product = variant?.product;
    if (!product) return true;
    const listingCategory = await connection.getRepository(ctx, MarketplaceListingCategory).findOne({
        where: { productId: String(product.id), isPrimary: true },
    });
    const category = listingCategory
        ? await connection.getRepository(ctx, MarketplaceCategory).findOne({ where: { id: listingCategory.categoryId } })
        : null;
    const formTemplate = category?.formTemplateId
        ? await connection.getRepository(ctx, MarketplaceFormTemplate).findOne({ where: { id: category.formTemplateId } })
        : null;
    const marketplaceType = (product.customFields as Record<string, unknown> | undefined)?.marketplaceType;
    return marketplaceListingRequiresShipping(formTemplate?.listingType, marketplaceType);
}

async function findOrderWithFulfillments(ctx: RequestContext, id: ID): Promise<Order> {
    return await connection.getEntityOrThrow(ctx, Order, id, {
        relations: ['lines', 'fulfillments', 'fulfillments.lines', 'fulfillments.lines.fulfillment'],
    });
}
