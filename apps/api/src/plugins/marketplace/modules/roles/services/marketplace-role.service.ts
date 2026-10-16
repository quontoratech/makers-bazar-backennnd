import { Injectable } from '@nestjs/common';
import { ChannelService, Permission, RequestContext, RoleService } from '@vendure/core';

import {
    affiliatePermission,
    applicationPermission,
    approvePayoutPermission,
    bookingPermission,
    contentPermission,
    financePermission,
    manageMarketplaceRolesPermission,
    promotionPermission,
    supportPermission,
    trustPermission,
    vendorPermission,
} from '../../../permissions';

export interface MarketplaceRoleTemplate {
    code: string;
    description: string;
    permissions: Permission[];
}

export const platformRoleTemplates: MarketplaceRoleTemplate[] = [
    {
        code: 'vendor-operations',
        description: 'Reviews vendor applications, compliance, category access, restrictions, and appeals',
        permissions: [
            Permission.ReadSeller,
            Permission.UpdateSeller,
            vendorPermission.Read,
            vendorPermission.Update,
            applicationPermission.Read,
            applicationPermission.Update,
        ],
    },
    {
        code: 'catalog-moderator',
        description: 'Moderates products, categories, assets, tags, and listing policy compliance',
        permissions: [
            Permission.ReadCatalog,
            Permission.UpdateCatalog,
            Permission.ReadAsset,
            Permission.UpdateAsset,
            trustPermission.Read,
            trustPermission.Update,
        ],
    },
    {
        code: 'order-operations',
        description: 'Monitors master and vendor orders and resolves fulfilment exceptions',
        permissions: [
            Permission.ReadOrder,
            Permission.UpdateOrder,
            Permission.ReadCustomer,
            bookingPermission.Read,
            bookingPermission.Update,
        ],
    },
    {
        code: 'support-agent',
        description: 'Handles customer and vendor cases, evidence, messages, and escalations',
        permissions: [
            Permission.ReadOrder,
            Permission.ReadCustomer,
            supportPermission.Read,
            supportPermission.Update,
        ],
    },
    {
        code: 'finance-admin',
        description: 'Prepares reconciliation, commissions, adjustments, refunds, and payout batches',
        permissions: [
            Permission.ReadOrder,
            Permission.UpdateOrder,
            Permission.ReadPaymentMethod,
            financePermission.Create,
            financePermission.Read,
            financePermission.Update,
        ],
    },
    {
        code: 'payout-approver',
        description: 'Approves prepared payout batches and confirms payout processing',
        permissions: [financePermission.Read, approvePayoutPermission.Permission],
    },
    {
        code: 'content-editor',
        description: 'Manages editorial content and product, vendor, event, and campaign relations',
        permissions: [
            Permission.ReadCatalog,
            contentPermission.Create,
            contentPermission.Read,
            contentPermission.Update,
            contentPermission.Delete,
        ],
    },
    {
        code: 'marketing-manager',
        description: 'Manages promotions, placements, loyalty, vendor campaigns, and affiliates',
        permissions: [
            Permission.ReadPromotion,
            Permission.CreatePromotion,
            Permission.UpdatePromotion,
            promotionPermission.Create,
            promotionPermission.Read,
            promotionPermission.Update,
            affiliatePermission.Read,
            affiliatePermission.Update,
        ],
    },
    {
        code: 'risk-compliance',
        description: 'Reviews policy, fraud, review, payout, privacy, and account-risk signals',
        permissions: [
            Permission.ReadCustomer,
            Permission.ReadOrder,
            Permission.ReadSeller,
            trustPermission.Create,
            trustPermission.Read,
            trustPermission.Update,
            supportPermission.Read,
            financePermission.Read,
        ],
    },
    {
        code: 'marketplace-analyst',
        description: 'Read-only marketplace, vendor, order, finance, content, and campaign reporting',
        permissions: [
            Permission.ReadCatalog,
            Permission.ReadOrder,
            Permission.ReadCustomer,
            Permission.ReadSeller,
            vendorPermission.Read,
            bookingPermission.Read,
            affiliatePermission.Read,
            supportPermission.Read,
            promotionPermission.Read,
            contentPermission.Read,
            financePermission.Read,
            trustPermission.Read,
        ],
    },
    {
        code: 'delivery-partner',
        description: 'Updates assigned pickup, tracking, proof-of-delivery, and delivery exceptions',
        permissions: [Permission.ReadOrder, Permission.UpdateOrder],
    },
];

export const vendorChannelRoleTemplates: MarketplaceRoleTemplate[] = [
    {
        code: 'vendor-owner',
        description: 'Full control of one vendor channel including team, operations, and finance visibility',
        permissions: [
            Permission.CreateCatalog,
            Permission.ReadCatalog,
            Permission.UpdateCatalog,
            Permission.DeleteCatalog,
            Permission.ReadOrder,
            Permission.UpdateOrder,
            Permission.ReadCustomer,
            Permission.ReadPromotion,
            vendorPermission.Read,
            vendorPermission.Update,
            bookingPermission.Create,
            bookingPermission.Read,
            bookingPermission.Update,
            supportPermission.Read,
            supportPermission.Update,
            financePermission.Read,
        ],
    },
    {
        code: 'vendor-manager',
        description: 'Manages shop, catalog, inventory, promotions, orders, bookings, and support',
        permissions: [
            Permission.CreateCatalog,
            Permission.ReadCatalog,
            Permission.UpdateCatalog,
            Permission.ReadOrder,
            Permission.UpdateOrder,
            Permission.ReadCustomer,
            Permission.ReadPromotion,
            bookingPermission.Create,
            bookingPermission.Read,
            bookingPermission.Update,
            supportPermission.Read,
            supportPermission.Update,
        ],
    },
    {
        code: 'vendor-fulfilment',
        description: 'Handles vendor orders, tracking, pickup, preparation, and attendance',
        permissions: [Permission.ReadOrder, Permission.UpdateOrder, bookingPermission.Read, bookingPermission.Update],
    },
];

@Injectable()
export class MarketplaceRoleService {
    constructor(
        private roleService: RoleService,
        private channelService: ChannelService,
    ) {}

    listTemplates(): MarketplaceRoleTemplate[] {
        return [...platformRoleTemplates, ...vendorChannelRoleTemplates];
    }

    async initializePlatformRoles(ctx: RequestContext): Promise<MarketplaceRoleTemplate[]> {
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const existingRoles = await this.roleService.findAll(ctx, { take: 100 });
        for (const template of platformRoleTemplates) {
            if (existingRoles.items.some(role => role.code === template.code)) {
                continue;
            }
            await this.roleService.create(ctx, {
                code: template.code,
                description: template.description,
                channelIds: [defaultChannel.id],
                permissions: template.permissions,
            });
        }
        return this.listTemplates();
    }
}
