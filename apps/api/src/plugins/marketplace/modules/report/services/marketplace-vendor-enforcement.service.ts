import { Injectable } from '@nestjs/common';
import { ForbiddenError, RequestContext, TransactionalConnection, UserService } from '@vendure/core';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { ApplyMarketplaceVendorEnforcementInput } from '../dto/marketplace-report.inputs';
import {
    MarketplaceVendorEnforcement,
    MarketplaceVendorEnforcementType,
} from '../entities/marketplace-vendor-enforcement.entity';

@Injectable()
export class MarketplaceVendorEnforcementService {
    constructor(
        private connection: TransactionalConnection,
        private userService: UserService,
    ) {}

    async apply(
        ctx: RequestContext,
        reportId: string,
        reportCode: string,
        vendorProfileId: string,
        input: ApplyMarketplaceVendorEnforcementInput,
    ) {
        const type = input.type?.trim().toUpperCase() as MarketplaceVendorEnforcementType;
        if (!['WARNING', 'RESTRICTION', 'PERMANENT_REMOVAL'].includes(type)) {
            throw new Error('Choose a valid vendor enforcement action');
        }
        const message = this.cleanMessage(input.message);
        const vendorRepository = this.connection.getRepository(ctx, VendorProfile);
        const vendor = await vendorRepository.findOne({ where: { id: vendorProfileId } });
        if (!vendor) throw new Error('The vendor account linked to this report was not found');
        await this.refreshVendor(ctx, vendor);
        if (vendor.enforcementStatus === 'REMOVED') {
            throw new Error('This vendor account has already been permanently removed');
        }

        const now = new Date();
        let durationDays: number | undefined;
        let endsAt: Date | undefined;
        if (type === 'RESTRICTION') {
            durationDays = Number(input.durationDays);
            if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
                throw new Error('Restriction duration must be between 1 and 3650 days');
            }
        }
        if (type === 'PERMANENT_REMOVAL' && input.confirmPermanentRemoval !== true) {
            throw new Error('Permanent account removal must be explicitly confirmed');
        }

        // A newly-issued account action supersedes any active restriction while
        // preserving that restriction in the audit history as revoked.
        await this.revokeActiveRestrictions(ctx, vendor);

        if (type === 'RESTRICTION') {
            endsAt = new Date(now.getTime() + durationDays! * 24 * 60 * 60 * 1000);
            vendor.restrictionPreviousPaused = vendor.paused;
            vendor.paused = true;
            vendor.enforcementStatus = 'RESTRICTED';
            vendor.restrictedUntil = endsAt;
            vendor.enforcementReason = message;
        } else if (type === 'WARNING') {
            vendor.warningCount += 1;
        } else {
            vendor.status = 'REJECTED';
            vendor.verified = false;
            vendor.paused = true;
            vendor.enforcementStatus = 'REMOVED';
            vendor.enforcementReason = message;
            vendor.removedAt = now;
        }

        const enforcement = await this.connection.getRepository(ctx, MarketplaceVendorEnforcement).save(
            new MarketplaceVendorEnforcement({
                vendorProfileId: String(vendor.id),
                reportId,
                reportCode,
                type,
                status: 'ACTIVE',
                message,
                durationDays,
                startsAt: now,
                endsAt,
                createdByUserId: this.requireUser(ctx),
            }),
        );
        await vendorRepository.save(vendor, { reload: false });

