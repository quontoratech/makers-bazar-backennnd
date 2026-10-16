import { Injectable } from '@nestjs/common';
import {
    Product,
    ProductVariant,
    RequestContext,
    RequestContextService,
    ShippingMethod,
    TransactionalConnection,
} from '@vendure/core';
import { randomUUID } from 'node:crypto';
import { In, IsNull } from 'typeorm';

import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { getMarketplaceVendorAvailability } from '../../vendor/vendor-availability';
import { MarketplaceVendorEnforcementService } from '../../report/services/marketplace-vendor-enforcement.service';
import {
    MarketplaceDeliveryProfileInput,
    MarketplaceShippingDestinationInput,
    MarketplaceShippingQuoteItemInput,
    MarketplaceShippingZoneInput,
    UpdateMarketplaceShippingProfileInput,
} from '../dto/vendor-shipping.inputs';
import {
    MarketplaceDeliveryProfile,
    MarketplaceShippingZoneRule,
    VendorShippingProfile,
} from '../entities/vendor-shipping-profile.entity';
import {
    DEFAULT_MARKETPLACE_SHIPPING_RATE,
    MARKETPLACE_SHIPPING_CALCULATOR_CODE,
    MarketplaceShippingMode,
    marketplaceShippingModes,
} from '../shipping.constants';

interface CalculatedShippingRate {
    vendorId: string;
    vendorName: string;
    profileId: string;
    profileName: string;
    productNames: string[];
    mode: MarketplaceShippingMode;
    ruleName: string;
    rate: number;
    processingDays: number;
    minDeliveryDays: number;
    maxDeliveryDays: number;
}

interface ShippingProductReference {
    name: string;
    shippingProfileId?: string;
    productType: string;
}

@Injectable()
export class MarketplaceShippingService {
    constructor(
        private connection: TransactionalConnection,
        private requestContextService: RequestContextService,
        private marketplaceVendorEnforcementService: MarketplaceVendorEnforcementService,
    ) {}

    async getMyProfile(ctx: RequestContext) {
        const vendor = await this.activeVendor(ctx);
        return this.getOrCreateForVendor(ctx, vendor);
    }

    async updateMyProfile(ctx: RequestContext, input: UpdateMarketplaceShippingProfileInput) {
        const vendor = await this.activeVendor(ctx);
        const profile = await this.getOrCreateForVendor(ctx, vendor);
        const validated = this.validateInput(input);
        await this.assertAssignedProfilesRemainAvailable(ctx, vendor, profile.deliveryProfiles ?? [], validated.deliveryProfiles);

        profile.defaultProfileId = validated.defaultProfileId;
        profile.deliveryProfiles = validated.deliveryProfiles;
        this.copyLegacyFields(profile, validated.deliveryProfiles.find(item => item.id === validated.defaultProfileId)!);
        await this.connection.getRepository(ctx, VendorShippingProfile).save(profile, { reload: false });
        await this.syncShippingMethod(ctx, vendor, profile);
        return this.getOrCreateForVendor(ctx, vendor);
    }

    async validateProductProfile(
        ctx: RequestContext,
        vendor: VendorProfile,
        profileId?: string,
    ): Promise<MarketplaceDeliveryProfile> {
        const container = await this.getOrCreateForVendor(ctx, vendor);
        const selectedId = profileId?.trim() || container.defaultProfileId;
        const profile = (container.deliveryProfiles ?? []).find(item => item.id === selectedId);
        if (!profile) throw new Error('Choose a valid delivery profile for this product');
        if (!profile.enabled) throw new Error(`${profile.name} is inactive and cannot be assigned to a product`);
        return profile;
    }

