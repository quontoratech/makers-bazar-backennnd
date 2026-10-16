import { normalizeString } from '@vendure/common/lib/normalize-string';
import { createHash } from 'node:crypto';
import { DeletionResult, GlobalFlag } from '@vendure/common/lib/generated-types';
import {
    Asset,
    ChannelService,
    LanguageCode,
    Product,
    ProductOption,
    ProductOptionGroup,
    ProductOptionGroupService,
    ProductOptionService,
    ProductService,
    ProductVariant,
    ProductVariantService,
    RequestContext,
    RequestContextService,
    StockMovement,
    StockLocation,
    StockLevelService,
    StockLocationService,
    TransactionalConnection,
    isGraphQlErrorResult,
} from '@vendure/core';
import { Injectable } from '@nestjs/common';

import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { getMarketplaceVendorAvailability } from '../../vendor/vendor-availability';
import { MarketplaceDiscoveryLocation, vendorPrimaryLocation, vendorServesLocation } from '../../vendor/vendor-location';
import { MarketplaceVendorEnforcementService } from '../../report/services/marketplace-vendor-enforcement.service';
import { PromotionService } from '../../promotion/services/promotion.service';
import { MarketplaceReviewService } from '../../review/services/marketplace-review.service';
import { MarketplaceShippingService } from '../../shipping/services/marketplace-shipping.service';
import {
    MarketplaceDeliveryProfile,
    VendorShippingProfile,
} from '../../shipping/entities/vendor-shipping-profile.entity';
import {
    CreateMarketplaceProductInput,
    CreateMarketplaceCategoryInput,
    CreateMarketplaceFormTemplateInput,
    MarketplaceInventoryUpdateInput,
    MarketplaceProductOptionGroupInput,
    MarketplaceProductVariantInput,
    UpdateMarketplaceProductInput,
    UpdateMarketplaceCategoryInput,
    UpdateMarketplaceFormTemplateInput,
    UpsertMarketplaceCategoryFieldInput,
} from '../dto/marketplace-product.inputs';
import { MarketplaceAvailabilitySession } from '../entities/marketplace-availability-session.entity';
import { MarketplaceDigitalFile } from '../entities/marketplace-digital-file.entity';
import { MarketplaceEventScheduleItem } from '../entities/marketplace-event-schedule-item.entity';
import { MarketplaceEventTicketType } from '../entities/marketplace-event-ticket-type.entity';
import { MarketplaceListingType } from '../entities/marketplace-form-template.entity';
import { MarketplaceListingCategory } from '../entities/marketplace-listing-category.entity';
import { MarketplaceListingFieldValue } from '../entities/marketplace-listing-field-value.entity';
import { MarketplaceServicePackage } from '../entities/marketplace-service-package.entity';
import { DigitalFileSecurityService } from './digital-file-security.service';
import { MarketplaceCategoryService, MarketplaceResolvedFormSchema } from './marketplace-category.service';
import { vendorAllowedListingTypes as resolveVendorAllowedListingTypes } from '../vendor-category-access';

interface StoredMarketplaceMetadata {
    categoryId?: string;
    categoryCode?: string;
    categoryName?: string;
    categoryBreadcrumb?: string[];
    formTemplateKey?: string;
    schemaVersion?: number;
    brand?: string;
    tags: string[];
    attributes: Record<string, unknown>;
    stylingVideoUrl?: string;
    deliveryInformation?: string;
    shippingProfileId?: string;
    returnPolicy?: string;
    disclaimer?: string;
    seo: { title?: string; description?: string };
    variantDetails: Record<string, { compareAtPrice?: number; imageAssetId?: string; barcode?: string; weightGrams?: number }>;
}

interface NamedTranslation {
    languageCode?: LanguageCode;
    name?: unknown;
}

interface NamedTranslatableEntity {
    name?: unknown;
    translations?: NamedTranslation[];
}

interface VariantInventorySettings {
    lowStockThreshold: number;
    allowBackorders: boolean;
    backorderLimit: number;
    maxOrderQuantity: number;
}

export interface MarketplaceCatalogProductFilterInput {
    categoryCode?: string;
    productType?: string;
    vendorId?: string;
    vendorSlug?: string;
    vendor?: string;
    location?: string;
    availability?: string;
    dietaryTags?: string[];
    minPrice?: number;
    maxPrice?: number;
    ratingMin?: number;
    deliveryTimeMaxDays?: number;
    dateFrom?: string | Date;
    dateTo?: string | Date;
}

type MarketplaceCatalogProductSort =
    | 'RELEVANCE'
    | 'POPULARITY'
    | 'NEWEST'
    | 'PRICE_ASC'
    | 'PRICE_DESC'
    | 'RATING'
    | 'FASTEST_DELIVERY';

interface NormalizedCatalogProductFilter {
    categoryCode?: string;
    productType?: string;
    vendorId?: string;
    vendorSlug?: string;
    vendor?: string;
    location?: string;
    availability?: string;
    dietaryTags: string[];
    minPrice?: number;
    maxPrice?: number;
    ratingMin?: number;
    deliveryTimeMaxDays?: number;
    dateFrom?: Date;
    dateTo?: Date;
}

interface SearchableCatalogProduct {
    createdAt: Date;
    updatedAt: Date;
    name: string;
    slug: string;
    description: string;
    productType: string;
    categoryCode: string;
    categoryName: string;
    vendorProfileId: string;
    vendorName: string;
    vendorSlug: string;
    location: string;
    vendorLocations: string[];
    vendorAvailability: { isOpen: boolean };
    metadata: StoredMarketplaceMetadata & Record<string, unknown>;
    variants: Array<{
        stockOnHand: number;
        stockAllocated: number;
        lowStockThreshold: number;
        allowBackorders: boolean;
        saleableStock: number;
    }>;
    minPrice: number;
    totalStock: number;
    deliveryProfileName?: string;
    deliveryMinDays?: number;
    deliveryMaxDays?: number;
    eventStartsAt?: Date;
    eventEndsAt?: Date;
    ratingAverage?: number | null;
    ratingCount: number;
    badges: string[];
    isPromoted: boolean;
    promotionPlacement?: string;
    promotionEndsAt?: Date;
    promotionRank?: number;
}

@Injectable()
export class MarketplaceCatalogService {
    constructor(
        private connection: TransactionalConnection,
        private productService: ProductService,
        private productVariantService: ProductVariantService,
        private productOptionGroupService: ProductOptionGroupService,
        private productOptionService: ProductOptionService,
        private stockLocationService: StockLocationService,
        private stockLevelService: StockLevelService,
        private channelService: ChannelService,
        private marketplaceShippingService: MarketplaceShippingService,
        private requestContextService: RequestContextService,
        private marketplaceVendorEnforcementService: MarketplaceVendorEnforcementService,
        private marketplaceReviewService: MarketplaceReviewService,
        private digitalFileSecurityService: DigitalFileSecurityService,
        private promotionService: PromotionService,
        private marketplaceCategoryService: MarketplaceCategoryService,
    ) {}

    async ensureDynamicCatalog(ctx: RequestContext) {
        await this.marketplaceCategoryService.ensureSeeded(ctx);
    }