        if (type === 'PERMANENT_REMOVAL' && vendor.ownerUserId) {
            await this.userService.softDelete(ctx, vendor.ownerUserId);
        }
        return enforcement;
    }

    async findMine(ctx: RequestContext) {
        const vendor = await this.findVendorForSession(ctx);
        await this.refreshVendor(ctx, vendor);
        return this.connection.getRepository(ctx, MarketplaceVendorEnforcement).find({
            where: { vendorProfileId: String(vendor.id) },
            order: { createdAt: 'DESC' },
        });
    }

    async acknowledgeMine(ctx: RequestContext, id: string) {
        const vendor = await this.findVendorForSession(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceVendorEnforcement);
        const enforcement = await repository.findOne({
            where: { id, vendorProfileId: String(vendor.id) },
        });
        if (!enforcement) throw new Error('Account notice was not found');
        enforcement.acknowledgedAt = enforcement.acknowledgedAt ?? new Date();
        await repository.save(enforcement, { reload: false });
        return enforcement;
    }

    async liftRestriction(ctx: RequestContext, enforcementId: string) {
        const repository = this.connection.getRepository(ctx, MarketplaceVendorEnforcement);
        const enforcement = await repository.findOne({
            where: { id: enforcementId, type: 'RESTRICTION', status: 'ACTIVE' },
        });
        if (!enforcement) throw new Error('The restriction is no longer active');
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { id: enforcement.vendorProfileId },
        });
        if (!vendor) throw new Error('The restricted vendor account was not found');
        await this.revokeActiveRestrictions(ctx, vendor);
        return { ...enforcement, status: 'REVOKED' as const };
    }

    async assertCanManageStore(ctx: RequestContext) {
        const vendor = await this.findVendorForSession(ctx);
        await this.refreshVendor(ctx, vendor);
        if (vendor.enforcementStatus === 'RESTRICTED' && vendor.restrictedUntil) {
            throw new Error(`This vendor account is restricted until ${vendor.restrictedUntil.toISOString()}`);
        }
        if (vendor.enforcementStatus === 'REMOVED' || vendor.status !== 'APPROVED') {
            throw new ForbiddenError();
        }
        return vendor;
    }

    async releaseExpiredRestrictions(ctx: RequestContext) {
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find({
            where: { enforcementStatus: 'RESTRICTED' },
        });
        for (const vendor of vendors) await this.refreshVendor(ctx, vendor);
    }

    async refreshVendor(ctx: RequestContext, vendor: VendorProfile) {
        if (vendor.enforcementStatus !== 'RESTRICTED') return vendor;

        const latestActiveAction = await this.connection.getRepository(ctx, MarketplaceVendorEnforcement).findOne({
            where: { vendorProfileId: String(vendor.id), status: 'ACTIVE' },
            order: { createdAt: 'DESC' },
        });
        if (latestActiveAction && latestActiveAction.type !== 'RESTRICTION') {
            await this.revokeActiveRestrictions(ctx, vendor);
            return vendor;
        }

        if (!vendor.restrictedUntil || vendor.restrictedUntil.getTime() > Date.now()) return vendor;
        vendor.enforcementStatus = 'ACTIVE';
        vendor.paused = vendor.restrictionPreviousPaused;
        vendor.restrictionPreviousPaused = false;
        vendor.restrictedUntil = undefined;
        vendor.enforcementReason = undefined;
        await this.connection.getRepository(ctx, VendorProfile).save(vendor, { reload: false });
        await this.connection.getRepository(ctx, MarketplaceVendorEnforcement)
            .createQueryBuilder()
            .update(MarketplaceVendorEnforcement)
            .set({ status: 'EXPIRED' })
            .where('vendorProfileId = :vendorProfileId', { vendorProfileId: String(vendor.id) })
            .andWhere('type = :type', { type: 'RESTRICTION' })
            .andWhere('status = :status', { status: 'ACTIVE' })
            .andWhere('endsAt <= :now', { now: new Date() })
            .execute();
        return vendor;
    }

    private async revokeActiveRestrictions(ctx: RequestContext, vendor: VendorProfile) {
        await this.connection.getRepository(ctx, MarketplaceVendorEnforcement)
            .createQueryBuilder()
            .update(MarketplaceVendorEnforcement)
            .set({ status: 'REVOKED' })
            .where('vendorProfileId = :vendorProfileId', { vendorProfileId: String(vendor.id) })
            .andWhere('type = :type', { type: 'RESTRICTION' })
            .andWhere('status = :status', { status: 'ACTIVE' })
            .execute();
        if (vendor.enforcementStatus === 'RESTRICTED') {
            vendor.enforcementStatus = 'ACTIVE';
            vendor.paused = vendor.restrictionPreviousPaused;
            vendor.restrictionPreviousPaused = false;
            vendor.restrictedUntil = undefined;
            vendor.enforcementReason = undefined;
            await this.connection.getRepository(ctx, VendorProfile).save(vendor, { reload: false });
        }
    }

    private async findVendorForSession(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId) },
        });
        if (!vendor) throw new Error('This account is not connected to a vendor shop');
        return vendor;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }

    private cleanMessage(value: unknown) {
        const message = typeof value === 'string' ? value.trim().slice(0, 3000) : '';
        if (!message) throw new Error('Enter the notice that will be shown to the vendor');
        return message;
    }
}
