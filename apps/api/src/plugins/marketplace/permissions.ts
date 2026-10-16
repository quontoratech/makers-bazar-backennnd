import { CrudPermissionDefinition, PermissionDefinition } from '@vendure/core';

export const vendorPermission = new CrudPermissionDefinition('MarketplaceVendor');
export const bookingPermission = new CrudPermissionDefinition('MarketplaceBooking');
export const affiliatePermission = new CrudPermissionDefinition('MarketplaceAffiliate');
export const supportPermission = new CrudPermissionDefinition('MarketplaceSupport');
export const promotionPermission = new CrudPermissionDefinition('MarketplacePromotion');
export const contentPermission = new CrudPermissionDefinition('MarketplaceContent');
export const financePermission = new CrudPermissionDefinition('MarketplaceFinance');
export const trustPermission = new CrudPermissionDefinition('MarketplaceTrust');
export const applicationPermission = new CrudPermissionDefinition('MarketplaceApplication');

export const approvePayoutPermission = new PermissionDefinition({
    name: 'ApproveMarketplacePayout',
    description: 'Allows final payout approval separately from payout preparation',
});

export const manageMarketplaceRolesPermission = new PermissionDefinition({
    name: 'ManageMarketplaceRoles',
    description: 'Allows marketplace role templates to be initialized and maintained',
});

export const marketplacePermissions = [
    vendorPermission,
    bookingPermission,
    affiliatePermission,
    supportPermission,
    promotionPermission,
    contentPermission,
    financePermission,
    trustPermission,
    applicationPermission,
    approvePayoutPermission,
    manageMarketplaceRolesPermission,
];
