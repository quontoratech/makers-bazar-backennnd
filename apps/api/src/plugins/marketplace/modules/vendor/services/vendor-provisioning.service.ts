import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import {
    AdministratorService,
    Administrator,
    assertFound,
    Channel,
    ChannelService,
    ConfigService,
    InternalServerError,
    isGraphQlErrorResult,
    manualFulfillmentHandler,
    RequestContext,
    RoleService,
    SellerService,
    ShippingMethod,
    ShippingMethodService,
    StockLocation,
    StockLocationService,
    TransactionalConnection,
    User,
    Zone,
    ZoneService,
} from '@vendure/core';
import { randomBytes, randomUUID } from 'node:crypto';

import { vendorChannelRoleTemplates } from '../../roles/services/marketplace-role.service';
import { RoleApplication } from '../../applications/entities/role-application.entity';
import { marketplaceShippingCalculator } from '../../shipping/config/marketplace-shipping-calculator';
import { MarketplaceShippingService } from '../../shipping/services/marketplace-shipping.service';
import { ProvisionVendorInput } from '../dto/vendor.inputs';
import { VendorProfile } from '../entities/vendor-profile.entity';
import { multivendorShippingEligibilityChecker } from '../config/multivendor-shipping-eligibility-checker';

@Injectable()
export class VendorProvisioningService {
    constructor(
        private connection: TransactionalConnection,
        private administratorService: AdministratorService,
        private sellerService: SellerService,
        private roleService: RoleService,
        private channelService: ChannelService,
        private shippingMethodService: ShippingMethodService,
        private stockLocationService: StockLocationService,
        private zoneService: ZoneService,
        private configService: ConfigService,
        private marketplaceShippingService: MarketplaceShippingService,
    ) {}

    async provision(ctx: RequestContext, input: ProvisionVendorInput, existingUserId?: string, fromOnboardingApproval = false): Promise<VendorProfile> {
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const vendor = await assertFound(repository.findOne({ where: { id: input.vendorProfileId } }));
        const onboardingApplication = await this.connection.getRepository(ctx, RoleApplication).findOneBy({
            role: 'VENDOR', vendorProfileId: String(vendor.id),
        });
        if (
            onboardingApplication?.profileData?.onboardingId &&
            onboardingApplication.status !== 'ACCOUNT_CREATED' &&
            !fromOnboardingApproval
        ) {
            throw new Error('Approve this vendor through the role application');
        }
        if (vendor.status !== 'APPROVED') {
            throw new Error('Only approved vendor applications can be provisioned');
        }
        if (vendor.sellerId || vendor.channelId) {
            throw new Error('This vendor is already provisioned');
        }
        if (input.temporaryPassword.length < 12) {
            throw new Error('Temporary vendor passwords must contain at least 12 characters');
        }

        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const defaultShippingZone = defaultChannel.defaultShippingZone
            ?? await this.getOrCreateZone(ctx, 'Marketplace shipping zone');
        const defaultTaxZone = defaultChannel.defaultTaxZone
            ?? await this.getOrCreateZone(ctx, 'Marketplace tax zone');
        if (!defaultChannel.defaultShippingZone || !defaultChannel.defaultTaxZone) {
            await this.channelService.update(ctx, {
                id: defaultChannel.id,
                defaultShippingZoneId: defaultShippingZone.id,
                defaultTaxZoneId: defaultTaxZone.id,
            });
        }
        const shopCode = `${normalizeString(vendor.shopName, '-')}-${vendor.id}`;
        const seller = await this.sellerService.create(ctx, {
            name: vendor.shopName,
            customFields: {
                vendorProfileId: String(vendor.id),
                connectedAccountId: randomUUID(),
            },
        });
        const channelResult = await this.channelService.create(ctx, {
            code: shopCode,
            token: `${shopCode}-${randomBytes(8).toString('hex')}`,
            sellerId: seller.id,
            currencyCode: defaultChannel.defaultCurrencyCode,
            defaultLanguageCode: defaultChannel.defaultLanguageCode,
            pricesIncludeTax: defaultChannel.pricesIncludeTax,
            defaultShippingZoneId: defaultShippingZone.id,
            defaultTaxZoneId: defaultTaxZone.id,
        });
        if (isGraphQlErrorResult(channelResult)) {
            throw new InternalServerError(channelResult.message);
        }

        await this.assignSystemRoles(ctx, channelResult);
        const ownerRole = await this.createOwnerRole(ctx, vendor, channelResult);
        let owner: Administrator;
        if (existingUserId) {
            const user = await this.connection.getRepository(ctx, User).findOne({ where: { id: existingUserId }, relations: ['roles'] });
            if (!user?.verified || user.identifier.toLowerCase() !== vendor.ownerEmailAddress.toLowerCase()) throw new Error('Verified applicant identity does not match the vendor');
            if (await this.connection.getRepository(ctx, Administrator).findOneBy({ emailAddress: vendor.ownerEmailAddress })) throw new Error('This email already belongs to an administrator');
            owner = await this.connection.getRepository(ctx, Administrator).save(new Administrator({
                firstName: vendor.ownerFirstName, lastName: vendor.ownerLastName, emailAddress: vendor.ownerEmailAddress, user,
            }));
            owner = await this.administratorService.assignRole(ctx, owner.id, ownerRole.id);
        } else owner = await this.administratorService.create(ctx, {
            firstName: vendor.ownerFirstName,
            lastName: vendor.ownerLastName,
            emailAddress: vendor.ownerEmailAddress,
            password: input.temporaryPassword,
            roleIds: [ownerRole.id],
        });
        const shippingMethod = await this.createShippingMethod(ctx, vendor, channelResult);
        await this.marketplaceShippingService.attachShippingMethod(ctx, vendor, String(shippingMethod.id));
        await this.createStockLocation(ctx, vendor.shopName, channelResult);

        vendor.sellerId = String(seller.id);
        vendor.channelId = String(channelResult.id);
        vendor.ownerUserId = String(owner.user.id);
        await repository.save(vendor, { reload: false });
        return assertFound(repository.findOne({ where: { id: vendor.id } }));
    }

