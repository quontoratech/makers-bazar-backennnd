import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { assertFound, ID, Product, RequestContext, TransactionalConnection } from '@vendure/core';
import { randomUUID } from 'node:crypto';

import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { RoleApplication } from '../../applications/entities/role-application.entity';
import { assertVendorApplicationEmailAllowed, normalizeVendorApplicationEmail } from '../../applications/vendor-email-block';
import { MarketplaceVendorEnforcementService } from '../../report/services/marketplace-vendor-enforcement.service';
import { MarketplaceReviewService } from '../../review/services/marketplace-review.service';
import { VendorProfile } from '../entities/vendor-profile.entity';
import { RegisterVendorInput, ReviewVendorInput, UpdateVendorStorefrontInput } from '../dto/vendor.inputs';
import {
    MarketplaceDiscoveryLocation,
    MarketplaceVendorServiceArea,
    MarketplaceVendorServiceAreaScope,
    vendorServesLocation,
} from '../vendor-location';
import { MarketplaceVendorUnavailableDate, MarketplaceVendorWeeklyHours } from '../vendor-availability';

@Injectable()
export class VendorService {
    constructor(
        private connection: TransactionalConnection,
        private marketplaceVendorEnforcementService: MarketplaceVendorEnforcementService,
        private marketplaceReviewService: MarketplaceReviewService,
    ) {}

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        status?: string,
    ): Promise<MarketplaceList<VendorProfile>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, VendorProfile).findAndCount({
            where: status ? { status: status as VendorProfile['status'] } : {},
            skip,
            take,
            order: { createdAt: 'DESC' },
        });
        return { items: await this.enrichVendors(ctx, items), totalItems };
    }

    findOne(ctx: RequestContext, id: ID): Promise<VendorProfile | null> {
        return this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id } })
            .then(vendor => vendor ? this.enrichVendor(ctx, vendor) : null);
    }

    findPublicBySlug(ctx: RequestContext, slug: string, location?: MarketplaceDiscoveryLocation): Promise<VendorProfile | null> {
        return this.findPublicVendor(ctx, { slug }, location);
    }

    findPublicById(ctx: RequestContext, id: ID, location?: MarketplaceDiscoveryLocation): Promise<VendorProfile | null> {
        return this.findPublicVendor(ctx, { id }, location);
    }

    private async findPublicVendor(
        ctx: RequestContext,
        identity: { slug: string } | { id: ID },
        location?: MarketplaceDiscoveryLocation,
    ) {
        await this.marketplaceVendorEnforcementService.releaseExpiredRestrictions(ctx);
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { ...identity, status: 'APPROVED', paused: false },
        });
        return vendor && vendorServesLocation(vendor, location) ? this.enrichVendor(ctx, vendor) : null;
    }

    async findPublic(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        location?: MarketplaceDiscoveryLocation,
    ): Promise<MarketplaceList<VendorProfile>> {
        await this.marketplaceVendorEnforcementService.releaseExpiredRestrictions(ctx);
        const { skip, take } = normalizeListOptions(options);
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find({
            where: { status: 'APPROVED', paused: false },
            order: { shopName: 'ASC' },
        });
        const matching = vendors.filter(vendor => vendorServesLocation(vendor, location));
        return { items: await this.enrichVendors(ctx, matching.slice(skip, skip + take)), totalItems: matching.length };
    }

    async findMine(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new Error('This account is not connected to an approved vendor shop');
        const refreshed = await this.marketplaceVendorEnforcementService.refreshVendor(ctx, vendor);
        return this.enrichVendor(ctx, refreshed);
    }

    async updateMine(ctx: RequestContext, input: UpdateVendorStorefrontInput) {
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const vendor = await this.marketplaceVendorEnforcementService.assertCanManageStore(ctx);

        if (input.featuredProductId !== undefined) {
            if (input.featuredProductId) {
                const product = await this.connection.getRepository(ctx, Product).findOne({
                    where: { id: input.featuredProductId },
                });
                const ownerId = String((product?.customFields as Record<string, unknown> | undefined)?.vendorProfileId ?? '');
                if (!product?.enabled || ownerId !== String(vendor.id)) {
                    throw new Error('Choose a published product from your own catalog');
                }
                vendor.featuredProductId = String(product.id);
            } else {
                vendor.featuredProductId = undefined;
            }
        }
        if (input.description !== undefined) vendor.description = this.cleanText(input.description, 4000);
        if (input.contactEmail !== undefined) {
            const contactEmail = this.cleanText(input.contactEmail, 255)?.toLowerCase();
            if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
                throw new Error('Enter a valid public contact email');
            }
            vendor.contactEmail = contactEmail;
        }
        if (input.phoneNumber !== undefined) vendor.phoneNumber = this.cleanText(input.phoneNumber, 80);
        if (input.logoAssetId !== undefined) vendor.logoAssetId = this.cleanText(input.logoAssetId, 120);
        if (input.bannerAssetId !== undefined) vendor.bannerAssetId = this.cleanText(input.bannerAssetId, 120);
        if (input.logoUrl !== undefined) vendor.logoUrl = this.cleanAssetUrl(input.logoUrl);
        if (input.bannerUrl !== undefined) vendor.bannerUrl = this.cleanAssetUrl(input.bannerUrl);
        if (input.policies !== undefined) {
            const policies = input.policies ?? {};
            vendor.policies = {
                shipping: this.cleanText(policies.shipping, 1500) ?? '',
                returns: this.cleanText(policies.returns, 1500) ?? '',
                cancellations: this.cleanText(policies.cancellations, 1500) ?? '',
            };
        }
        if (input.serviceAreas !== undefined) vendor.serviceAreas = this.cleanServiceAreas(input.serviceAreas ?? []);
        if (input.availabilityPaused !== undefined) vendor.availabilityPaused = input.availabilityPaused;
        if (input.availabilityPauseReason !== undefined) {
            vendor.availabilityPauseReason = this.cleanText(input.availabilityPauseReason, 240);
        }
        if (input.availabilityTimezone !== undefined) {
            vendor.availabilityTimezone = this.cleanTimezone(input.availabilityTimezone);
        }
        if (input.weeklyHours !== undefined) vendor.weeklyHours = this.cleanWeeklyHours(input.weeklyHours ?? []);
        if (input.unavailableDates !== undefined) {
            vendor.unavailableDates = this.cleanUnavailableDates(input.unavailableDates ?? []);
        }

        const nextHolidayEnabled = input.holidayModeEnabled ?? vendor.holidayModeEnabled;
        const nextHolidayStartsAt = input.holidayStartsAt !== undefined
            ? this.cleanDate(input.holidayStartsAt, 'Holiday start')
            : vendor.holidayStartsAt;
        const nextHolidayEndsAt = input.holidayEndsAt !== undefined
            ? this.cleanDate(input.holidayEndsAt, 'Holiday end')
            : vendor.holidayEndsAt;
        const nextHolidayReason = input.holidayReason !== undefined
            ? this.cleanText(input.holidayReason, 240)
            : vendor.holidayReason;
        if (nextHolidayEnabled) {
            if (!nextHolidayStartsAt || !nextHolidayEndsAt) {
                throw new Error('Choose the start and end of holiday mode');
            }
            if (nextHolidayEndsAt.getTime() <= nextHolidayStartsAt.getTime()) {
                throw new Error('Holiday mode must end after it starts');
            }
            if (!nextHolidayReason) throw new Error('Add a customer-facing reason for holiday mode');
        }
        if (vendor.availabilityPaused && !vendor.availabilityPauseReason) {
            throw new Error('Add a customer-facing reason before temporarily pausing the shop');
        }
        vendor.holidayModeEnabled = nextHolidayEnabled;
        vendor.holidayStartsAt = nextHolidayStartsAt;
        vendor.holidayEndsAt = nextHolidayEndsAt;
        vendor.holidayReason = nextHolidayReason;
        await repository.save(vendor, { reload: false });
        return this.findMine(ctx);
    }

    async register(ctx: RequestContext, input: RegisterVendorInput): Promise<VendorProfile> {
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const ownerEmailAddress = normalizeVendorApplicationEmail(input.ownerEmailAddress);
        await assertVendorApplicationEmailAllowed(this.connection.getRepository(ctx, RoleApplication), ownerEmailAddress);
        const slug = normalizeString(input.slug || input.shopName, '-');
        const duplicate = await repository.createQueryBuilder('vendor')
            .where('vendor.slug = :slug', { slug })
            .orWhere('LOWER(TRIM(vendor.ownerEmailAddress)) = :ownerEmailAddress', { ownerEmailAddress })
            .getOne();
        if (duplicate) {
            throw new Error('A vendor application already exists for this shop or email address');
        }
        return repository.save(
            new VendorProfile({
                ...input,
                ownerEmailAddress,
                slug,
                status: 'PENDING',
                categories: input.categories ?? [],
                operatingLocations: input.operatingLocations ?? [],
            }),
        );
    }

    async review(ctx: RequestContext, input: ReviewVendorInput, fromOnboardingApproval = false): Promise<VendorProfile> {
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const vendor = await assertFound(this.findOne(ctx, input.id));
        const onboardingApplication = await this.connection.getRepository(ctx, RoleApplication).findOneBy({
            role: 'VENDOR', vendorProfileId: String(vendor.id),
        });
        if (
            onboardingApplication?.profileData?.onboardingId &&
            onboardingApplication.status !== 'ACCOUNT_CREATED' &&
            !(fromOnboardingApproval && input.status === 'APPROVED')
        ) {
            throw new Error('Review this vendor through the role application');
        }
        vendor.status = input.status;
        vendor.reviewNote = input.reviewNote;
        vendor.verified = input.status === 'APPROVED';
        if (input.commissionPercent != null) {
            vendor.commissionPercent = input.commissionPercent;
        }
        if (input.payoutSchedule) {
            vendor.payoutSchedule = input.payoutSchedule;
        }
        await repository.save(vendor, { reload: false });
        return assertFound(this.findOne(ctx, vendor.id));
    }

    private cleanText(value: unknown, maxLength: number) {
        if (typeof value !== 'string') return undefined;
        return value.trim().slice(0, maxLength) || undefined;
    }

    private enrichVendors(ctx: RequestContext, vendors: VendorProfile[]) {
        return Promise.all(vendors.map(vendor => this.enrichVendor(ctx, vendor)));
    }

    private async enrichVendor(ctx: RequestContext, vendor: VendorProfile) {
        const summary = await this.marketplaceReviewService.summaryForVendor(ctx, String(vendor.id));
        return Object.assign(vendor, {
            ratingAverage: summary.average,
            ratingCount: summary.count,
            ratingBreakdown: summary.ratingBreakdown,
            badges: summary.badges,
            fulfillmentPerformance: summary.fulfillmentPerformance,
        });
    }

    private cleanAssetUrl(value: unknown) {
        const url = this.cleanText(value, 2048);
        if (!url) return undefined;
        if (!/^https?:\/\//i.test(url) && !/^(\/|assets\/)/i.test(url)) {
            throw new Error('Storefront images must use a valid uploaded asset URL');
        }
        return url;
    }

    private cleanServiceAreas(value: MarketplaceVendorServiceArea[]) {
        if (!Array.isArray(value)) throw new Error('Service coverage must be a list');
        if (value.length > 50) throw new Error('Add no more than 50 service coverage zones');
        const scopes = new Set<MarketplaceVendorServiceAreaScope>(['COUNTRY', 'PROVINCE', 'CITY', 'AREA']);
        return value.map(item => {
            const scope = String(item?.scope ?? '').toUpperCase() as MarketplaceVendorServiceAreaScope;
            if (!scopes.has(scope)) throw new Error('Choose a valid service coverage level');
            const countryCode = this.cleanText(item?.countryCode, 2)?.toUpperCase();
            if (!countryCode || countryCode.length !== 2) throw new Error('Choose a country for every service zone');
            const province = this.cleanText(item?.province, 120);
            const city = this.cleanText(item?.city, 120);
            if (['PROVINCE', 'CITY', 'AREA'].includes(scope) && !province) {
                throw new Error('Choose a province for every province, city, or local-area zone');
            }
            if (['CITY', 'AREA'].includes(scope) && !city) {
                throw new Error('Choose a city for every city or local-area zone');
            }
            const areas = [...new Set((Array.isArray(item?.areas) ? item.areas : [])
                .map(area => this.cleanText(area, 120))
                .filter((area): area is string => Boolean(area)))].slice(0, 100);
            if (scope === 'AREA' && !areas.length) throw new Error('Add at least one local area to an area-level zone');
            return {
                id: this.cleanText(item?.id, 120) ?? randomUUID(),
                scope,
                countryCode,
                province: scope === 'COUNTRY' ? undefined : province,
                city: ['CITY', 'AREA'].includes(scope) ? city : undefined,
                areas: scope === 'AREA' ? areas : [],
            };
        });
    }

    private cleanWeeklyHours(value: MarketplaceVendorWeeklyHours[]) {
        if (!Array.isArray(value) || value.length !== 7) {
            throw new Error('Configure opening hours for all seven days');
        }
        const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
        const days = value.map(item => {
            const dayOfWeek = Number(item?.dayOfWeek);
            const opensAt = String(item?.opensAt ?? '');
            const closesAt = String(item?.closesAt ?? '');
            if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
                throw new Error('Opening hours contain an invalid weekday');
            }
            if (!timePattern.test(opensAt) || !timePattern.test(closesAt)) {
                throw new Error('Opening and closing times must use a valid 24-hour time');
            }
            if (item.enabled && opensAt === closesAt) {
                throw new Error('Opening and closing times cannot be the same');
            }
            return { dayOfWeek, enabled: Boolean(item.enabled), opensAt, closesAt };
        });
        if (new Set(days.map(item => item.dayOfWeek)).size !== 7) {
            throw new Error('Each weekday can be configured only once');
        }
        return days.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
    }

    private cleanUnavailableDates(value: MarketplaceVendorUnavailableDate[]) {
        if (!Array.isArray(value)) throw new Error('Unavailable dates must be a list');
        if (value.length > 100) throw new Error('Add no more than 100 unavailable dates');
        const dates = value.map(item => {
            const date = String(item?.date ?? '').trim();
            const reason = this.cleanText(item?.reason, 240);
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) {
                throw new Error('Every unavailable date must be a valid calendar date');
            }
            if (!reason) throw new Error(`Add a reason for the closure on ${date}`);
            return { id: this.cleanText(item?.id, 120) ?? randomUUID(), date, reason };
        });
        if (new Set(dates.map(item => item.date)).size !== dates.length) {
            throw new Error('An unavailable date can be added only once');
        }
        return dates.sort((a, b) => a.date.localeCompare(b.date));
    }

    private cleanTimezone(value: unknown) {
        const timezone = this.cleanText(value, 120) ?? 'Asia/Karachi';
        try {
            new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
        } catch {
            throw new Error('Choose a valid shop timezone');
        }
        return timezone;
    }

    private cleanDate(value: unknown, label: string) {
        if (value === null || value === undefined || value === '') return undefined;
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date`);
        return date;
    }
}