    async ensureMarketplaceStockLocationVisibility() {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendorChannelIds = new Set(vendors
            .map(vendor => String(vendor.channelId ?? ''))
            .filter(Boolean));
        if (!vendorChannelIds.size) return;

        const stockLocations = await this.connection.getRepository(ctx, StockLocation).find({
            relations: ['channels'],
        });
        for (const stockLocation of stockLocations) {
            const assignedChannelIds = new Set((stockLocation.channels ?? []).map(channel => String(channel.id)));
            const belongsToVendor = [...vendorChannelIds].some(channelId => assignedChannelIds.has(channelId));
            const visibleInMarketplace = assignedChannelIds.has(String(defaultChannel.id));
            if (belongsToVendor && !visibleInMarketplace) {
                await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, [defaultChannel.id]);
            }
        }
    }

    async getCategoryDefinitions(ctx: RequestContext) {
        const roots = await this.marketplaceCategoryService.categoryTree(ctx, false);
        return Promise.all(roots.map(async root => {
            const schema = await this.marketplaceCategoryService.resolvedForm(ctx, String(root.id), true);
            return {
                id: String(root.id),
                code: root.code,
                name: root.name,
                productType: this.marketplaceCategoryService.behaviorProductType(schema.formTemplate),
                listingType: schema.formTemplate.listingType,
                description: root.description,
                breadcrumb: root.breadcrumb,
                fields: schema.fields,
            };
        }));
    }

    categoryTree(ctx: RequestContext, includeInactive = false) {
        return this.marketplaceCategoryService.categoryTree(ctx, includeInactive);
    }

    categories(ctx: RequestContext, includeInactive = false) {
        return this.marketplaceCategoryService.flatCategories(ctx, includeInactive);
    }

    async vendorCategories(ctx: RequestContext) {
        const vendor = await this.getActiveVendor(ctx);
        const categories = await this.marketplaceCategoryService.flatCategories(ctx, false);
        const allowedTypes = this.vendorAllowedListingTypes(vendor);
        if (!allowedTypes) return categories.map(category => ({ ...category, vendorSelectable: true }));
        const byId = new Map(categories.map(category => [String(category.id), category]));
        const selectable = new Set(categories
            .filter(category => {
                const template = category.effectiveFormTemplate as { key?: string; listingType?: MarketplaceListingType } | null | undefined;
                return Boolean(template?.listingType && (
                    allowedTypes.has(template.listingType)
                    || (template.key === 'custom_digital_project' && allowedTypes.has('DIGITAL_PRODUCT'))
                ));
            })
            .map(category => String(category.id)));
        const included = new Set(selectable);
        for (const id of [...selectable]) {
            let category = byId.get(id);
            while (category?.parentId) {
                const parentId = String(category.parentId);
                included.add(parentId);
                category = byId.get(parentId);
            }
        }
        return categories
            .filter(category => included.has(String(category.id)))
            .map(category => ({
                ...category,
                vendorSelectable: selectable.has(String(category.id)),
            }));
    }

    categoryFormSchema(ctx: RequestContext, categoryId: string, requireActive = true) {
        return this.marketplaceCategoryService.resolvedForm(ctx, categoryId, requireActive);
    }

    formTemplates(ctx: RequestContext, includeInactive = false) {
        return this.marketplaceCategoryService.listTemplates(ctx, includeInactive);
    }

    createFormTemplate(ctx: RequestContext, input: CreateMarketplaceFormTemplateInput) {
        return this.marketplaceCategoryService.createTemplate(ctx, input);
    }

    categoryFields(ctx: RequestContext, categoryId: string) {
        return this.marketplaceCategoryService.categoryFields(ctx, categoryId);
    }

    createCategory(ctx: RequestContext, input: CreateMarketplaceCategoryInput) {
        return this.marketplaceCategoryService.createCategory(ctx, input);
    }

    updateCategory(ctx: RequestContext, input: UpdateMarketplaceCategoryInput) {
        return this.marketplaceCategoryService.updateCategory(ctx, input);
    }

    reorderCategories(ctx: RequestContext, parentId: string | undefined, categoryIds: string[]) {
        return this.marketplaceCategoryService.reorderCategories(ctx, parentId, categoryIds);
    }

    deleteCategory(ctx: RequestContext, id: string) {
        return this.marketplaceCategoryService.deleteCategory(ctx, id);
    }

    upsertCategoryField(ctx: RequestContext, input: UpsertMarketplaceCategoryFieldInput) {
        return this.marketplaceCategoryService.upsertCategoryField(ctx, input);
    }

    deleteCategoryField(ctx: RequestContext, id: string) {
        return this.marketplaceCategoryService.deleteCategoryField(ctx, id);
    }

    updateFormTemplate(ctx: RequestContext, input: UpdateMarketplaceFormTemplateInput) {
        return this.marketplaceCategoryService.updateTemplate(ctx, input);
    }

    async listVendorProducts(ctx: RequestContext) {
        const vendor = await this.getVendorWorkspace(ctx);
        const products = await this.productService.findAll(ctx, { take: 100 }, [
            'featuredAsset',
            'assets',
            'assets.asset',
            'optionGroups',
            'optionGroups.options',
        ]);
        const owned = products.items.filter(product =>
            String((product.customFields as Record<string, unknown>)?.vendorProfileId ?? '') === String(vendor.id),
        );
        return {
            items: await Promise.all(owned.map(product => this.mapProduct(ctx, product, vendor, true))),
            totalItems: owned.length,
        };
    }

    async findVendorProduct(ctx: RequestContext, id: string | number) {
        const vendor = await this.getVendorWorkspace(ctx);
        const product = await this.getOwnedProduct(ctx, id, vendor);
        return this.mapProduct(ctx, product, vendor, true);
    }

    async getVendorInventory(ctx: RequestContext) {
        const catalog = await this.listVendorProducts(ctx);
        const trackedProducts = catalog.items.filter(product => ['PHYSICAL', 'PERISHABLE'].includes(product.productType));
        const items = (await Promise.all(trackedProducts.flatMap(product => product.variants.map(async variant => {
            const history = await this.connection.getRepository(ctx, StockMovement)
                .createQueryBuilder('movement')
                .leftJoin('movement.productVariant', 'variant')
                .where('variant.id = :variantId', { variantId: variant.id })
                .orderBy('movement.createdAt', 'DESC')
                .take(20)
                .getMany();
            const availableStock = Math.max(0, variant.stockOnHand - variant.stockAllocated);
            const status = availableStock === 0
                ? 'OUT_OF_STOCK'
                : availableStock <= variant.lowStockThreshold ? 'LOW_STOCK' : 'IN_STOCK';
            return {
                productId: product.id,
                productName: product.name,
                productStatus: product.status,
                productType: product.productType,
                variantId: variant.id,
                variantName: variant.name,
                sku: variant.sku,
                stockOnHand: variant.stockOnHand,
                stockAllocated: variant.stockAllocated,
                availableStock,
                saleableStock: variant.saleableStock,
                lowStockThreshold: variant.lowStockThreshold,
                allowBackorders: variant.allowBackorders,
                backorderLimit: variant.backorderLimit,
                maxOrderQuantity: variant.maxOrderQuantity,
                status,
                history: history.map(movement => ({
                    id: String(movement.id),
                    createdAt: movement.createdAt,
                    type: movement.type,
                    quantity: movement.quantity,
                })),
            };
        }))));
        items.sort((left, right) => {
            const statusOrder = { OUT_OF_STOCK: 0, LOW_STOCK: 1, IN_STOCK: 2 } as const;
            return statusOrder[left.status as keyof typeof statusOrder] - statusOrder[right.status as keyof typeof statusOrder]
                || left.productName.localeCompare(right.productName)
                || left.variantName.localeCompare(right.variantName);
        });
        return {
            items,
            totalItems: items.length,
            lowStockCount: items.filter(item => item.status === 'LOW_STOCK').length,
            outOfStockCount: items.filter(item => item.status === 'OUT_OF_STOCK').length,
        };
    }

    async bulkUpdateVendorInventory(ctx: RequestContext, input: MarketplaceInventoryUpdateInput[]) {
        const vendor = await this.getVendorWorkspace(ctx);
        if (!input.length || input.length > 100) throw new Error('Choose between 1 and 100 variants to update');
        const uniqueIds = new Set(input.map(item => String(item.variantId)));
        if (uniqueIds.size !== input.length) throw new Error('Each inventory variant can only be updated once');

        const updates = [];
        for (const item of input) {
            const settings = this.validateInventorySettings(item);
            if (!Number.isInteger(item.stockOnHand) || item.stockOnHand < 0) {
                throw new Error('Stock on hand must be a whole number of zero or more');
            }
            const variant = await this.productVariantService.findOne(ctx, item.variantId, ['product']);
            const ownerId = String((variant?.product?.customFields as Record<string, unknown> | undefined)?.vendorProfileId ?? '');
            if (!variant || ownerId !== String(vendor.id)) throw new Error('Inventory variant not found in this vendor catalog');
            updates.push({
                id: variant.id,
                stockOnHand: item.stockOnHand,
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: settings.allowBackorders ? -settings.backorderLimit : 0,
                customFields: {
                    ...(variant.customFields as Record<string, unknown>),
                    ...settings,
                },
            });
        }
        await this.productVariantService.update(ctx, updates);
        return this.getVendorInventory(ctx);
    }

    async listPublicProducts(
        ctx: RequestContext,
        categoryCode?: string,
        term?: string,
        location?: MarketplaceDiscoveryLocation,
        filterInput?: MarketplaceCatalogProductFilterInput,
        sortInput?: string,
    ) {
        await this.marketplaceVendorEnforcementService.releaseExpiredRestrictions(ctx);
        const products = await this.productService.findAll(ctx, { take: 100 }, [
            'featuredAsset',
            'assets',
            'assets.asset',
        ]);
        const filter = this.normalizeCatalogProductFilter(categoryCode, filterInput);
        const promotionMap = await this.promotionService.activePlacementMap(ctx, filter.categoryCode);
        const missingPromotedIds = [...promotionMap.keys()].filter(id => !products.items.some(product => String(product.id) === id));
        const additionalPromoted = await Promise.all(missingPromotedIds.map(id => this.productService.findOne(ctx, id, ['featuredAsset', 'assets', 'assets.asset'])));
        products.items.push(...additionalPromoted.filter((product): product is NonNullable<typeof product> => Boolean(product)));
        const terms = this.searchTerms(term);
        const eligible = products.items.filter(product => {
            const customFields = product.customFields as Record<string, unknown>;
            return product.enabled
                && Boolean(customFields?.vendorProfileId);
        });
        const vendorIds = [...new Set(eligible.map(product => String((product.customFields as Record<string, unknown>).vendorProfileId)))];
        const vendors = await this.connection.getRepository(ctx, VendorProfile).findByIds(vendorIds);
        const vendorById = new Map(vendors.map(vendor => [String(vendor.id), vendor]));
        const visible = eligible.filter(product => {
            const id = String((product.customFields as Record<string, unknown>).vendorProfileId);
            const vendor = vendorById.get(id);
            return vendor?.status === 'APPROVED' && !vendor.paused && vendorServesLocation(vendor, location);
        });
        const mapped = await Promise.all(visible.map(product => {
            const id = String((product.customFields as Record<string, unknown>).vendorProfileId);
            return this.mapProduct(ctx, product, vendorById.get(id)!);
        }));
        const promoted = mapped.map(product => {
            const placement = promotionMap.get(String(product.id));
            return placement ? { ...product, isPromoted: true, promotionPlacement: placement.placement, promotionEndsAt: placement.endsAt, promotionRank: placement.rank } : product;
        });
        const filtered = promoted
            .filter(product => this.matchesCatalogProductFilters(product, filter))
            .filter(product => this.matchesCatalogProductSearch(product, terms));
        const sorted = this.sortCatalogProducts(filtered, this.normalizeCatalogSort(sortInput), terms);
        sorted.sort((left, right) => (left.promotionRank ?? Number.MAX_SAFE_INTEGER) - (right.promotionRank ?? Number.MAX_SAFE_INTEGER));
        return {
            items: sorted,
            totalItems: sorted.length,
        };
    }

    async findPublicProductBySlug(ctx: RequestContext, slug: string, location?: MarketplaceDiscoveryLocation) {
        await this.marketplaceVendorEnforcementService.releaseExpiredRestrictions(ctx);
        const product = await this.productService.findOneBySlug(ctx, slug, [
            'featuredAsset',
            'assets',
            'assets.asset',
        ]);
        if (!product?.enabled) return null;
        const vendorProfileId = String((product.customFields as Record<string, unknown>)?.vendorProfileId ?? '');
        if (!vendorProfileId) return null;
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: vendorProfileId } });
        if (!vendor || vendor.status !== 'APPROVED' || vendor.paused || !vendorServesLocation(vendor, location)) return null;
        const mapped = await this.mapProduct(ctx, product, vendor);
        const promotion = (await this.promotionService.activePlacementMap(ctx)).get(String(mapped.id));
        return promotion ? { ...mapped, isPromoted: true, promotionPlacement: promotion.placement, promotionEndsAt: promotion.endsAt, promotionRank: promotion.rank } : mapped;
    }

    async findPublicProductById(ctx: RequestContext, id: string | number) {
        await this.marketplaceVendorEnforcementService.releaseExpiredRestrictions(ctx);
        const product = await this.productService.findOne(ctx, id, [
            'featuredAsset',
            'assets',
            'assets.asset',
        ]);
        if (!product?.enabled) return null;
        const vendorProfileId = String((product.customFields as Record<string, unknown>)?.vendorProfileId ?? '');
        if (!vendorProfileId) return null;
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: vendorProfileId } });
        if (!vendor || vendor.status !== 'APPROVED' || vendor.paused) return null;
        const mapped = await this.mapProduct(ctx, product, vendor);
        const promotion = (await this.promotionService.activePlacementMap(ctx)).get(String(mapped.id));
        return promotion ? { ...mapped, isPromoted: true, promotionPlacement: promotion.placement, promotionEndsAt: promotion.endsAt, promotionRank: promotion.rank } : mapped;
    }

    async createVendorProduct(ctx: RequestContext, input: CreateMarketplaceProductInput) {
        const vendor = await this.getActiveVendor(ctx);
        const resolved = await this.marketplaceCategoryService.resolveAndValidateListing(ctx, input);
        this.assertVendorCanUseSchema(vendor, resolved.schema);
        this.validateInput(input);
        this.validateDigitalFileOwnership(ctx, input, resolved.schema.fields);
        const productType = this.marketplaceCategoryService.behaviorProductType(resolved.schema.formTemplate);
        const deliveryProfile = ['PHYSICAL', 'PERISHABLE'].includes(productType)
            ? await this.marketplaceShippingService.validateProductProfile(ctx, vendor, input.shippingProfileId)
            : undefined;
        const assets = [...new Set(input.assetIds ?? [])];
        if (!assets.length) throw new Error('Add at least one product image before saving the draft');
        if (input.featuredAssetId && !assets.includes(input.featuredAssetId)) {
            throw new Error('The featured image must be included in the product gallery');
        }
        this.validateVariantAssets(input, assets);

        const metadata = this.buildMetadata(input, resolved, deliveryProfile?.id);
        const baseSlug = normalizeString(input.slug?.trim() || input.name.trim(), '-');
        const slug = `${vendor.slug}-${baseSlug}`;
        const product = await this.productService.create(ctx, {
            enabled: false,
            assetIds: assets,
            featuredAssetId: input.featuredAssetId ?? assets[0],
            translations: [{
                languageCode: ctx.languageCode ?? LanguageCode.en,
                name: input.name.trim(),
                slug,
                description: input.description.trim(),
            }],
            customFields: {
                marketplaceType: productType,
                vendorProfileId: String(vendor.id),
                marketplaceMetadata: JSON.stringify(metadata),
            },
        });

        const optionMap = await this.syncOptions(ctx, product.id, input.optionGroups ?? []);
        const stockLocations = await this.stockLocationService.findAll(ctx, { take: 10 });
        const stockLocation = stockLocations.items[0];
        const tracksInventory = ['PHYSICAL', 'PERISHABLE'].includes(productType);
        if (tracksInventory && !stockLocation) throw new Error('The vendor stock location is missing');

        const createdVariants = await this.productVariantService.create(ctx, input.variants.map(variant => ({
            productId: product.id,
            enabled: true,
            sku: variant.sku.trim(),
            price: variant.price,
            featuredAssetId: variant.imageAssetId,
            assetIds: variant.imageAssetId ? [variant.imageAssetId] : [],
            translations: [{
                languageCode: ctx.languageCode ?? LanguageCode.en,
                name: this.variantName(input.name.trim(), variant.optionValues),
            }],
            optionIds: this.resolveOptionIds(optionMap, variant),
            trackInventory: tracksInventory ? GlobalFlag.TRUE : GlobalFlag.FALSE,
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: this.outOfStockThreshold(variant),
            stockLevels: tracksInventory && stockLocation
                ? [{ stockLocationId: stockLocation.id, stockOnHand: variant.stockOnHand }]
                : undefined,
            customFields: {
                ...this.inputInventorySettings(variant),
                ...(productType === 'WORKSHOP' ? {
                    capacity: this.numberAttribute(input.attributes, 'capacity'),
                    availabilityStartsAt: this.dateAttribute(input.attributes, 'startsAt'),
                    availabilityEndsAt: this.dateAttribute(input.attributes, 'endsAt'),
                } : {}),
                availabilityEndsAt: variant.availabilityEndsAt ? new Date(variant.availabilityEndsAt) : undefined,
            },
        })));

        await this.assignToDefaultMarketplaceChannel(ctx, product.id, createdVariants, assets, optionMap);
        await this.syncStructuredListingRecords(ctx, String(product.id), input, resolved);
        const created = await this.productService.findOne(ctx, product.id, [
            'featuredAsset',
            'assets',
            'assets.asset',
            'optionGroups',
            'optionGroups.options',
        ]);
        if (!created) throw new Error('The product was created but could not be reloaded');
        return this.mapProduct(ctx, created, vendor, true);
    }

    async updateVendorProduct(ctx: RequestContext, input: UpdateMarketplaceProductInput) {
        const vendor = await this.getActiveVendor(ctx);
        const product = await this.getOwnedProduct(ctx, input.id, vendor);
        const resolved = await this.marketplaceCategoryService.resolveAndValidateListing(ctx, input);
        this.assertVendorCanUseSchema(vendor, resolved.schema);
        this.validateInput(input);
        this.validateDigitalFileOwnership(ctx, input, resolved.schema.fields);
        const productType = this.marketplaceCategoryService.behaviorProductType(resolved.schema.formTemplate);
        const deliveryProfile = ['PHYSICAL', 'PERISHABLE'].includes(productType)
            ? await this.marketplaceShippingService.validateProductProfile(ctx, vendor, input.shippingProfileId)
            : undefined;

        const assets = [...new Set(input.assetIds ?? [])];
        if (!assets.length) throw new Error('Keep at least one product image');
        if (input.featuredAssetId && !assets.includes(input.featuredAssetId)) {
            throw new Error('The featured image must be included in the product gallery');
        }
        this.validateVariantAssets(input, assets);

        const existingVariants = await this.productVariantService.getVariantsByProductId(ctx, product.id, { take: 100 });
        const existingById = new Map(existingVariants.items.map(variant => [String(variant.id), variant]));
        const submittedExistingIds = new Set(input.variants
            .map(variant => String(variant.id ?? ''))
            .filter(id => id && existingById.has(id)));
        if (input.variants.some(variant => variant.id && !existingById.has(String(variant.id)))) {
            throw new Error('One or more product variants do not belong to this listing');
        }

        const rawSlug = input.slug?.trim() || product.slug;
        const vendorPrefix = `${vendor.slug}-`;
        const baseSlug = rawSlug.startsWith(vendorPrefix) ? rawSlug.slice(vendorPrefix.length) : rawSlug;
        const slug = `${vendorPrefix}${normalizeString(baseSlug || input.name.trim(), '-')}`;
        const metadata = this.buildMetadata(input, resolved, deliveryProfile?.id);
        const optionMap = await this.syncOptions(ctx, product.id, input.optionGroups ?? [], product.optionGroups ?? []);
        await this.productService.update(ctx, {
            id: product.id,
            enabled: false,
            assetIds: assets,
            featuredAssetId: input.featuredAssetId ?? assets[0],
            translations: [{
                languageCode: ctx.languageCode ?? LanguageCode.en,
                name: input.name.trim(),
                slug,
                description: input.description.trim(),
            }],
            customFields: {
                marketplaceType: productType,
                vendorProfileId: String(vendor.id),
                marketplaceMetadata: JSON.stringify(metadata),
            },
        });

        const tracksInventory = ['PHYSICAL', 'PERISHABLE'].includes(productType);
        const variantsToUpdate = input.variants.filter(variant => variant.id && existingById.has(String(variant.id)));
        const variantsToCreate = input.variants.filter(variant => !variant.id || !existingById.has(String(variant.id)));
        if (variantsToUpdate.length) {
            await this.productVariantService.update(ctx, variantsToUpdate.map(variant => ({
                id: variant.id!,
                enabled: true,
                sku: variant.sku.trim(),
                price: variant.price,
                featuredAssetId: variant.imageAssetId,
                assetIds: variant.imageAssetId ? [variant.imageAssetId] : [],
                stockOnHand: tracksInventory ? variant.stockOnHand : undefined,
                trackInventory: tracksInventory ? GlobalFlag.TRUE : GlobalFlag.FALSE,
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: this.outOfStockThreshold(variant),
                optionIds: this.resolveOptionIds(optionMap, variant),
                translations: [{
                    languageCode: ctx.languageCode ?? LanguageCode.en,
                    name: this.variantName(input.name.trim(), variant.optionValues),
                }],
                customFields: {
                    ...this.inputInventorySettings(variant),
                    ...(productType === 'WORKSHOP' ? {
                        capacity: this.numberAttribute(input.attributes, 'capacity'),
                        availabilityStartsAt: this.dateAttribute(input.attributes, 'startsAt'),
                        availabilityEndsAt: this.dateAttribute(input.attributes, 'endsAt'),
                    } : {}),
                    availabilityEndsAt: variant.availabilityEndsAt ? new Date(variant.availabilityEndsAt) : undefined,
                },
            })));
        }

        let createdVariants: ProductVariant[] = [];
        if (variantsToCreate.length) {
            const stockLocations = await this.stockLocationService.findAll(ctx, { take: 10 });
            const stockLocation = stockLocations.items[0];
            if (tracksInventory && !stockLocation) throw new Error('The vendor stock location is missing');
            createdVariants = await this.productVariantService.create(ctx, variantsToCreate.map(variant => ({
                productId: product.id,
                enabled: true,
                sku: variant.sku.trim(),
                price: variant.price,
                featuredAssetId: variant.imageAssetId,
                assetIds: variant.imageAssetId ? [variant.imageAssetId] : [],
                translations: [{
                    languageCode: ctx.languageCode ?? LanguageCode.en,
                    name: this.variantName(input.name.trim(), variant.optionValues),
                }],
                optionIds: this.resolveOptionIds(optionMap, variant),
                trackInventory: tracksInventory ? GlobalFlag.TRUE : GlobalFlag.FALSE,
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: this.outOfStockThreshold(variant),
                stockLevels: tracksInventory && stockLocation
                    ? [{ stockLocationId: stockLocation.id, stockOnHand: variant.stockOnHand }]
                    : undefined,
                customFields: {
                    ...this.inputInventorySettings(variant),
                    ...(productType === 'WORKSHOP' ? {
                        capacity: this.numberAttribute(input.attributes, 'capacity'),
                        availabilityStartsAt: this.dateAttribute(input.attributes, 'startsAt'),
                        availabilityEndsAt: this.dateAttribute(input.attributes, 'endsAt'),
                    } : {}),
                    availabilityEndsAt: variant.availabilityEndsAt ? new Date(variant.availabilityEndsAt) : undefined,
                },
            })));
        }

        const variantsToDisable = existingVariants.items.filter(variant => !submittedExistingIds.has(String(variant.id)));
        if (variantsToDisable.length) {
            await this.productVariantService.update(ctx, variantsToDisable.map(variant => ({
                id: variant.id,
                enabled: false,
            })));
        }

        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (String(defaultChannel.id) !== String(ctx.channelId)) {
            for (const variant of variantsToUpdate) {
                await this.productVariantService.createOrUpdateProductVariantPrice(
                    ctx,
                    variant.id!,
                    variant.price,
                    defaultChannel.id,
                    defaultChannel.defaultCurrencyCode,
                );
            }
        }

        await this.assignToDefaultMarketplaceChannel(ctx, product.id, createdVariants, assets, optionMap);
        await this.syncStructuredListingRecords(ctx, String(product.id), input, resolved);
        const updated = await this.productService.findOne(ctx, product.id, [
            'featuredAsset',
            'assets',
            'assets.asset',
            'optionGroups',
            'optionGroups.options',
        ]);
        if (!updated) throw new Error('The product was updated but could not be reloaded');
        return this.mapProduct(ctx, updated, vendor, true);
    }

    async publishVendorProduct(ctx: RequestContext, id: string | number) {
        const vendor = await this.getActiveVendor(ctx);
        const product = await this.getOwnedProduct(ctx, id, vendor);
        const metadata = this.parseMetadata((product.customFields as Record<string, unknown>)?.marketplaceMetadata);
        const category = await this.marketplaceCategoryService.resolveCategory(ctx, metadata.categoryId, metadata.categoryCode, true);
        const resolvedSchema = await this.marketplaceCategoryService.resolvedForm(ctx, String(category.id), true);
        this.assertVendorCanUseSchema(vendor, resolvedSchema);
        const variants = await this.productVariantService.getVariantsByProductId(ctx, product.id, { take: 100 });
        const activeVariants = variants.items.filter(variant => variant.enabled);
        if (!product.assets?.length && !product.featuredAsset) {
            throw new Error('Add at least one product image before publishing');
        }
        if (!activeVariants.length) throw new Error('Add at least one product variant before publishing');
        if (String((product.customFields as Record<string, unknown>)?.marketplaceType ?? '') === 'DIGITAL') {
            const digitalFileRepository = this.connection.getRepository(ctx, MarketplaceDigitalFile);
            const files = await digitalFileRepository.find({
                where: { productId: String(product.id) },
            });
            if (!files.some(file => file.kind === 'MAIN')) throw new Error('Add a private main digital file before publishing');
            if (files.some(file => !file.isPrivate)) throw new Error('Paid digital source files must use private storage');
            for (const file of files) {
                const inspection = await this.digitalFileSecurityService.inspect(file);
                file.scanStatus = inspection.scanStatus;
                file.integrityStatus = inspection.integrityStatus;
                await digitalFileRepository.save(file, { reload: false });
                if (inspection.integrityStatus !== 'VALID') {
                    throw new Error(inspection.message || 'Digital source file integrity validation failed');
                }
            }
        }
        await this.inspectDynamicPrivateFiles(resolvedSchema.fields, metadata.attributes);

        await this.productService.update(ctx, { id: product.id, enabled: true });
        await this.productVariantService.update(ctx, activeVariants.map(variant => ({
            id: variant.id,
            enabled: true,
        })));
        const published = await this.productService.findOne(ctx, product.id, [
            'featuredAsset',
            'assets',
            'assets.asset',
            'optionGroups',
            'optionGroups.options',
        ]);
        if (!published) throw new Error('The product was published but could not be reloaded');
        return this.mapProduct(ctx, published, vendor, true);
    }

    async deleteVendorProduct(ctx: RequestContext, id: string | number) {
        const vendor = await this.getActiveVendor(ctx);
        const product = await this.getOwnedProduct(ctx, id, vendor);
        const result = await this.productService.softDelete(ctx, product.id);
        const success = result.result === DeletionResult.DELETED;
        if (success && vendor.featuredProductId === String(product.id)) {
            vendor.featuredProductId = undefined;
            await this.connection.getRepository(ctx, VendorProfile).save(vendor, { reload: false });
        }
        return {
            success,
            message: success ? `${product.name} was deleted` : result.message ?? 'The product could not be deleted',
        };
    }

    private validateInput(input: CreateMarketplaceProductInput) {
        if (input.name.trim().length < 3) throw new Error('Product name must contain at least 3 characters');
        if (input.description.trim().length < 20) throw new Error('Product description must contain at least 20 characters');
        if (!input.variants.length) throw new Error('Add at least one product variant');
        if (input.variants.length > 100) throw new Error('A product can contain at most 100 variants');
        if (input.stylingVideoUrl) {
            try {
                const url = new URL(input.stylingVideoUrl);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
            } catch {
                throw new Error('Product video must use a valid HTTP or HTTPS URL');
            }
        }
        const skus = input.variants.map(variant => variant.sku.trim().toLowerCase());
        if (skus.some(sku => !sku)) throw new Error('Every variant needs a SKU');
        if (new Set(skus).size !== skus.length) throw new Error('Variant SKUs must be unique');
        for (const variant of input.variants) {
            if (!Number.isInteger(variant.price) || variant.price < 1) throw new Error('Every variant needs a valid price');
            if (!Number.isInteger(variant.stockOnHand) || variant.stockOnHand < 0) throw new Error('Variant stock cannot be negative');
            this.validateInventorySettings(variant);
            if (variant.compareAtPrice != null && variant.compareAtPrice <= variant.price) {
                throw new Error('Discounted price must be lower than the regular price');
            }
            if (variant.availabilityEndsAt && !Number.isFinite(new Date(variant.availabilityEndsAt).getTime())) {
                throw new Error('Variant offer end must be a valid date and time');
            }
        }
        const groups = input.optionGroups ?? [];
        if (groups.length > 3) throw new Error('A product can contain at most 3 option groups');
        const groupNames = groups.map(group => group.name.trim().toLowerCase());
        if (new Set(groupNames).size !== groupNames.length) throw new Error('Option group names must be unique');
        for (const group of groups) {
            const values = group.values.map(value => value.trim()).filter(Boolean);
            if (!group.name.trim() || values.length < 2) throw new Error('Each option group needs a name and at least 2 values');
            if (new Set(values.map(value => value.toLowerCase())).size !== values.length) {
                throw new Error(`Values in ${group.name} must be unique`);
            }
        }
    }

    private validateVariantAssets(input: CreateMarketplaceProductInput, assetIds: string[]) {
        const available = new Set(assetIds.map(String));
        for (const variant of input.variants) {
            if (variant.imageAssetId && !available.has(String(variant.imageAssetId))) {
                throw new Error('Variant images must be selected from the product gallery');
            }
        }
    }

    private validateDigitalFileOwnership(
        ctx: RequestContext,
        input: CreateMarketplaceProductInput,
        fields: MarketplaceResolvedFormSchema['fields'],
    ) {
        const uploadedFiles = [
            ...(input.digitalFiles ?? []),
            ...this.dynamicPrivateFiles(fields, input.attributes ?? {}),
        ];
        if (!uploadedFiles.length) return;
        const identifier = ctx.session?.user?.identifier;
        if (!identifier) throw new Error('An authenticated vendor is required to attach digital files');
        const ownerPrefix = `${createHash('sha256').update(identifier).digest('hex').slice(0, 20)}/`;
        if (uploadedFiles.some(file => !file.storageKey.startsWith(ownerPrefix))) {
            throw new Error('A digital file does not belong to the authenticated vendor');
        }
    }

    private dynamicPrivateFiles(fields: MarketplaceResolvedFormSchema['fields'], values: Record<string, unknown>) {
        return fields.flatMap(field => {
            if (field.ui?.source || !['FILE', 'MULTIPLE_FILES'].includes(field.type)) return [];
            const raw = values[field.key];
            const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
            return items.flatMap(item => {
                if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
                const file = item as Record<string, unknown>;
                if (typeof file.storageKey !== 'string' || typeof file.fileName !== 'string'
                    || typeof file.mimeType !== 'string' || typeof file.sizeBytes !== 'number') return [];
                return [{
                    kind: 'LICENSE_DOCUMENT' as const,
                    fileName: file.fileName,
                    storageKey: file.storageKey,
                    mimeType: file.mimeType,
                    sizeBytes: file.sizeBytes,
                    checksum: typeof file.checksum === 'string' ? file.checksum : undefined,
                    isPrivate: true,
                }];
            });
        });
    }

    private async inspectDynamicPrivateFiles(
        fields: MarketplaceResolvedFormSchema['fields'],
        values: Record<string, unknown>,
    ) {
        for (const file of this.dynamicPrivateFiles(fields, values)) {
            const inspection = await this.digitalFileSecurityService.inspect(new MarketplaceDigitalFile({
                productId: 'dynamic-field',
                ...file,
            }));
            if (inspection.integrityStatus !== 'VALID') {
                throw new Error(inspection.message || 'A private listing attachment failed file validation');
            }
        }
    }

    private async syncOptions(
        ctx: RequestContext,
        productId: string | number,
        groups: MarketplaceProductOptionGroupInput[],
        currentGroups: ProductOptionGroup[] = [],
    ) {
        const result = new Map<string, Map<string, ProductOption>>();
        const submittedGroupNames = new Set(groups.map(group => group.name.trim().toLowerCase()));
        const submittedGroupIds = new Set(groups.map(group => String(group.id ?? '')).filter(Boolean));
        for (const currentGroup of currentGroups) {
            const currentName = this.translatedName(currentGroup, ctx.languageCode).toLowerCase();
            if (submittedGroupIds.has(String(currentGroup.id)) || submittedGroupNames.has(currentName)) continue;
            const removed = await this.productService.removeOptionGroupFromProduct(ctx, productId, currentGroup.id, true);
            if (isGraphQlErrorResult(removed)) throw new Error(removed.message);
        }
        const existingById = new Map(currentGroups.map(group => [String(group.id), group]));
        const existingByName = new Map(currentGroups.flatMap(group => {
            const name = this.translatedName(group, ctx.languageCode);
            return name ? [[name.toLowerCase(), group] as const] : [];
        }));
        for (const groupInput of groups) {
            const groupName = groupInput.name.trim();
            let group = groupInput.id ? existingById.get(String(groupInput.id)) : undefined;
            group = group ?? existingByName.get(groupName.toLowerCase());
            if (!group) {
                group = await this.productOptionGroupService.create(ctx, {
                    code: `${productId}-${normalizeString(groupName, '-')}`,
                    translations: [{ languageCode: ctx.languageCode ?? LanguageCode.en, name: groupName }],
                });
                await this.productService.addOptionGroupToProduct(ctx, productId, group.id);
            } else if (this.translatedName(group, ctx.languageCode) !== groupName) {
                group = await this.productOptionGroupService.update(ctx, {
                    id: group.id,
                    translations: [{ languageCode: ctx.languageCode ?? LanguageCode.en, name: groupName }],
                });
            }
            const optionsByValue = new Map((group.options ?? [])
                .flatMap(option => {
                    const name = this.translatedName(option, ctx.languageCode);
                    return name ? [[name.toLowerCase(), option] as const] : [];
                }));
            const values = new Map<string, ProductOption>();
            for (const rawValue of groupInput.values) {
                const value = rawValue.trim();
                let option = optionsByValue.get(value.toLowerCase());
                if (!option) {
                    option = await this.productOptionService.create(ctx, group, {
                        code: `${productId}-${normalizeString(groupName, '-')}-${normalizeString(value, '-')}`,
                        translations: [{ languageCode: ctx.languageCode ?? LanguageCode.en, name: value }],
                    });
                }
                values.set(value.toLowerCase(), option);
            }
            result.set(groupName.toLowerCase(), values);
        }
        return result;
    }

    private resolveOptionIds(optionMap: Map<string, Map<string, ProductOption>>, variant: MarketplaceProductVariantInput) {
        if (!optionMap.size) return [];
        const selected = variant.optionValues ?? {};
        return [...optionMap.entries()].map(([groupName, values]) => {
            const rawValue = Object.entries(selected).find(([name]) => name.toLowerCase() === groupName)?.[1];
            const option = rawValue ? values.get(rawValue.trim().toLowerCase()) : undefined;
            if (!option) throw new Error(`Choose a valid ${groupName} value for every variant`);
            return option.id;
        });
    }

    private variantName(productName: string, optionValues?: Record<string, string>) {
        const values = Object.values(optionValues ?? {}).map(value => value.trim()).filter(Boolean);
        return values.length ? `${productName} - ${values.join(' / ')}` : productName;
    }

    private translatedName(entity: NamedTranslatableEntity, languageCode?: LanguageCode): string {
        const directName = typeof entity.name === 'string' ? entity.name.trim() : '';
        if (directName) return directName;

        const translations = entity.translations ?? [];
        const translation = translations.find(item => item.languageCode === languageCode)
            ?? translations.find(item => item.languageCode === LanguageCode.en)
            ?? translations[0];
        return typeof translation?.name === 'string' ? translation.name.trim() : '';
    }

    private async assignToDefaultMarketplaceChannel(
        ctx: RequestContext,
        productId: string | number,
        variants: ProductVariant[],
        assetIds: string[],
        optionMap: Map<string, Map<string, ProductOption>>,
    ) {
        let defaultChannel = await this.channelService.getDefaultChannel(ctx);
        if (!defaultChannel.defaultShippingZone || !defaultChannel.defaultTaxZone) {
            const activeChannel = await this.channelService.findOne(ctx, ctx.channelId);
            const defaultShippingZoneId = defaultChannel.defaultShippingZone?.id
                ?? activeChannel?.defaultShippingZone?.id;
            const defaultTaxZoneId = defaultChannel.defaultTaxZone?.id
                ?? activeChannel?.defaultTaxZone?.id;
            if (!defaultShippingZoneId || !defaultTaxZoneId) {
                throw new Error('Marketplace tax and shipping zones are not configured');
            }
            const updateResult = await this.channelService.update(ctx, {
                id: defaultChannel.id,
                defaultShippingZoneId,
                defaultTaxZoneId,
            });
            if (isGraphQlErrorResult(updateResult)) {
                throw new Error(updateResult.message);
            }
            defaultChannel = updateResult;
        }
        if (String(defaultChannel.id) === String(ctx.channelId)) return;
        await this.channelService.assignToChannels(ctx, Product, productId, [defaultChannel.id]);
        for (const variant of variants) {
            await this.channelService.assignToChannels(ctx, ProductVariant, variant.id, [defaultChannel.id]);
        }
        if (assetIds.length) {
            for (const assetId of assetIds) {
                await this.channelService.assignToChannels(ctx, Asset, assetId, [defaultChannel.id]);
            }
        }
        for (const values of optionMap.values()) {
            const first = values.values().next().value as ProductOption | undefined;
            if (first) {
                await this.channelService.assignToChannels(ctx, ProductOptionGroup, first.groupId, [defaultChannel.id]);
            }
            for (const option of values.values()) {
                await this.channelService.assignToChannels(ctx, ProductOption, option.id, [defaultChannel.id]);
            }
        }
    }

    private async mapProduct(
        ctx: RequestContext,
        product: Product,
        vendor: VendorProfile,
        includePrivateDigitalMetadata = false,
    ) {
        const customFields = product.customFields as Record<string, unknown>;
        const metadata = this.parseMetadata(customFields?.marketplaceMetadata);
        const productType = String(customFields?.marketplaceType ?? 'PHYSICAL');
        const tracksInventory = ['PHYSICAL', 'PERISHABLE'].includes(productType);
        const category = await this.marketplaceCategoryService.resolveCategory(
            ctx,
            metadata.categoryId,
            metadata.categoryCode,
            false,
        ).catch(() => undefined);
        const resolvedSchema = category
            ? await this.marketplaceCategoryService.resolvedForm(ctx, String(category.id), false).catch(() => undefined)
            : undefined;
        const groupNameById = new Map((product.optionGroups ?? []).map(group => [
            String(group.id),
            this.translatedName(group, ctx.languageCode),
        ]));
        const assets = (product.assets ?? []).map(productAsset => ({
            id: String(productAsset.assetId),
            name: productAsset.asset?.name ?? '',
            preview: productAsset.asset?.preview ?? '',
        }));
        const assetById = new Map(assets.map(asset => [asset.id, asset]));
        const variants = await this.productVariantService.getVariantsByProductId(ctx, product.id, { take: 100 });
        const mappedVariants = await Promise.all(variants.items.filter(variant => variant.enabled).map(async variant => {
            const stock = await this.stockLevelService.getAvailableStock(ctx, variant.id);
            const details = metadata.variantDetails?.[variant.sku] ?? {};
            const inventory = this.variantInventorySettings(variant);
            const availableStock = stock.stockOnHand - stock.stockAllocated;
            const saleableStock = tracksInventory
                ? Math.max(0, availableStock + (inventory.allowBackorders ? inventory.backorderLimit : 0))
                : inventory.maxOrderQuantity || 99;
            const featuredAsset = variant.featuredAsset ? {
                id: String(variant.featuredAsset.id),
                name: variant.featuredAsset.name ?? '',
                preview: variant.featuredAsset.preview ?? '',
            } : details.imageAssetId ? assetById.get(String(details.imageAssetId)) : undefined;
            return {
                id: String(variant.id),
                name: variant.name,
                sku: variant.sku,
                enabled: variant.enabled,
                price: variant.price,
                priceWithTax: variant.priceWithTax,
                compareAtPrice: details.compareAtPrice,
                featuredAsset,
                stockOnHand: stock.stockOnHand,
                stockAllocated: stock.stockAllocated,
                lowStockThreshold: inventory.lowStockThreshold,
                allowBackorders: inventory.allowBackorders,
                backorderLimit: inventory.backorderLimit,
                maxOrderQuantity: inventory.maxOrderQuantity,
                saleableStock,
                options: (variant.options ?? [])
                    .map(option => this.translatedName(option, ctx.languageCode))
                    .filter(Boolean),
                optionValues: Object.fromEntries((variant.options ?? []).flatMap(option => {
                    const optionName = this.translatedName(option, ctx.languageCode);
                    if (!optionName) return [];
                    return [[
                        groupNameById.get(String(option.groupId)) || String(option.groupId),
                        optionName,
                    ] as const];
                })),
                barcode: details.barcode,
                weightGrams: details.weightGrams,
                availabilityEndsAt: this.variantAvailabilityEndsAt(variant),
            };
        }));
        const usedOptionValues = new Map<string, Set<string>>();
        for (const variant of mappedVariants) {
            for (const [groupName, value] of Object.entries(variant.optionValues ?? {})) {
                const values = usedOptionValues.get(groupName) ?? new Set<string>();
                values.add(value);
                usedOptionValues.set(groupName, values);
            }
        }
        const optionGroups = (product.optionGroups ?? [])
            .map(group => {
                const name = this.translatedName(group, ctx.languageCode);
                return {
                    id: String(group.id),
                    name,
                    values: (group.options ?? [])
                        .map(option => this.translatedName(option, ctx.languageCode))
                        .filter(value => value && usedOptionValues.get(name)?.has(value)),
                };
            })
            .filter(group => group.name && group.values.length);
        const reviewSummary = await this.marketplaceReviewService.summaryForProduct(ctx, String(product.id));
        const reviewBadges = reviewSummary.average != null && reviewSummary.average >= 4.5 && reviewSummary.count >= 3
            ? ['Top rated']
            : reviewSummary.count ? [] : ['New'];
        const deliveryProfile = await this.resolveProductDeliveryProfile(ctx, vendor, metadata.shippingProfileId, productType);
        const preparationTimeMinutes = this.numberAttribute(metadata.attributes, 'preparationTimeMinutes');
        const leadTimeDays = this.numberAttribute(metadata.attributes, 'leadTimeDays')
            ?? this.numberAttribute(metadata.attributes, 'productionTimeDays');
        const isInstantDelivery = productType === 'DIGITAL';
        const deliveryMinDays = deliveryProfile
            ? deliveryProfile.processingDays + deliveryProfile.defaultMinDeliveryDays
            : leadTimeDays ?? (isInstantDelivery ? 0 : undefined);
        const deliveryMaxDays = deliveryProfile
            ? deliveryProfile.processingDays + deliveryProfile.defaultMaxDeliveryDays
            : leadTimeDays ?? (isInstantDelivery ? 0 : undefined);
        const eventStartsAt = this.dateAttribute(metadata.attributes, 'startsAt')
            ?? this.combinedDateTimeAttribute(metadata.attributes, 'event_date', 'start_time');
        const eventEndsAt = this.dateAttribute(metadata.attributes, 'endsAt')
            ?? this.combinedDateTimeAttribute(metadata.attributes, 'event_date', 'end_time');
        const structured = await this.loadStructuredListingRecords(ctx, String(product.id));
        const publicAttributes = Object.fromEntries(Object.entries(metadata.attributes).filter(([key, value]) => {
            const definition = resolvedSchema?.fields.find(field => field.key === key);
            return definition?.type !== 'FILE'
                && definition?.type !== 'MULTIPLE_FILES'
                && definition?.ui?.private !== true
                && !this.containsPrivateUpload(value);
        }));
        const responseMetadata = includePrivateDigitalMetadata
            ? metadata
            : { ...metadata, attributes: publicAttributes };
        const digitalFiles = includePrivateDigitalMetadata
            ? structured.digitalFiles
            : structured.digitalFiles.map(file => ({
                id: String(file.id),
                kind: file.kind,
                fileName: file.fileName,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                isPrivate: file.isPrivate,
                downloadLimit: file.downloadLimit,
                expiresAt: file.expiresAt,
            }));
        return {
            id: String(product.id),
            createdAt: product.createdAt,
            updatedAt: product.updatedAt,
            name: product.name,
            slug: product.slug,
            description: product.description,
            enabled: product.enabled,
            status: product.enabled ? 'PUBLISHED' : 'DRAFT',
            productType,
            listingType: resolvedSchema?.formTemplate.listingType ?? metadata.formTemplateKey ?? productType,
            categoryId: category ? String(category.id) : metadata.categoryId ?? '',
            categoryCode: String(metadata.categoryCode ?? ''),
            categoryName: String(category?.name ?? metadata.categoryName ?? 'Marketplace'),
            categoryBreadcrumb: resolvedSchema?.category.breadcrumb ?? metadata.categoryBreadcrumb ?? [String(category?.name ?? metadata.categoryName ?? 'Marketplace')],
            chatEnabled: category?.chatEnabled === true,
            formTemplateKey: resolvedSchema?.formTemplate.key ?? metadata.formTemplateKey ?? '',
            schemaVersion: metadata.schemaVersion ?? resolvedSchema?.formTemplate.version ?? 1,
            fieldValues: includePrivateDigitalMetadata
                ? (Object.keys(structured.fieldValues).length ? structured.fieldValues : metadata.attributes)
                : publicAttributes,
            fieldDefinitions: resolvedSchema?.fields ?? [],
            vendorProfileId: String(vendor.id),
            vendorName: vendor.shopName,
            vendorSlug: vendor.slug,
            location: vendorPrimaryLocation(vendor),
            vendorLocations: vendor.operatingLocations ?? [],
            vendorAvailability: getMarketplaceVendorAvailability(vendor),
            metadata: responseMetadata,
            featuredAsset: product.featuredAsset ? {
                id: String(product.featuredAsset.id),
                name: product.featuredAsset.name || assets[0]?.name || 'Product image',
                preview: product.featuredAsset.preview || assets[0]?.preview || '',
            } : assets[0] ?? null,
            assets,
            optionGroups,
            variants: mappedVariants,
            minPrice: mappedVariants.length ? Math.min(...mappedVariants.map(variant => variant.price)) : 0,
            totalStock: mappedVariants.reduce((total, variant) => total + (tracksInventory
                ? Math.max(0, variant.stockOnHand - variant.stockAllocated)
                : variant.saleableStock), 0),
            deliveryProfileName: deliveryProfile?.name,
            deliveryMinDays,
            deliveryMaxDays,
            preparationTimeMinutes,
            eventStartsAt,
            eventEndsAt,
            ratingAverage: reviewSummary.average,
            ratingCount: reviewSummary.count,
            ratingBreakdown: reviewSummary.ratingBreakdown,
            badges: reviewBadges,
            servicePackages: structured.servicePackages,
            serviceAddOns: structured.serviceAddOns,
            availabilitySessions: structured.availabilitySessions,
            eventTicketTypes: structured.eventTicketTypes,
            eventScheduleItems: structured.eventScheduleItems,
            digitalFiles,
            isPromoted: false,
            promotionPlacement: undefined,
            promotionEndsAt: undefined,
            promotionRank: undefined,
        };
    }

    private containsPrivateUpload(value: unknown): boolean {
        if (Array.isArray(value)) return value.some(item => this.containsPrivateUpload(item));
        if (!value || typeof value !== 'object') return false;
        const record = value as Record<string, unknown>;
        if (typeof record.storageKey === 'string' || typeof record.checksum === 'string') return true;
        return Object.values(record).some(item => this.containsPrivateUpload(item));
    }

    private normalizeCatalogProductFilter(
        categoryCode?: string,
        input?: MarketplaceCatalogProductFilterInput,
    ): NormalizedCatalogProductFilter {
        return {
            categoryCode: this.cleanText(input?.categoryCode) ?? this.cleanText(categoryCode),
            productType: this.normalizeCode(input?.productType),
            vendorId: this.cleanText(input?.vendorId),
            vendorSlug: this.cleanText(input?.vendorSlug)?.toLowerCase(),
            vendor: this.cleanText(input?.vendor)?.toLowerCase(),
            location: this.cleanText(input?.location)?.toLowerCase(),
            availability: this.normalizeCode(input?.availability),
            dietaryTags: (input?.dietaryTags ?? [])
                .map(tag => this.cleanText(tag)?.toLowerCase())
                .filter((tag): tag is string => Boolean(tag)),
            minPrice: this.nonNegativeFiniteNumber(input?.minPrice),
            maxPrice: this.nonNegativeFiniteNumber(input?.maxPrice),
            ratingMin: this.nonNegativeFiniteNumber(input?.ratingMin),
            deliveryTimeMaxDays: this.nonNegativeInteger(input?.deliveryTimeMaxDays, -1) >= 0
                ? this.nonNegativeInteger(input?.deliveryTimeMaxDays, 0)
                : undefined,
            dateFrom: this.parseFilterDate(input?.dateFrom),
            dateTo: this.parseFilterDate(input?.dateTo, true),
        };
    }

    private matchesCatalogProductFilters(
        product: SearchableCatalogProduct,
        filter: NormalizedCatalogProductFilter,
    ) {
        if (filter.categoryCode
            && product.categoryCode !== filter.categoryCode
            && !product.categoryCode.startsWith(`${filter.categoryCode}/`)) return false;
        if (filter.productType && this.normalizeCode(product.productType) !== filter.productType) return false;
        if (filter.vendorId && String(product.vendorProfileId) !== filter.vendorId) return false;
        if (filter.vendorSlug && product.vendorSlug.toLowerCase() !== filter.vendorSlug) return false;
        if (filter.vendor && !product.vendorName.toLowerCase().includes(filter.vendor)) return false;
        if (filter.location && !this.catalogProductLocationText(product).includes(filter.location)) return false;
        if (filter.minPrice != null && product.minPrice < filter.minPrice) return false;
        if (filter.maxPrice != null && product.minPrice > filter.maxPrice) return false;
        if (filter.ratingMin != null && (product.ratingAverage ?? 0) < filter.ratingMin) return false;
        if (filter.deliveryTimeMaxDays != null && (product.deliveryMaxDays ?? Number.MAX_SAFE_INTEGER) > filter.deliveryTimeMaxDays) return false;
        if (filter.dateFrom || filter.dateTo) {
            const date = product.eventStartsAt ?? product.createdAt;
            const time = date.getTime();
            if (filter.dateFrom && time < filter.dateFrom.getTime()) return false;
            if (filter.dateTo && time > filter.dateTo.getTime()) return false;
        }
        if (filter.availability && !this.matchesAvailabilityFilter(product, filter.availability)) return false;
        if (filter.dietaryTags.length) {
            const tagText = this.catalogProductTagText(product);
            if (!filter.dietaryTags.every(tag => tagText.includes(tag))) return false;
        }
        return true;
    }

    private matchesAvailabilityFilter(product: SearchableCatalogProduct, availability: string) {
        const hasSaleableStock = this.catalogProductHasSaleableStock(product);
        const hasLowStock = product.variants.some(variant => {
            const availableStock = Math.max(0, variant.stockOnHand - variant.stockAllocated);
            return availableStock > 0 && availableStock <= variant.lowStockThreshold;
        });
        if (availability === 'AVAILABLE' || availability === 'IN_STOCK') return hasSaleableStock;
        if (availability === 'LOW_STOCK') return hasLowStock;
        if (availability === 'OUT_OF_STOCK') return !hasSaleableStock;
        if (availability === 'OPEN_NOW') return product.vendorAvailability.isOpen;
        if (availability === 'BACKORDER') return product.variants.some(variant => variant.allowBackorders);
        return true;
    }

    private catalogProductHasSaleableStock(product: SearchableCatalogProduct) {
        if (['DIGITAL', 'SERVICE'].includes(this.normalizeCode(product.productType) ?? '')) return true;
        return product.variants.some(variant => variant.saleableStock > 0);
    }

    private matchesCatalogProductSearch(product: SearchableCatalogProduct, terms: string[]) {
        if (!terms.length) return true;
        const text = this.catalogProductSearchText(product);
        return terms.every(term => text.includes(term));
    }

    private sortCatalogProducts<T extends SearchableCatalogProduct>(
        products: T[],
        sort: MarketplaceCatalogProductSort,
        terms: string[],
    ): T[] {
        const sorted = [...products];
        if (sort === 'POPULARITY') return sorted.sort((left, right) => this.comparePopularity(left, right));
        if (sort === 'NEWEST') return sorted.sort((left, right) => this.compareNewest(left, right));
        if (sort === 'PRICE_ASC') return sorted.sort((left, right) => left.minPrice - right.minPrice || this.comparePopularity(left, right));
        if (sort === 'PRICE_DESC') return sorted.sort((left, right) => right.minPrice - left.minPrice || this.comparePopularity(left, right));
        if (sort === 'RATING') return sorted.sort((left, right) => this.compareRating(left, right));
        if (sort === 'FASTEST_DELIVERY') {
            return sorted.sort((left, right) => {
                const leftDays = left.deliveryMinDays ?? Number.MAX_SAFE_INTEGER;
                const rightDays = right.deliveryMinDays ?? Number.MAX_SAFE_INTEGER;
                return leftDays - rightDays
                    || (left.deliveryMaxDays ?? Number.MAX_SAFE_INTEGER) - (right.deliveryMaxDays ?? Number.MAX_SAFE_INTEGER)
                    || this.comparePopularity(left, right);
            });
        }
        return sorted.sort((left, right) => (
            this.searchScore(right, terms) - this.searchScore(left, terms)
            || this.comparePopularity(left, right)
            || this.compareNewest(left, right)
        ));
    }

    private normalizeCatalogSort(sort?: string): MarketplaceCatalogProductSort {
        const normalized = this.normalizeCode(sort);
        if (normalized === 'POPULARITY' || normalized === 'NEWEST' || normalized === 'PRICE_ASC'
            || normalized === 'PRICE_DESC' || normalized === 'RATING' || normalized === 'FASTEST_DELIVERY') {
            return normalized;
        }
        if (normalized === 'PRICE_LOW_TO_HIGH') return 'PRICE_ASC';
        if (normalized === 'PRICE_HIGH_TO_LOW') return 'PRICE_DESC';
        if (normalized === 'FASTEST' || normalized === 'DELIVERY') return 'FASTEST_DELIVERY';
        return 'RELEVANCE';
    }

    private comparePopularity(left: SearchableCatalogProduct, right: SearchableCatalogProduct) {
        return right.ratingCount - left.ratingCount
            || (right.ratingAverage ?? 0) - (left.ratingAverage ?? 0)
            || this.compareNewest(left, right);
    }

    private compareRating(left: SearchableCatalogProduct, right: SearchableCatalogProduct) {
        return (right.ratingAverage ?? 0) - (left.ratingAverage ?? 0)
            || right.ratingCount - left.ratingCount
            || this.compareNewest(left, right);
    }

    private compareNewest(left: SearchableCatalogProduct, right: SearchableCatalogProduct) {
        return right.createdAt.getTime() - left.createdAt.getTime();
    }

    private searchScore(product: SearchableCatalogProduct, terms: string[]) {
        if (!terms.length) return 0;
        const weightedFields = [
            { value: product.name, weight: 50 },
            { value: product.vendorName, weight: 35 },
            { value: product.categoryName, weight: 30 },
            { value: product.location, weight: 20 },
            { value: product.productType, weight: 18 },
            { value: this.catalogProductTagText(product), weight: 15 },
            { value: product.description, weight: 8 },
        ];
        return terms.reduce((score, term) => {
            return score + weightedFields.reduce((fieldScore, field) => (
                fieldScore + (field.value.toLowerCase().includes(term) ? field.weight : 0)
            ), 0);
        }, 0);
    }

    private catalogProductSearchText(product: SearchableCatalogProduct) {
        return [
            product.name,
            product.slug,
            product.description,
            product.vendorName,
            product.vendorSlug,
            product.categoryCode,
            product.categoryName,
            product.productType,
            product.location,
            ...(product.vendorLocations ?? []),
            product.deliveryProfileName,
            this.catalogProductTagText(product),
            this.catalogProductAttributeText(product.metadata.attributes),
        ].filter(Boolean).join(' ').toLowerCase();
    }

    private catalogProductLocationText(product: SearchableCatalogProduct) {
        return [
            product.location,
            ...(product.vendorLocations ?? []),
            product.metadata.attributes?.serviceArea,
            product.metadata.attributes?.venue,
            product.metadata.attributes?.deliveryMode,
        ].filter(Boolean).join(' ').toLowerCase();
    }

    private catalogProductTagText(product: SearchableCatalogProduct) {
        return [
            ...(product.metadata.tags ?? []),
            this.catalogProductAttributeText(product.metadata.attributes),
        ].join(' ').toLowerCase();
    }

    private catalogProductAttributeText(attributes?: Record<string, unknown>) {
        return Object.entries(attributes ?? {})
            .flatMap(([key, value]) => [key, this.attributeValueText(value)])
            .join(' ');
    }

    private attributeValueText(value: unknown): string {
        if (Array.isArray(value)) return value.map(item => this.attributeValueText(item)).join(' ');
        if (value && typeof value === 'object') return Object.values(value).map(item => this.attributeValueText(item)).join(' ');
        return value == null ? '' : String(value);
    }

    private searchTerms(term?: string) {
        return (term ?? '')
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .filter(Boolean);
    }

    private cleanText(value?: unknown) {
        return typeof value === 'string' && value.trim() ? value.trim() : undefined;
    }

    private normalizeCode(value?: unknown) {
        const text = this.cleanText(value);
        return text ? text.replace(/[\s-]+/g, '_').toUpperCase() : undefined;
    }

    private nonNegativeFiniteNumber(value: unknown) {
        return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    }

    private parseFilterDate(value: unknown, endOfDay = false) {
        if (value instanceof Date && Number.isFinite(value.getTime())) return value;
        const text = this.cleanText(value);
        if (!text) return undefined;
        const date = new Date(text);
        if (!Number.isFinite(date.getTime())) return undefined;
        if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(text)) {
            date.setUTCHours(23, 59, 59, 999);
        }
        return date;
    }

    private async resolveProductDeliveryProfile(
        ctx: RequestContext,
        vendor: VendorProfile,
        profileId: string | undefined,
        productType: string,
    ): Promise<MarketplaceDeliveryProfile | undefined> {
        if (!['PHYSICAL', 'PERISHABLE'].includes(this.normalizeCode(productType) ?? '')) return undefined;
        const container = await this.connection.getRepository(ctx, VendorShippingProfile).findOne({
            where: { vendorProfileId: String(vendor.id) },
        });
        const profiles = this.deliveryProfilesFromContainer(container);
        if (!profiles.length) return undefined;
        const selected = profiles.find(profile => profile.id === profileId)
            ?? profiles.find(profile => profile.id === container?.defaultProfileId)
            ?? profiles[0];
        return selected?.enabled ? selected : undefined;
    }

    private deliveryProfilesFromContainer(container: VendorShippingProfile | null): MarketplaceDeliveryProfile[] {
        if (!container) return [];
        if (container.deliveryProfiles?.length) return container.deliveryProfiles;
        return [{
            id: container.defaultProfileId ?? 'legacy-standard-delivery',
            name: 'Standard delivery',
            enabled: true,
            mode: container.mode,
            flatRate: container.flatRate,
            fallbackEnabled: true,
            fallbackRate: container.fallbackRate,
            processingDays: container.processingDays,
            defaultMinDeliveryDays: container.defaultMinDeliveryDays,
            defaultMaxDeliveryDays: container.defaultMaxDeliveryDays,
            zones: container.zones ?? [],
        }];
    }

    private async getActiveVendor(ctx: RequestContext) {
        const vendor = await this.getVendorWorkspace(ctx);
        if (vendor.paused) throw new Error('This vendor shop is currently paused');
        return vendor;
    }

    private assertVendorCanUseSchema(vendor: VendorProfile, schema: MarketplaceResolvedFormSchema) {
        const allowedTypes = this.vendorAllowedListingTypes(vendor);
        if (schema.formTemplate.key === 'custom_digital_project' && allowedTypes?.has('DIGITAL_PRODUCT')) return;
        if (allowedTypes && !allowedTypes.has(schema.formTemplate.listingType)) {
            throw new Error(`Your approved vendor categories do not include ${schema.formTemplate.name} listings`);
        }
    }

    private vendorAllowedListingTypes(vendor: VendorProfile) {
        return resolveVendorAllowedListingTypes(vendor.categories);
    }

    private async getVendorWorkspace(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new Error('This account is not connected to an approved vendor channel');
        await this.marketplaceVendorEnforcementService.refreshVendor(ctx, vendor);
        return vendor;
    }

    private async getOwnedProduct(ctx: RequestContext, id: string | number, vendor: VendorProfile) {
        const product = await this.productService.findOne(ctx, id, [
            'featuredAsset',
            'assets',
            'assets.asset',
            'optionGroups',
            'optionGroups.options',
        ]);
        const ownerId = String((product?.customFields as Record<string, unknown> | undefined)?.vendorProfileId ?? '');
        if (!product || ownerId !== String(vendor.id)) {
            throw new Error('Product not found in this vendor catalog');
        }
        return product;
    }

    private buildMetadata(
        input: CreateMarketplaceProductInput,
        resolved: { category: MarketplaceResolvedFormSchema['category']; schema: MarketplaceResolvedFormSchema; fieldValues: Record<string, unknown> },
        shippingProfileId?: string,
    ): StoredMarketplaceMetadata {
        return {
            brand: input.brand?.trim() || undefined,
            tags: (input.tags ?? []).map(tag => tag.trim()).filter(Boolean).slice(0, 20),
            attributes: resolved.fieldValues,
            stylingVideoUrl: input.stylingVideoUrl?.trim() || undefined,
            deliveryInformation: input.deliveryInformation?.trim() || undefined,
            shippingProfileId,
            returnPolicy: input.returnPolicy?.trim() || undefined,
            disclaimer: input.disclaimer?.trim() || undefined,
            seo: {
                title: input.seoTitle?.trim() || undefined,
                description: input.seoDescription?.trim() || undefined,
            },
            variantDetails: Object.fromEntries(input.variants.map(variant => [variant.sku.trim(), {
                compareAtPrice: variant.compareAtPrice,
                imageAssetId: variant.imageAssetId,
                barcode: variant.barcode?.trim() || undefined,
                weightGrams: variant.weightGrams,
            }])),
            categoryId: String(resolved.category.id),
            categoryCode: resolved.category.code,
            categoryName: resolved.category.name,
            categoryBreadcrumb: resolved.schema.category.breadcrumb,
            formTemplateKey: resolved.schema.formTemplate.key,
            schemaVersion: resolved.schema.formTemplate.version,
        };
    }

    private async syncStructuredListingRecords(
        ctx: RequestContext,
        productId: string,
        input: CreateMarketplaceProductInput,
        resolved: { category: MarketplaceResolvedFormSchema['category']; schema: MarketplaceResolvedFormSchema; fieldValues: Record<string, unknown> },
    ) {
        const listingCategoryRepository = this.connection.getRepository(ctx, MarketplaceListingCategory);
        const secondaryIds = [...new Set((input.secondaryCategoryIds ?? []).map(String))]
            .filter(id => id !== String(resolved.category.id));
        const secondaryCategories = [];
        for (const categoryId of secondaryIds) {
            secondaryCategories.push(await this.marketplaceCategoryService.resolveCategory(ctx, categoryId, undefined, true));
        }
        await listingCategoryRepository.delete({ productId });
        await listingCategoryRepository.save([
            new MarketplaceListingCategory({ productId, categoryId: String(resolved.category.id), isPrimary: true }),
            ...secondaryCategories.map(category => new MarketplaceListingCategory({
                productId,
                categoryId: String(category.id),
                isPrimary: false,
            })),
        ]);

        const fieldValueRepository = this.connection.getRepository(ctx, MarketplaceListingFieldValue);
        await fieldValueRepository.delete({ productId });
        const fieldValues = Object.entries(resolved.fieldValues).map(([fieldKey, value]) => {
            const entity = new MarketplaceListingFieldValue();
            entity.productId = productId;
            entity.fieldKey = fieldKey;
            entity.value = value;
            entity.schemaVersion = resolved.schema.formTemplate.version;
            return entity;
        });
        if (fieldValues.length) await fieldValueRepository.save(fieldValues);

        const servicePackageRepository = this.connection.getRepository(ctx, MarketplaceServicePackage);
        await servicePackageRepository.delete({ productId });
        const servicePackages = [
            ...(input.servicePackages ?? []).map((item, index) => new MarketplaceServicePackage({
                productId,
                kind: 'PACKAGE',
                name: item.name.trim(),
                description: item.description?.trim() || undefined,
                inclusions: item.inclusions?.map(value => value.trim()).filter(Boolean),
                price: item.price,
                durationMinutes: item.durationMinutes,
                sortOrder: index,
            })),
            ...(input.serviceAddOns ?? []).map((item, index) => new MarketplaceServicePackage({
                productId,
                kind: 'ADD_ON',
                name: item.name.trim(),
                description: item.description?.trim() || undefined,
                inclusions: item.inclusions?.map(value => value.trim()).filter(Boolean),
                price: item.price,
                durationMinutes: item.durationMinutes,
                sortOrder: index,
            })),
        ];
        if (servicePackages.length) await servicePackageRepository.save(servicePackages);

        const sessionRepository = this.connection.getRepository(ctx, MarketplaceAvailabilitySession);
        const existingSessions = await sessionRepository.find({ where: { productId } });
        const existingById = new Map(existingSessions.map(session => [String(session.id), session]));
        const submittedIds = new Set((input.availabilitySessions ?? [])
            .map(item => item.id == null ? '' : String(item.id))
            .filter(Boolean));
        const removedWithBookings = existingSessions.find(session => session.bookedCount > 0 && !submittedIds.has(String(session.id)));
        if (removedWithBookings) throw new Error('A class or session with enrolled customers cannot be removed');
        const removableIds = existingSessions
            .filter(session => session.bookedCount === 0 && !submittedIds.has(String(session.id)))
            .map(session => String(session.id));
        if (removableIds.length) await sessionRepository.delete(removableIds);
        const sessions = (input.availabilitySessions ?? []).map(item => {
            const existing = item.id ? existingById.get(String(item.id)) : undefined;
            if (existing && item.capacity < existing.bookedCount) {
                throw new Error('Class capacity cannot be lower than the number of enrolled or reserved places');
            }
            return new MarketplaceAvailabilitySession({
            id: existing?.id,
            productId,
            startsAt: new Date(item.startsAt),
            endsAt: new Date(item.endsAt),
            name: item.name?.trim() || undefined,
            scheduleType: item.scheduleType ?? 'ONE_TIME',
            daysOfWeek: item.daysOfWeek?.map(day => day.trim()).filter(Boolean),
            startTime: item.startTime?.trim() || undefined,
            endTime: item.endTime?.trim() || undefined,
            price: item.price,
            oneDayPrice: item.oneDayPrice,
            earlyBirdPrice: item.earlyBirdPrice,
            earlyBirdEndsAt: item.earlyBirdEndsAt ? new Date(item.earlyBirdEndsAt) : undefined,
            gracePeriodDays: item.gracePeriodDays ?? 5,
            isActive: item.isActive !== false,
            capacity: item.capacity,
            bookedCount: existing?.bookedCount ?? 0,
            bookingDeadline: item.bookingDeadline ? new Date(item.bookingDeadline) : undefined,
            recurrenceGroupId: item.recurrenceGroupId?.trim() || undefined,
        });
        });
        if (sessions.length) await sessionRepository.save(sessions);

        const ticketRepository = this.connection.getRepository(ctx, MarketplaceEventTicketType);
        const existingTickets = await ticketRepository.find({ where: { productId } });
        if (existingTickets.some(ticket => ticket.soldCount > 0) && input.eventTicketTypes) {
            throw new Error('Ticket types with sales cannot be replaced; create a new ticket tier instead');
        }
        await ticketRepository.delete({ productId });
        const tickets = (input.eventTicketTypes ?? []).map((item, index) => new MarketplaceEventTicketType({
            productId,
            name: item.name.trim(),
            price: item.price,
            quantity: item.quantity,
            soldCount: 0,
            saleStartsAt: item.saleStartsAt ? new Date(item.saleStartsAt) : undefined,
            saleEndsAt: item.saleEndsAt ? new Date(item.saleEndsAt) : undefined,
            rules: { overbookingAllowed: false, ...(item.rules ?? {}) },
            sortOrder: index,
        }));
        if (tickets.length) await ticketRepository.save(tickets);

        const scheduleRepository = this.connection.getRepository(ctx, MarketplaceEventScheduleItem);
        await scheduleRepository.delete({ productId });
        const schedule = (input.eventScheduleItems ?? []).map((item, index) => new MarketplaceEventScheduleItem({
            productId,
            name: item.name.trim(),
            startsAt: new Date(item.startsAt),
            endsAt: new Date(item.endsAt),
            personName: item.personName?.trim() || undefined,
            location: item.location?.trim() || undefined,
            description: item.description?.trim() || undefined,
            sortOrder: index,
        }));
        if (schedule.length) await scheduleRepository.save(schedule);

        const digitalFileRepository = this.connection.getRepository(ctx, MarketplaceDigitalFile);
        const existingFiles = await digitalFileRepository.find({ where: { productId } });
        const existingByStorageKey = new Map(existingFiles.map(file => [file.storageKey, file]));
        await digitalFileRepository.delete({ productId });
        const files = (input.digitalFiles ?? []).map(item => {
            const existing = existingByStorageKey.get(item.storageKey);
            const file = new MarketplaceDigitalFile({
                productId,
                kind: item.kind ?? 'MAIN',
                fileName: item.fileName.trim(),
                storageKey: item.storageKey.trim(),
                mimeType: item.mimeType.trim(),
                sizeBytes: item.sizeBytes,
                checksum: item.checksum?.trim() || undefined,
                isPrivate: item.isPrivate !== false,
                scanStatus: existing?.scanStatus ?? 'PENDING',
                integrityStatus: existing?.integrityStatus ?? 'PENDING',
                downloadLimit: item.downloadLimit,
                expiresAt: item.expiresAt ? new Date(item.expiresAt) : undefined,
            });
            file.metadata = item.metadata;
            return file;
        });
        if (files.length) await digitalFileRepository.save(files);
    }

    private async loadStructuredListingRecords(ctx: RequestContext, productId: string) {
        const [fieldValues, servicePackages, availabilitySessions, eventTicketTypes, eventScheduleItems, digitalFiles] = await Promise.all([
            this.connection.getRepository(ctx, MarketplaceListingFieldValue).find({ where: { productId }, order: { id: 'ASC' } }),
            this.connection.getRepository(ctx, MarketplaceServicePackage).find({ where: { productId }, order: { sortOrder: 'ASC' } }),
            this.connection.getRepository(ctx, MarketplaceAvailabilitySession).find({ where: { productId }, order: { startsAt: 'ASC' } }),
            this.connection.getRepository(ctx, MarketplaceEventTicketType).find({ where: { productId }, order: { sortOrder: 'ASC' } }),
            this.connection.getRepository(ctx, MarketplaceEventScheduleItem).find({ where: { productId }, order: { sortOrder: 'ASC' } }),
            this.connection.getRepository(ctx, MarketplaceDigitalFile).find({ where: { productId }, order: { id: 'ASC' } }),
        ]);
        return {
            fieldValues: Object.fromEntries(fieldValues.map(item => [item.fieldKey, item.value])),
            servicePackages: servicePackages.filter(item => item.kind === 'PACKAGE'),
            serviceAddOns: servicePackages.filter(item => item.kind === 'ADD_ON'),
            availabilitySessions,
            eventTicketTypes,
            eventScheduleItems,
            digitalFiles: digitalFiles.map(file => ({
                id: String(file.id),
                kind: file.kind,
                fileName: file.fileName,
                storageKey: file.storageKey,
                mimeType: file.mimeType,
                sizeBytes: file.sizeBytes,
                checksum: file.checksum,
                isPrivate: file.isPrivate,
                scanStatus: file.scanStatus,
                integrityStatus: file.integrityStatus,
                downloadLimit: file.downloadLimit,
                expiresAt: file.expiresAt,
                metadata: file.metadata,
            })),
        };
    }

    private parseMetadata(value: unknown): StoredMarketplaceMetadata & Record<string, unknown> {
        if (typeof value !== 'string' || !value) {
            return { tags: [], attributes: {}, seo: {}, variantDetails: {} };
        }
        try {
            return JSON.parse(value) as StoredMarketplaceMetadata & Record<string, unknown>;
        } catch {
            return { tags: [], attributes: {}, seo: {}, variantDetails: {} };
        }
    }

    private inputInventorySettings(input: MarketplaceProductVariantInput): VariantInventorySettings {
        return this.validateInventorySettings(input);
    }

    private variantInventorySettings(variant: ProductVariant): VariantInventorySettings {
        const fields = variant.customFields as Record<string, unknown>;
        const lowStockThreshold = this.nonNegativeInteger(fields?.lowStockThreshold, 5);
        const allowBackorders = fields?.allowBackorders === true;
        const backorderLimit = allowBackorders ? this.nonNegativeInteger(fields?.backorderLimit, 0) : 0;
        return {
            lowStockThreshold,
            allowBackorders,
            backorderLimit,
            maxOrderQuantity: this.nonNegativeInteger(fields?.maxOrderQuantity, 0),
        };
    }

    private validateInventorySettings(input: Partial<MarketplaceProductVariantInput | MarketplaceInventoryUpdateInput>): VariantInventorySettings {
        const lowStockThreshold = input.lowStockThreshold ?? 5;
        const allowBackorders = input.allowBackorders === true;
        const backorderLimit = input.backorderLimit ?? 0;
        const maxOrderQuantity = input.maxOrderQuantity ?? 0;
        if (!Number.isInteger(lowStockThreshold) || lowStockThreshold < 0 || lowStockThreshold > 1_000_000) {
            throw new Error('Low-stock alert level must be a whole number between 0 and 1,000,000');
        }
        if (!Number.isInteger(backorderLimit) || backorderLimit < 0 || backorderLimit > 1_000_000) {
            throw new Error('Backorder limit must be a whole number between 0 and 1,000,000');
        }
        if (!Number.isInteger(maxOrderQuantity) || maxOrderQuantity < 0 || maxOrderQuantity > 1_000_000) {
            throw new Error('Maximum order quantity must be a whole number between 0 and 1,000,000');
        }
        return {
            lowStockThreshold,
            allowBackorders,
            backorderLimit: allowBackorders ? backorderLimit : 0,
            maxOrderQuantity,
        };
    }

    private outOfStockThreshold(input: MarketplaceProductVariantInput): number {
        const settings = this.inputInventorySettings(input);
        return settings.allowBackorders ? -settings.backorderLimit : 0;
    }

    private nonNegativeInteger(value: unknown, fallback: number): number {
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
    }

    private numberAttribute(attributes: Record<string, unknown> | undefined, key: string) {
        const value = attributes?.[key];
        return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
    }

    private dateAttribute(attributes: Record<string, unknown> | undefined, key: string) {
        const value = attributes?.[key];
        if (typeof value !== 'string' || !value) return undefined;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date : undefined;
    }

    private variantAvailabilityEndsAt(variant: ProductVariant) {
        const value = (variant.customFields as Record<string, unknown> | undefined)?.availabilityEndsAt;
        if (value instanceof Date) return value.toISOString();
        if (typeof value !== 'string' || !value) return undefined;
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
    }

    private combinedDateTimeAttribute(
        attributes: Record<string, unknown> | undefined,
        dateKey: string,
        timeKey: string,
    ) {
        const dateValue = attributes?.[dateKey];
        const timeValue = attributes?.[timeKey];
        if (typeof dateValue !== 'string' || typeof timeValue !== 'string') return undefined;
        const date = new Date(`${dateValue.slice(0, 10)}T${timeValue.slice(0, 5)}:00+05:00`);
        return Number.isFinite(date.getTime()) ? date : undefined;
    }
}
