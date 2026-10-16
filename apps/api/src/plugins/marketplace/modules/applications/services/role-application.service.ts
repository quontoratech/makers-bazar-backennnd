import { Injectable } from '@nestjs/common';
import {
    AdministratorService,
    assertFound,
    ChannelService,
    CustomerService,
    EventBus,
    ID,
    isGraphQlErrorResult,
    Permission,
    RequestContext,
    Role,
    RoleService,
    TransactionalConnection,
    UserService,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In } from 'typeorm';

import {
    affiliatePermission,
    bookingPermission,
    financePermission,
    promotionPermission,
    supportPermission,
} from '../../../permissions';
import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { VendorProvisioningService } from '../../vendor/services/vendor-provisioning.service';
import { VendorService } from '../../vendor/services/vendor.service';
import { VendorOnboardingService } from '../../onboarding/services/vendor-onboarding.service';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { assertVendorApplicationEmailAllowed, blockedVendorApplication, normalizeVendorApplicationEmail } from '../vendor-email-block';
import { ReviewRoleApplicationInput, SubmitRoleApplicationInput } from '../dto/role-application.inputs';
import {
    MarketplaceApplicationRole,
    MarketplaceApplicationStatus,
    RoleApplication,
} from '../entities/role-application.entity';
import {
    RoleApplicationApprovedEvent,
    RoleApplicationStatusEvent,
} from '../events/role-application.event';

const activeApplicationStatuses: MarketplaceApplicationStatus[] = [
    'PENDING',
    'UNDER_REVIEW',
    'CHANGES_REQUESTED',
    'APPROVED',
    'ACCOUNT_CREATED',
];

@Injectable()
export class RoleApplicationService {
    constructor(
        private connection: TransactionalConnection,
        private vendorService: VendorService,
        private vendorProvisioningService: VendorProvisioningService,
        private administratorService: AdministratorService,
        private customerService: CustomerService,
        private roleService: RoleService,
        private channelService: ChannelService,
        private userService: UserService,
        private eventBus: EventBus,
        private onboarding: VendorOnboardingService,
    ) {}

    async submit(ctx: RequestContext, input: SubmitRoleApplicationInput): Promise<RoleApplication> {
        if (input.role === 'VENDOR') throw new Error('Use the verified vendor onboarding wizard to apply');
        const repository = this.connection.getRepository(ctx, RoleApplication);
        const emailAddress = input.emailAddress.trim().toLowerCase();
        const existing = await repository.findOne({
            where: {
                role: input.role,
                emailAddress,
                status: In(activeApplicationStatuses),
            },
        });
        if (existing) {
            throw new Error(`An active ${input.role.toLowerCase()} application already exists for this email`);
        }

        const now = new Date();
        const application = await repository.save(
            new RoleApplication({
                ...input,
                emailAddress,
                reference: await this.createReference(ctx),
                profileData: input.profileData as any,
                status: 'PENDING',
                mustChangePassword: false,
                history: [{ status: 'PENDING', at: now.toISOString() }],
            }),
        );
        await this.eventBus.publish(
            new RoleApplicationStatusEvent(
                ctx,
                application.emailAddress,
                application.firstName,
                application.displayName,
                application.reference,
                application.role,
                application.status,
            ),
        );
        return application;
    }