    async getOrCreateForVendor(ctx: RequestContext, vendor: VendorProfile) {
        const repository = this.connection.getRepository(ctx, VendorShippingProfile);
        const existing = await repository.findOne({ where: { vendorProfileId: String(vendor.id) } });
        if (existing) {
            if (!existing.deliveryProfiles?.length) {
                const migrated = this.profileFromLegacy(existing, 'Standard delivery');
                existing.deliveryProfiles = [migrated];
                existing.defaultProfileId = migrated.id;
                await repository.save(existing, { reload: false });
            }
            return existing;
        }

        const localCities = this.vendorOperatingCities(vendor);
        const deliveryProfile: MarketplaceDeliveryProfile = {
            id: randomUUID(),
            name: localCities.length ? 'Local and nationwide delivery' : 'Standard delivery',
            description: 'Default delivery profile for new products',
            enabled: true,
            mode: localCities.length ? 'ZONE_BASED' : 'FLAT_RATE',
            flatRate: DEFAULT_MARKETPLACE_SHIPPING_RATE,
            fallbackEnabled: true,
            fallbackRate: DEFAULT_MARKETPLACE_SHIPPING_RATE,
            processingDays: 1,
            defaultMinDeliveryDays: 3,
            defaultMaxDeliveryDays: 5,
            zones: localCities.length ? [{
                id: randomUUID(),
                name: 'Free local delivery',
                cities: localCities,
                provinces: [],
                postalCodes: [],
                rate: 0,
                minDeliveryDays: 1,
                maxDeliveryDays: 2,
                enabled: true,
            }] : [],
        };
        return repository.save(new VendorShippingProfile({
            vendorProfileId: String(vendor.id),
            shippingMethodId: undefined,
            mode: deliveryProfile.mode,
            flatRate: deliveryProfile.flatRate,
            fallbackRate: deliveryProfile.fallbackRate,
            processingDays: deliveryProfile.processingDays,
            defaultMinDeliveryDays: deliveryProfile.defaultMinDeliveryDays,
            defaultMaxDeliveryDays: deliveryProfile.defaultMaxDeliveryDays,
            zones: deliveryProfile.zones,
            defaultProfileId: deliveryProfile.id,
            deliveryProfiles: [deliveryProfile],
        }));
    }

    async attachShippingMethod(
        ctx: RequestContext,
        vendor: VendorProfile,
        shippingMethodId: string,
    ) {
        const profile = await this.getOrCreateForVendor(ctx, vendor);
        profile.shippingMethodId = shippingMethodId;
        await this.connection.getRepository(ctx, VendorShippingProfile).save(profile, { reload: false });
        return profile;
    }

