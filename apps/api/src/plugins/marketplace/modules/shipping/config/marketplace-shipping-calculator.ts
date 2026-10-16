import { LanguageCode } from '@vendure/common/lib/generated-types';
import { EntityHydrator, ShippingCalculator } from '@vendure/core';

import { MarketplaceShippingService } from '../services/marketplace-shipping.service';
import { MARKETPLACE_SHIPPING_CALCULATOR_CODE } from '../shipping.constants';

let marketplaceShippingService: MarketplaceShippingService;
let entityHydrator: EntityHydrator;

export const marketplaceShippingCalculator = new ShippingCalculator({
    code: MARKETPLACE_SHIPPING_CALCULATOR_CODE,
    description: [{
        languageCode: LanguageCode.en,
        value: 'Calculates delivery from the vendor shipping profile and customer destination',
    }],
    args: {
        vendorProfileId: {
            type: 'string',
            label: [{ languageCode: LanguageCode.en, value: 'Vendor profile ID' }],
        },
    },
    init(injector) {
        marketplaceShippingService = injector.get(MarketplaceShippingService);
        entityHydrator = injector.get(EntityHydrator);
    },
    calculate: async (ctx, order, args) => {
        await entityHydrator.hydrate(ctx, order, { relations: ['lines.productVariant.product'] });
        const products = order.lines.flatMap(line => {
            const product = line.productVariant?.product;
            const customFields = product?.customFields as Record<string, unknown> | undefined;
            if (!product || String(customFields?.vendorProfileId ?? '') !== String(args.vendorProfileId)) return [];
            if (!['PHYSICAL', 'PERISHABLE'].includes(String(customFields?.marketplaceType ?? ''))) return [];
            let metadata: Record<string, unknown> = {};
            try {
                metadata = typeof customFields?.marketplaceMetadata === 'string'
                    ? JSON.parse(customFields.marketplaceMetadata) as Record<string, unknown>
                    : {};
            } catch {
                metadata = {};
            }
            return [{
                name: product.name,
                productType: String(customFields?.marketplaceType ?? ''),
                shippingProfileId: typeof metadata.shippingProfileId === 'string'
                    ? metadata.shippingProfileId
                    : undefined,
            }];
        });
        const quote = await marketplaceShippingService.calculateVendorOrderRate(
            ctx,
            args.vendorProfileId,
            {
                city: order.shippingAddress?.city ?? '',
                province: order.shippingAddress?.province ?? undefined,
                postalCode: order.shippingAddress?.postalCode ?? undefined,
            },
            products,
        );
        return {
            price: quote.rate,
            taxRate: 0,
            priceIncludesTax: true,
            metadata: {
                vendorId: quote.vendorId,
                vendorName: quote.vendorName,
                profileId: quote.profileId,
                profileName: quote.profileName,
                mode: quote.mode,
                ruleName: quote.ruleName,
                minDeliveryDays: quote.minDeliveryDays,
                maxDeliveryDays: quote.maxDeliveryDays,
                processingDays: quote.processingDays,
                breakdown: quote.breakdown,
            },
        };
    },
});