    private async assignSystemRoles(ctx: RequestContext, channel: Channel) {
        const [superAdminRole, customerRole] = await Promise.all([
            this.roleService.getSuperAdminRole(ctx),
            this.roleService.getCustomerRole(ctx),
        ]);
        await this.roleService.assignRoleToChannel(ctx, superAdminRole.id, channel.id);
        await this.roleService.assignRoleToChannel(ctx, customerRole.id, channel.id);
    }

    private createOwnerRole(ctx: RequestContext, vendor: VendorProfile, channel: Channel) {
        const template = vendorChannelRoleTemplates[0];
        if (!template) throw new InternalServerError('Vendor owner role template is missing');
        return this.roleService.create(ctx, {
            code: `${vendor.slug}-owner`,
            description: `${template.description}: ${vendor.shopName}`,
            channelIds: [channel.id],
            permissions: template.permissions,
        });
    }

    private async createShippingMethod(ctx: RequestContext, vendor: VendorProfile, channel: Channel) {
        const { shippingEligibilityCheckers, shippingCalculators, fulfillmentHandlers } =
            this.configService.shippingOptions;
        const checker = shippingEligibilityCheckers.find(
            item => item.code === multivendorShippingEligibilityChecker.code,
        );
        const calculator = shippingCalculators.find(item => item.code === marketplaceShippingCalculator.code);
        const fulfillmentHandler = fulfillmentHandlers.find(item => item.code === manualFulfillmentHandler.code);
        if (!checker || !calculator || !fulfillmentHandler) {
            throw new InternalServerError('Marketplace shipping dependencies are not configured');
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const shippingMethod = await this.shippingMethodService.create(ctx, {
            code: `${normalizeString(vendor.shopName, '-')}-standard-shipping`,
            checker: { code: checker.code, arguments: [] },
            calculator: {
                code: calculator.code,
                arguments: [
                    { name: 'vendorProfileId', value: String(vendor.id) },
                ],
            },
            fulfillmentHandler: fulfillmentHandler.code,
            translations: [
                {
                    languageCode: defaultChannel.defaultLanguageCode,
                    name: `Delivery from ${vendor.shopName}`,
                },
            ],
        });
        await this.channelService.assignToChannels(ctx, ShippingMethod, shippingMethod.id, [channel.id]);
        return shippingMethod;
    }

    private async createStockLocation(ctx: RequestContext, shopName: string, channel: Channel) {
        const stockLocation = await this.stockLocationService.create(ctx, {
            name: `${shopName} primary stock`,
        });
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);
        const channelIds = String(defaultChannel.id) === String(channel.id)
            ? [channel.id]
            : [channel.id, defaultChannel.id];
        await this.channelService.assignToChannels(ctx, StockLocation, stockLocation.id, channelIds);
    }

    private async getOrCreateZone(ctx: RequestContext, name: string): Promise<Zone> {
        const existing = await this.connection.getRepository(ctx, Zone).findOne({ where: { name } });
        return existing ?? this.zoneService.create(ctx, { name, memberIds: [] });
    }
}