    async calculateRate(
        ctx: RequestContext,
        vendorProfileId: string,
        destination: MarketplaceShippingDestinationInput,
        deliveryProfileId?: string,
        productNames: string[] = [],
        containsPerishable = false,
    ): Promise<CalculatedShippingRate> {
        await this.marketplaceVendorEnforcementService.releaseExpiredRestrictions(ctx);
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { id: vendorProfileId },
        });
        if (!vendor || vendor.status !== 'APPROVED' || vendor.paused) {
            throw new Error('This vendor is not currently available for delivery');
        }
        const availability = getMarketplaceVendorAvailability(vendor);
        if (containsPerishable && !availability.acceptsPerishableOrders) {
            const reason = availability.reason ? `: ${availability.reason}` : '';
            throw new Error(`${vendor.shopName} is ${availability.label.toLowerCase()}${reason}. Perishable items cannot be ordered until the shop reopens.`);
        }
        const container = await this.getOrCreateForVendor(ctx, vendor);
        const selectedId = deliveryProfileId || container.defaultProfileId;
        const profile = (container.deliveryProfiles ?? []).find(item => item.id === selectedId);
        if (!profile || !profile.enabled) {
            throw new Error('The selected product delivery profile is no longer available');
        }
        const common = {
            vendorId: String(vendor.id),
            vendorName: vendor.shopName,
            profileId: profile.id,
            profileName: profile.name,
            productNames: this.cleanProductNames(productNames),
            mode: profile.mode,
            processingDays: profile.processingDays,
        };

        if (profile.mode === 'FREE') {
            return {
                ...common,
                ruleName: 'Free delivery',
                rate: 0,
                minDeliveryDays: profile.defaultMinDeliveryDays,
                maxDeliveryDays: profile.defaultMaxDeliveryDays,
            };
        }
        if (profile.mode === 'FLAT_RATE') {
            return {
                ...common,
                ruleName: 'Flat-rate delivery',
                rate: profile.flatRate,
                minDeliveryDays: profile.defaultMinDeliveryDays,
                maxDeliveryDays: profile.defaultMaxDeliveryDays,
            };
        }

        const zone = (profile.zones ?? []).find(rule => rule.enabled && this.matchesZone(rule, destination));
        if (zone) {
            return {
                ...common,
                ruleName: zone.name,
                rate: zone.rate,
                minDeliveryDays: zone.minDeliveryDays,
                maxDeliveryDays: zone.maxDeliveryDays,
            };
        }
        if (!profile.fallbackEnabled) {
            throw new Error(`${profile.name} is not available for delivery to ${destination.city.trim()}`);
        }
        return {
            ...common,
            ruleName: 'Outside configured delivery zones',
            rate: profile.fallbackRate,
            minDeliveryDays: profile.defaultMinDeliveryDays,
            maxDeliveryDays: profile.defaultMaxDeliveryDays,
        };
    }

    async calculateVendorOrderRate(
        ctx: RequestContext,
        vendorProfileId: string,
        destination: MarketplaceShippingDestinationInput,
        products: ShippingProductReference[],
    ): Promise<CalculatedShippingRate & { breakdown: CalculatedShippingRate[] }> {
        const groups = this.groupProductReferences(products);
        if (!groups.size) {
            const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: vendorProfileId } });
            if (!vendor) throw new Error('This vendor is not currently available');
            return {
                vendorId: String(vendor.id),
                vendorName: vendor.shopName,
                profileId: 'non-shippable',
                profileName: 'No physical delivery',
                productNames: [],
                mode: 'FREE',
                ruleName: 'Digital or venue delivery',
                rate: 0,
                processingDays: 0,
                minDeliveryDays: 0,
                maxDeliveryDays: 0,
                breakdown: [],
            };
        }
        const rates = await Promise.all([...groups.values()].map(group => this.calculateRate(
            ctx,
            vendorProfileId,
            destination,
            group.profileId || undefined,
            [...group.productNames],
            group.containsPerishable,
        )));
        const first = rates[0]!;
        return {
            ...first,
            profileId: rates.map(item => item.profileId).join(','),
            profileName: rates.length === 1 ? first.profileName : `${rates.length} delivery profiles`,
            productNames: [...new Set(rates.flatMap(item => item.productNames))],
            ruleName: rates.length === 1 ? first.ruleName : rates.map(item => `${item.profileName}: ${item.ruleName}`).join(' + '),
            rate: rates.reduce((total, item) => total + item.rate, 0),
            processingDays: Math.max(...rates.map(item => item.processingDays)),
            minDeliveryDays: Math.max(...rates.map(item => item.minDeliveryDays)),
            maxDeliveryDays: Math.max(...rates.map(item => item.maxDeliveryDays)),
            breakdown: rates,
        };
    }

    async quote(
        ctx: RequestContext,
        items: MarketplaceShippingQuoteItemInput[],
        destination: MarketplaceShippingDestinationInput,
    ) {
        const variantIds = [...new Set(items.map(item => String(item.variantId)).filter(Boolean))];
        if (!variantIds.length || !destination.city?.trim()) {
            throw new Error('At least one product and a delivery city are required');
        }
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(variantIds) },
            relations: ['product', 'product.translations'],
        });
        if (variants.length !== variantIds.length) {
            throw new Error('One or more products are no longer available');
        }

        const groups = new Map<string, { vendorId: string; profileId: string; productNames: Set<string>; containsPerishable: boolean }>();
        for (const variant of variants) {
            const customFields = variant.product.customFields as Record<string, unknown>;
            const vendorId = String(customFields?.vendorProfileId ?? '');
            if (!vendorId) continue;
            if (!['PHYSICAL', 'PERISHABLE'].includes(String(customFields?.marketplaceType ?? ''))) continue;
            const metadata = this.parseProductMetadata(customFields?.marketplaceMetadata);
            const profileId = String(metadata.shippingProfileId ?? '');
            const key = `${vendorId}:${profileId || 'default'}`;
            const productType = String(customFields?.marketplaceType ?? '');
            const group = groups.get(key) ?? { vendorId, profileId, productNames: new Set<string>(), containsPerishable: false };
            const productName = variant.product.name?.trim()
                || variant.product.translations?.find(translation => translation.languageCode === ctx.languageCode)?.name?.trim()
                || variant.product.translations?.[0]?.name?.trim()
                || variant.sku?.trim()
                || 'Product';
            group.productNames.add(productName);
            group.containsPerishable ||= productType === 'PERISHABLE';
            groups.set(key, group);
        }
        if (!groups.size) return { total: 0, currencyCode: 'PKR', items: [] };

        const quotes = await Promise.all([...groups.values()].map(group => this.calculateRate(
            ctx,
            group.vendorId,
            destination,
            group.profileId || undefined,
            [...group.productNames],
            group.containsPerishable,
        )));
        return {
            total: quotes.reduce((total, quote) => total + quote.rate, 0),
            currencyCode: 'PKR',
            items: quotes,
        };
    }

    async ensureShippingInfrastructure() {
        const ctx = await this.requestContextService.create({ apiType: 'admin' });
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find({
            where: { status: 'APPROVED' },
        });
        for (const vendor of vendors.filter(item => item.channelId)) {
            const profile = await this.getOrCreateForVendor(ctx, vendor);
            await this.syncShippingMethod(ctx, vendor, profile);
        }
    }

    private async syncShippingMethod(
        ctx: RequestContext,
        vendor: VendorProfile,
        profile: VendorShippingProfile,
    ) {
        if (!vendor.channelId) return;
        const repository = this.connection.rawConnection.getRepository(ShippingMethod);
        const methods = await repository.find({
            relations: ['channels'],
            where: { deletedAt: IsNull() },
        });
        const method = methods.find(candidate =>
            String(candidate.id) === String(profile.shippingMethodId ?? '')
            || candidate.channels.some(channel => String(channel.id) === String(vendor.channelId)),
        );
        if (!method) return;

        const calculator = {
            code: MARKETPLACE_SHIPPING_CALCULATOR_CODE,
            args: [{ name: 'vendorProfileId', value: String(vendor.id) }],
        };
        if (JSON.stringify(method.calculator) !== JSON.stringify(calculator)) {
            method.calculator = calculator;
            await repository.save(method, { reload: false });
        }
        if (String(profile.shippingMethodId ?? '') !== String(method.id)) {
            profile.shippingMethodId = String(method.id);
            await this.connection.getRepository(ctx, VendorShippingProfile).save(profile, { reload: false });
        }
    }

    private validateInput(input: UpdateMarketplaceShippingProfileInput) {
        if (!input.deliveryProfiles?.length) throw new Error('Add at least one delivery profile');
        if (input.deliveryProfiles.length > 20) throw new Error('A vendor can create at most 20 delivery profiles');
        const deliveryProfiles = input.deliveryProfiles.map((profile, index) => this.validateDeliveryProfile(profile, index));
        const ids = deliveryProfiles.map(profile => profile.id);
        if (new Set(ids).size !== ids.length) throw new Error('Delivery profile IDs must be unique');
        const names = deliveryProfiles.map(profile => profile.name.toLocaleLowerCase('en'));
        if (new Set(names).size !== names.length) throw new Error('Delivery profile names must be unique');
        const defaultProfile = deliveryProfiles.find(profile => profile.id === input.defaultProfileId);
        if (!defaultProfile) throw new Error('Choose a valid default delivery profile');
        if (!defaultProfile.enabled) throw new Error('The default delivery profile must be active');
        return { defaultProfileId: defaultProfile.id, deliveryProfiles };
    }

    private validateDeliveryProfile(input: MarketplaceDeliveryProfileInput, index: number): MarketplaceDeliveryProfile {
        const name = input.name?.trim();
        if (!name) throw new Error(`Delivery profile ${index + 1} requires a name`);
        if (name.length > 80) throw new Error(`${name} must use 80 characters or fewer`);
        if (!marketplaceShippingModes.includes(input.mode)) throw new Error(`${name} has an unknown pricing mode`);
        const defaultMinDeliveryDays = this.days(input.defaultMinDeliveryDays, `${name} minimum delivery days`);
        const defaultMaxDeliveryDays = this.days(input.defaultMaxDeliveryDays, `${name} maximum delivery days`);
        if (defaultMaxDeliveryDays < defaultMinDeliveryDays) {
            throw new Error(`${name} maximum delivery days cannot be less than its minimum`);
        }
        const zones = (input.zones ?? []).map((zone, zoneIndex) => this.validateZone(zone, zoneIndex));
        if (input.mode === 'ZONE_BASED' && !zones.some(zone => zone.enabled)) {
            throw new Error(`${name} requires at least one enabled delivery zone`);
        }
        this.assertUniqueCities(zones);
        return {
            id: input.id?.trim() || randomUUID(),
            name,
            description: input.description?.trim().slice(0, 240) || undefined,
            enabled: input.enabled !== false,
            mode: input.mode,
            flatRate: this.money(input.flatRate, `${name} flat delivery rate`),
            fallbackEnabled: input.fallbackEnabled !== false,
            fallbackRate: this.money(input.fallbackRate, `${name} outside-zone delivery rate`),
            processingDays: this.days(input.processingDays, `${name} processing days`, 0),
            defaultMinDeliveryDays,
            defaultMaxDeliveryDays,
            zones,
        };
    }

    private validateZone(zone: MarketplaceShippingZoneInput, index: number): MarketplaceShippingZoneRule {
        const name = zone.name?.trim();
        if (!name) throw new Error(`Delivery zone ${index + 1} requires a name`);
        const cities = this.cleanLocations(zone.cities);
        const provinces = this.cleanLocations(zone.provinces);
        const postalCodes = this.cleanLocations(zone.postalCodes, false);
        const enabled = zone.enabled !== false;
        if (enabled && !cities.length && !provinces.length && !postalCodes.length) {
            throw new Error(`${name} requires at least one city, province, or postal code`);
        }
        const minDeliveryDays = this.days(zone.minDeliveryDays, `${name} minimum delivery days`);
        const maxDeliveryDays = this.days(zone.maxDeliveryDays, `${name} maximum delivery days`);
        if (maxDeliveryDays < minDeliveryDays) {
            throw new Error(`${name} maximum delivery days cannot be less than its minimum`);
        }
        return {
            id: zone.id?.trim() || randomUUID(),
            name,
            cities,
            provinces,
            postalCodes,
            rate: this.money(zone.rate, `${name} rate`),
            minDeliveryDays,
            maxDeliveryDays,
            enabled,
        };
    }

    private async assertAssignedProfilesRemainAvailable(
        ctx: RequestContext,
        vendor: VendorProfile,
        current: MarketplaceDeliveryProfile[],
        next: MarketplaceDeliveryProfile[],
    ) {
        const unavailableIds = new Set(current
            .filter(profile => !next.some(item => item.id === profile.id && item.enabled))
            .map(profile => profile.id));
        if (!unavailableIds.size) return;
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { deletedAt: IsNull() },
            relations: ['translations'],
        });
        const assigned = products.find(product => {
            const customFields = product.customFields as Record<string, unknown>;
            if (String(customFields?.vendorProfileId ?? '') !== String(vendor.id)) return false;
            const metadata = this.parseProductMetadata(customFields?.marketplaceMetadata);
            return unavailableIds.has(String(metadata.shippingProfileId ?? ''));
        });
        if (assigned) {
            const metadata = this.parseProductMetadata((assigned.customFields as Record<string, unknown>)?.marketplaceMetadata);
            const profile = current.find(item => item.id === String(metadata.shippingProfileId));
            const productName = assigned.translations?.[0]?.name ?? 'an existing product';
            throw new Error(`${profile?.name ?? 'This delivery profile'} is assigned to ${productName}. Reassign the product before removing or disabling it.`);
        }
    }

    private copyLegacyFields(container: VendorShippingProfile, profile: MarketplaceDeliveryProfile) {
        container.mode = profile.mode;
        container.flatRate = profile.flatRate;
        container.fallbackRate = profile.fallbackRate;
        container.processingDays = profile.processingDays;
        container.defaultMinDeliveryDays = profile.defaultMinDeliveryDays;
        container.defaultMaxDeliveryDays = profile.defaultMaxDeliveryDays;
        container.zones = profile.zones;
    }

    private profileFromLegacy(container: VendorShippingProfile, name: string): MarketplaceDeliveryProfile {
        return {
            id: randomUUID(),
            name,
            description: 'Migrated from the original vendor-wide delivery settings',
            enabled: true,
            mode: container.mode,
            flatRate: container.flatRate,
            fallbackEnabled: true,
            fallbackRate: container.fallbackRate,
            processingDays: container.processingDays,
            defaultMinDeliveryDays: container.defaultMinDeliveryDays,
            defaultMaxDeliveryDays: container.defaultMaxDeliveryDays,
            zones: container.zones ?? [],
        };
    }

    private groupProductReferences(products: ShippingProductReference[]) {
        const groups = new Map<string, { profileId: string; productNames: Set<string>; containsPerishable: boolean }>();
        for (const product of products) {
            const profileId = product.shippingProfileId?.trim() ?? '';
            const key = profileId || 'default';
            const group = groups.get(key) ?? { profileId, productNames: new Set<string>(), containsPerishable: false };
            if (product.name) group.productNames.add(product.name);
            group.containsPerishable ||= product.productType === 'PERISHABLE';
            groups.set(key, group);
        }
        return groups;
    }

    private cleanProductNames(productNames: unknown[] = []) {
        return [...new Set(productNames
            .filter((name): name is string => typeof name === 'string')
            .map(name => name.trim())
            .filter(Boolean))];
    }

    private matchesZone(rule: MarketplaceShippingZoneRule, destination: MarketplaceShippingDestinationInput) {
        const city = this.normalizeLocation(destination.city);
        const province = this.normalizeLocation(destination.province ?? '');
        const postalCode = this.normalizePostalCode(destination.postalCode ?? '');
        const cityMatches = !rule.cities.length
            || rule.cities.some(value => this.normalizeLocation(value) === city);
        const provinceMatches = !rule.provinces.length
            || rule.provinces.some(value => this.normalizeLocation(value) === province);
        const postalMatches = !rule.postalCodes.length
            || rule.postalCodes.some(value => {
                const pattern = this.normalizePostalCode(value);
                return pattern.endsWith('*')
                    ? postalCode.startsWith(pattern.slice(0, -1))
                    : postalCode === pattern;
            });
        return cityMatches && provinceMatches && postalMatches;
    }

    private vendorOperatingCities(vendor: VendorProfile) {
        return this.cleanLocations((vendor.operatingLocations ?? []).flatMap(value => value.split(/[,/]/)));
    }

    private cleanLocations(values?: string[], normalize = true) {
        return [...new Set((values ?? [])
            .map(value => value.trim())
            .filter(Boolean)
            .map(value => normalize ? value.replace(/\s+/g, ' ') : value.replace(/\s+/g, '').toUpperCase()))];
    }

    private assertUniqueCities(zones: MarketplaceShippingZoneRule[]) {
        const owners = new Map<string, string>();
        for (const zone of zones.filter(item => item.enabled)) {
            for (const city of zone.cities) {
                const normalized = this.normalizeLocation(city);
                const existing = owners.get(normalized);
                if (existing) throw new Error(`${city} is included in both ${existing} and ${zone.name}`);
                owners.set(normalized, zone.name);
            }
        }
    }

    private parseProductMetadata(value: unknown): Record<string, unknown> {
        if (typeof value !== 'string' || !value) return {};
        try {
            return JSON.parse(value) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    private normalizeLocation(value: string) {
        return value.trim().toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim();
    }

    private normalizePostalCode(value: string) {
        return value.trim().toUpperCase().replace(/\s+/g, '');
    }

    private money(value: number, label: string) {
        if (!Number.isInteger(value) || value < 0 || value > 100_000_000) {
            throw new Error(`${label} must be between Rs 0 and Rs 1,000,000`);
        }
        return value;
    }

    private days(value: number, label: string, minimum = 1) {
        if (!Number.isInteger(value) || value < minimum || value > 60) {
            throw new Error(`${label} must be between ${minimum} and 60`);
        }
        return value;
    }

    private async activeVendor(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new Error('An active vendor workspace is required');
        await this.marketplaceVendorEnforcementService.refreshVendor(ctx, vendor);
        if (vendor.paused) throw new Error('An active vendor workspace is required');
        return vendor;
    }
}