    async track(ctx: RequestContext, referenceInput: string, emailAddressInput: string) {
        const application = await this.connection.getRepository(ctx, RoleApplication).findOne({
            where: {
                reference: referenceInput.trim().toUpperCase(),
                emailAddress: emailAddressInput.trim().toLowerCase(),
            },
        });
        if (application) application.profileData = undefined;
        return application;
    }

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        status?: MarketplaceApplicationStatus,
        role?: MarketplaceApplicationRole,
    ): Promise<MarketplaceList<RoleApplication>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, RoleApplication).findAndCount({
            where: {
                ...(status ? { status } : {}),
                ...(role ? { role } : {}),
            },
            skip,
            take,
            order: { createdAt: 'DESC' },
        });
        return { items, totalItems };
    }

    async review(ctx: RequestContext, input: ReviewRoleApplicationInput) {
        const application = await assertFound(this.findOne(ctx, input.id));
        if (application.role === 'VENDOR' && !ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new Error('Only a super administrator can review a vendor application');
        }
        if (application.role === 'VENDOR') {
            await assertVendorApplicationEmailAllowed(this.connection.getRepository(ctx, RoleApplication), application.emailAddress);
        }
        if (!['UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'].includes(input.status)) {
            throw new Error('Choose a valid application review decision');
        }
        if (!['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED'].includes(application.status)) {
            throw new Error('This application cannot be reviewed in its current state');
        }
        if (application.status === 'CHANGES_REQUESTED' && input.status === 'UNDER_REVIEW') {
            throw new Error('Wait for the applicant to resubmit the requested changes');
        }
        const note = input.reviewNote?.trim();
        if (['CHANGES_REQUESTED', 'REJECTED'].includes(input.status) && !note) {
            throw new Error('Add a reason so the applicant knows what to correct');
        }
        const previousStatus = application.status;
        application.status = input.status;
        application.reviewNote = note;
        application.reviewedAt = new Date();
        application.reviewedByUserId = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        this.appendHistory(application, input.status, note);
        const reviewed = await this.connection.getRepository(ctx, RoleApplication)
            .createQueryBuilder()
            .update(RoleApplication)
            .set({
                status: application.status,
                reviewNote: application.reviewNote,
                reviewedAt: application.reviewedAt,
                reviewedByUserId: application.reviewedByUserId,
                history: application.history,
            })
            .where('id = :id AND status = :previousStatus', { id: application.id, previousStatus })
            .execute();
        if (reviewed.affected !== 1) throw new Error('This application changed. Reload before reviewing.');
        if (application.role === 'VENDOR' && application.vendorProfileId) {
            const vendorRepo = this.connection.getRepository(ctx, VendorProfile);
            const vendor = await vendorRepo.findOneBy({ id: application.vendorProfileId });
            if (!vendor) throw new Error('The vendor profile linked to this application is missing');
            vendor.status = input.status === 'UNDER_REVIEW' ? 'PENDING' : input.status;
            vendor.reviewNote = note;
            vendor.verified = false;
            await vendorRepo.save(vendor, { reload: false });
        }
        await this.eventBus.publish(
            new RoleApplicationStatusEvent(
                ctx,
                application.emailAddress,
                application.firstName,
                application.displayName,
                application.reference,
                application.role,
                application.status,
                application.reviewNote,
            ),
        );
        return assertFound(this.findOne(ctx, application.id));
    }

    async blockVendor(ctx: RequestContext, id: ID, reasonInput: string) {
        if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new Error('Only a super administrator can block a vendor application');
        }
        const reason = reasonInput?.trim();
        if (!reason) throw new Error('Add a reason for blocking this vendor application');
        const application = await assertFound(this.findOne(ctx, id));
        if (application.role !== 'VENDOR') throw new Error('Only vendor applications can be blocked');
        if (!['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'].includes(application.status)) {
            throw new Error('This vendor application cannot be blocked in its current state');
        }
        const repository = this.connection.getRepository(ctx, RoleApplication);
        await assertVendorApplicationEmailAllowed(repository, application.emailAddress);
        application.emailAddress = normalizeVendorApplicationEmail(application.emailAddress);
        application.status = 'BLOCKED';
        application.blockedAt = new Date();
        application.blockedReason = reason;
        application.blockedByUserId = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        application.reviewNote = reason;
        application.reviewedAt = application.blockedAt;
        application.reviewedByUserId = application.blockedByUserId;
        this.appendHistory(application, 'BLOCKED', reason);
        const blocked = await repository.createQueryBuilder()
            .update(RoleApplication)
            .set({
                emailAddress: application.emailAddress,
                status: 'BLOCKED',
                blockedAt: application.blockedAt,
                blockedReason: application.blockedReason,
                blockedByUserId: application.blockedByUserId,
                reviewNote: application.reviewNote,
                reviewedAt: application.reviewedAt,
                reviewedByUserId: application.reviewedByUserId,
                history: application.history,
            })
            .where('id = :id AND status IN (:...statuses)', {
                id: application.id,
                statuses: ['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'],
            })
            .execute();
        if (blocked.affected !== 1) throw new Error('This application changed. Reload before blocking.');
        if (application.vendorProfileId) {
            await this.connection.getRepository(ctx, VendorProfile).update(application.vendorProfileId, {
                status: 'REJECTED', verified: false, reviewNote: reason,
            });
        }
        await this.eventBus.publish(new RoleApplicationStatusEvent(
            ctx, application.emailAddress, application.firstName, application.displayName,
            application.reference, application.role, 'BLOCKED', reason,
        ));
        return assertFound(this.findOne(ctx, application.id));
    }

    async unblockVendor(ctx: RequestContext, id: ID) {
        if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new Error('Only a super administrator can unblock a vendor application');
        }
        const application = await assertFound(this.findOne(ctx, id));
        if (application.role !== 'VENDOR' || application.status !== 'BLOCKED') {
            throw new Error('This vendor application is not blocked');
        }
        const repository = this.connection.getRepository(ctx, RoleApplication);
        const blocked = await blockedVendorApplication(repository, application.emailAddress);
        if (blocked && String(blocked.id) !== String(application.id)) {
            throw new Error('A different application is blocking this email address');
        }
        application.status = 'REJECTED';
        application.blockedAt = null;
        application.blockedReason = null;
        application.blockedByUserId = null;
        application.reviewNote = 'The block has been removed. You may correct and resubmit this application.';
        application.history = [
            ...(application.history ?? []),
            { status: 'UNBLOCKED', at: new Date().toISOString(), note: 'Application block removed by super administrator' },
        ];
        const unblocked = await repository.createQueryBuilder()
            .update(RoleApplication)
            .set({
                status: 'REJECTED',
                blockedAt: null,
                blockedReason: null,
                blockedByUserId: null,
                reviewNote: application.reviewNote,
                history: application.history,
            })
            .where('id = :id AND status = :status', { id: application.id, status: 'BLOCKED' })
            .execute();
        if (unblocked.affected !== 1) throw new Error('This application changed. Reload before unblocking.');
        if (application.vendorProfileId) {
            await this.connection.getRepository(ctx, VendorProfile).update(application.vendorProfileId, {
                status: 'REJECTED', verified: false, reviewNote: application.reviewNote,
            });
        }
        return assertFound(this.findOne(ctx, application.id));
    }

    async approveAndProvision(ctx: RequestContext, id: ID) {
        if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
            throw new Error('Only a super administrator can create an approved role account');
        }
        const application = await assertFound(this.findOne(ctx, id));
        if (!['PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(application.status)) {
            throw new Error('This application cannot be approved in its current state');
        }
        if (application.role === 'VENDOR') {
            await assertVendorApplicationEmailAllowed(this.connection.getRepository(ctx, RoleApplication), application.emailAddress);
        }
        if (application.provisionedUserId) {
            throw new Error('An account has already been created for this application');
        }
        if (application.role === 'VENDOR') {
            const claimed = await this.connection.getRepository(ctx, RoleApplication)
                .createQueryBuilder()
                .update(RoleApplication)
                .set({ status: 'APPROVED' })
                .where('id = :id AND status = :status', { id: application.id, status: application.status })
                .execute();
            if (claimed.affected !== 1) throw new Error('This application changed. Reload before approval.');
            application.status = 'APPROVED';
        }

        const temporaryPassword = this.createTemporaryPassword();
        const existingUserId = await this.onboarding.ownerForApplication(ctx, application);
        let provisionedUserId: string;
        if (application.role === 'VENDOR') {
            if (!application.vendorProfileId) {
                throw new Error('The vendor profile linked to this application is missing');
            }
            await this.vendorService.review(ctx, {
                id: application.vendorProfileId,
                status: 'APPROVED',
                reviewNote: application.reviewNote ?? 'Approved during role application review',
            }, true);
            const vendor = await this.vendorProvisioningService.provision(ctx, {
                vendorProfileId: application.vendorProfileId,
                temporaryPassword,
            }, existingUserId, true);
            if (!vendor.ownerUserId) {
                throw new Error('The vendor owner account was not created correctly');
            }
            provisionedUserId = vendor.ownerUserId;
            await this.onboarding.approve(ctx, application, vendor);
        } else {
            const role = await this.getOrCreateAccountRole(ctx, application.role);
            const administrator = await this.administratorService.create(ctx, {
                firstName: application.firstName,
                lastName: application.lastName,
                emailAddress: application.emailAddress,
                password: temporaryPassword,
                roleIds: [role.id],
            });
            provisionedUserId = String(administrator.user.id);
        }

        application.status = 'ACCOUNT_CREATED';
        application.reviewedAt = new Date();
        application.reviewedByUserId = ctx.activeUserId ? String(ctx.activeUserId) : undefined;
        application.provisionedUserId = provisionedUserId;
        application.mustChangePassword = !existingUserId;
        this.appendHistory(application, 'APPROVED', 'Application approved');
        this.appendHistory(application, 'ACCOUNT_CREATED', 'Account created and credentials sent');
        await this.connection.getRepository(ctx, RoleApplication).save(application, { reload: false });
        if (existingUserId) await this.eventBus.publish(new RoleApplicationStatusEvent(ctx, application.emailAddress, application.firstName, application.displayName, application.reference, application.role, 'ACCOUNT_CREATED', 'Your vendor workspace is ready. Sign in with your existing password.'));
        else await this.eventBus.publish(
            new RoleApplicationApprovedEvent(
                ctx,
                application.emailAddress,
                application.firstName,
                application.displayName,
                application.reference,
                application.role,
                temporaryPassword,
            ),
        );
        return assertFound(this.findOne(ctx, application.id));
    }

    async getIdentity(ctx: RequestContext) {
        if (!ctx.activeUserId) return null;
        const application = await this.connection.getRepository(ctx, RoleApplication).findOne({
            where: { provisionedUserId: String(ctx.activeUserId) },
            order: { updatedAt: 'DESC' },
        });
        if (application) {
            return {
                role: application.role.toLowerCase(),
                displayName: application.displayName,
                identifier: application.emailAddress,
                mustChangePassword: application.mustChangePassword,
                dashboardPath: `/dashboard/${application.role.toLowerCase()}`,
            };
        }
        const identifier = ctx.session?.user?.identifier ?? '';
        if (ctx.apiType === 'shop') {
            const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
            const displayName = customer
                ? `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim()
                : identifier;
            return {
                role: 'customer',
                displayName,
                identifier,
                mustChangePassword: false,
                dashboardPath: '/dashboard/customer',
            };
        }
        const isSuperAdmin = ctx.userHasPermissions([Permission.SuperAdmin]);
        return {
            role: isSuperAdmin ? 'super-admin' : 'admin',
            displayName: isSuperAdmin ? 'Super administrator' : 'Operations administrator',
            identifier,
            mustChangePassword: false,
            dashboardPath: isSuperAdmin ? '/dashboard/super-admin' : '/dashboard/admin',
        };
    }

    async changeTemporaryPassword(
        ctx: RequestContext,
        currentPassword: string,
        newPassword: string,
    ) {
        if (!ctx.activeUserId) throw new Error('You must be signed in');
        const application = await this.connection.getRepository(ctx, RoleApplication).findOne({
            where: { provisionedUserId: String(ctx.activeUserId) },
        });
        if (!application) throw new Error('No marketplace role account is linked to this session');
        const result = await this.userService.updatePassword(
            ctx,
            ctx.activeUserId,
            currentPassword,
            newPassword,
        );
        if (result !== true) {
            throw new Error(isGraphQlErrorResult(result) ? result.message : 'Password could not be changed');
        }
        application.mustChangePassword = false;
        await this.connection.getRepository(ctx, RoleApplication).save(application, { reload: false });
        return { success: true, message: 'Password changed successfully' };
    }

    findOne(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, RoleApplication).findOne({ where: { id } });
    }

    private async getOrCreateAccountRole(ctx: RequestContext, role: Exclude<MarketplaceApplicationRole, 'VENDOR'>) {
        const code = role === 'INFLUENCER' ? 'marketplace-influencer' : 'marketplace-organizer';
        const existing = await this.connection.getRepository(ctx, Role).findOne({ where: { code } });
        if (existing) return existing;
        const channel = await this.channelService.getDefaultChannel(ctx);
        const permissions = role === 'INFLUENCER'
            ? [affiliatePermission.Read, promotionPermission.Read, financePermission.Read]
            : [bookingPermission.Create, bookingPermission.Read, bookingPermission.Update, supportPermission.Read, promotionPermission.Read, financePermission.Read];
        return this.roleService.create(ctx, {
            code,
            description: role === 'INFLUENCER'
                ? 'Approved influencer marketplace account'
                : 'Approved event and workshop organizer marketplace account',
            channelIds: [channel.id],
            permissions,
        });
    }

    private async createReference(ctx: RequestContext): Promise<string> {
        const repository = this.connection.getRepository(ctx, RoleApplication);
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const reference = `APP-${randomBytes(4).toString('hex').toUpperCase()}`;
            if (!(await repository.findOne({ where: { reference } }))) return reference;
        }
        throw new Error('Unable to create a unique application reference');
    }

    private createTemporaryPassword() {
        return `Ms!${randomBytes(8).toString('base64url')}9a`;
    }

    private appendHistory(
        application: RoleApplication,
        status: MarketplaceApplicationStatus,
        note?: string,
    ) {
        application.history = [
            ...(application.history ?? []),
            { status, at: new Date().toISOString(), ...(note ? { note } : {}) },
        ];
    }
}
