import { OnApplicationBootstrap } from '@nestjs/common';
import { prepareMarketplacePayoutsTask } from './modules/finance/config/payout.tasks';
import { CompanyPaymentService } from './modules/vendor/services/company-payment.service';
import { raw } from 'express';
import {
    configureDefaultOrderProcess,
    DefaultProductVariantPriceUpdateStrategy,
    LanguageCode,
    PluginCommonModule,
    ProcessContext,
    RequestContextService,
    VendurePlugin,
} from '@vendure/core';

import { AdminMarketplaceResolver } from './api/admin-marketplace.resolver';
import { adminApiExtensions } from './api/admin-schema';
import { ShopMarketplaceResolver } from './api/shop-marketplace.resolver';
import { shopApiExtensions } from './api/shop-schema';
import { MARKETPLACE_PLUGIN_OPTIONS } from './constants';
import {
    AffiliateProfile,
    EmailVerificationChallenge,
    MarketplaceArticle,
    MarketplaceBooking,
    MarketplaceChatAttachment,
    MarketplaceChatConversation,
    MarketplaceChatMessage,
    MarketplaceChatReadState,
    MarketplaceListingQuote,
    MarketplaceCustomerConsentRecord,
    MarketplaceCustomerDataRequest,
    PayoutLedgerEntry,
    MarketplaceCommissionRule,
    MarketplaceCustomerRefund,
    MarketplacePayoutBatch,
    MarketplacePayoutSettings,
    PromotionCampaign,
    MarketplacePromotionRate,
    MarketplacePromotionRequest,
    MarketplacePromotionSettings,
    MarketplacePromotionPayment,
    MarketplaceCoupon,
    MarketplaceCouponRedemption,
    RoleApplication,
    SupportCase,
    VendorShippingProfile,
    VendorProfile,
    MarketplaceWishlist,
    MarketplaceWishlistItem,
    MarketplaceReport,
    MarketplaceReportEvidence,
    MarketplaceVendorEnforcement,
    MarketplaceVendorAppeal,
    MarketplaceVendorAppealEvidence,
    MarketplaceCartReservation,
    MarketplaceReview,
    MarketplaceReviewMedia,
    MarketplacePurchaseRewardGrant,
    MarketplacePurchaseRewardRule,
    MarketplaceReviewRewardGrant,
    MarketplaceReviewRewardSettings,
    MarketplaceRewardWalletTransaction,
    MarketplaceRewardRedemptionSettings,
    MarketplaceRewardRedemption,
    MarketplaceProductView,
    MarketplaceAvailabilitySession,
    MarketplaceCategory,
    MarketplaceCategoryField,
    MarketplaceDigitalFile,
    MarketplaceDigitalDownloadGrant,
    MarketplaceEventScheduleItem,
    MarketplaceEventTicketType,
    MarketplaceFormTemplate,
    MarketplaceListingCategory,
    MarketplaceListingFieldValue,
    MarketplaceServicePackage,
    MarketplaceVendorCategoryRequest,
    MarketplaceVendorCategoryRequestDocument,
} from './entities';
import { AffiliateService } from './modules/affiliate/services/affiliate.service';
import { RoleApplicationService } from './modules/applications/services/role-application.service';
import { BookingService } from './modules/booking/services/booking.service';
import {
    releaseExpiredPendingBookingsTask,
    sendSubscriptionRenewalEmailsTask,
} from './modules/booking/config/booking-lifecycle.tasks';
import { MarketplaceChatGateway } from './modules/chat/gateways/marketplace-chat.gateway';
import { MarketplaceChatRealtimeService } from './modules/chat/services/marketplace-chat-realtime.service';
import { MarketplaceChatService } from './modules/chat/services/marketplace-chat.service';
import { MarketplaceQuotePriceCalculationStrategy } from './modules/chat/config/marketplace-quote-price-calculation-strategy';
import { MarketplaceCatalogService } from './modules/catalog/services/marketplace-catalog.service';
import { DigitalFileSecurityService } from './modules/catalog/services/digital-file-security.service';
import { MarketplaceDigitalDownloadService } from './modules/catalog/services/marketplace-digital-download.service';
import { MarketplaceCategoryService } from './modules/catalog/services/marketplace-category.service';
import { MarketplaceVendorCategoryRequestService } from './modules/catalog/services/marketplace-vendor-category-request.service';
import { MarketplaceDigitalDownloadController } from './modules/catalog/controllers/marketplace-digital-download.controller';
import { ContentService } from './modules/content/services/content.service';
import { CustomerManagementService } from './modules/customer-management/services/customer-management.service';
import { FinanceService } from './modules/finance/services/finance.service';
import { MarketplaceCommissionRuleService } from './modules/finance/services/commission-rule.service';
import { MarketplaceCustomerRefundService } from './modules/finance/services/marketplace-customer-refund.service';
import { MarketplaceOrderService } from './modules/order/services/marketplace-order.service';
import { CheckoutStockAllocationStrategy } from './modules/inventory/config/checkout-stock-allocation-strategy';
import { releaseStaleCheckoutReservationsTask } from './modules/inventory/config/release-stale-checkout-reservations.task';
import { releaseExpiredCartReservationsTask } from './modules/inventory/config/release-expired-cart-reservations.task';
import { MarketplaceCartReservationService } from './modules/inventory/services/marketplace-cart-reservation.service';
import { VendorOverviewService } from './modules/overview/services/vendor-overview.service';
import { PlatformOverviewService } from './modules/overview/services/platform-overview.service';
import { marketplaceShippingCalculator } from './modules/shipping/config/marketplace-shipping-calculator';
import { MarketplaceShippingService } from './modules/shipping/services/marketplace-shipping.service';
import { CustomerIdentityService } from './modules/identity/services/customer-identity.service';
import { PromotionService } from './modules/promotion/services/promotion.service';
import { PromotionFinanceService } from './modules/promotion/services/promotion-finance.service';
import { PromotionCardGateway } from './modules/promotion/services/promotion-card-gateway.service';
import { PromotionPaymentController } from './modules/promotion/controllers/promotion-payment.controller';
import { MarketplaceCouponService } from './modules/promotion/services/marketplace-coupon.service';
import { MarketplaceRoleService } from './modules/roles/services/marketplace-role.service';
import { SupportService } from './modules/support/services/support.service';
import { multivendorOrderProcess } from './modules/vendor/config/multivendor-order-process';
import { MultivendorSellerStrategy } from './modules/vendor/config/multivendor-order-seller-strategy';
import { multivendorPaymentMethodHandler } from './modules/vendor/config/multivendor-payment-handler';
import { multivendorShippingEligibilityChecker } from './modules/vendor/config/multivendor-shipping-eligibility-checker';
import { MultivendorShippingLineAssignmentStrategy } from './modules/vendor/config/multivendor-shipping-line-assignment-strategy';
import { ConnectedPaymentSetupService } from './modules/vendor/services/connected-payment-setup.service';
import { VendorProvisioningService } from './modules/vendor/services/vendor-provisioning.service';
import { VendorService } from './modules/vendor/services/vendor.service';
import { MarketplaceWishlistService } from './modules/wishlist/services/marketplace-wishlist.service';
import { MarketplaceReportService } from './modules/report/services/marketplace-report.service';
import { MarketplaceVendorEnforcementService } from './modules/report/services/marketplace-vendor-enforcement.service';
import { MarketplaceVendorAppealService } from './modules/report/services/marketplace-vendor-appeal.service';
import { MarketplaceReviewService } from './modules/review/services/marketplace-review.service';
import { MarketplaceReviewRewardService } from './modules/review/services/marketplace-review-reward.service';
import { MarketplacePurchaseRewardService } from './modules/review/services/marketplace-purchase-reward.service';
import { MarketplaceRewardRedemptionService } from './modules/review/services/marketplace-reward-redemption.service';
import { marketplacePermissions } from './permissions';
import { VendorOnboarding, VendorOnboardingFile } from './modules/onboarding/entities/vendor-onboarding.entity';
import { VendorOnboardingService } from './modules/onboarding/services/vendor-onboarding.service';
import { VendorOnboardingAdminResolver, VendorOnboardingDownloadController, VendorOnboardingShopResolver } from './modules/onboarding/onboarding.api';
import { MarketplacePluginOptions } from './types';

@VendurePlugin({
    compatibility: '^3.7.0',
    imports: [PluginCommonModule],
    entities: [
        VendorProfile,
        RoleApplication,
        VendorOnboarding,
        VendorOnboardingFile,
        EmailVerificationChallenge,
        MarketplaceBooking,
        MarketplaceChatAttachment,
        MarketplaceChatConversation,
        MarketplaceChatMessage,
        MarketplaceChatReadState,
        MarketplaceListingQuote,
        AffiliateProfile,
        SupportCase,
        PromotionCampaign,
        MarketplacePromotionRate,
        MarketplacePromotionRequest,
        MarketplacePromotionSettings,
        MarketplacePromotionPayment,
        MarketplaceCoupon,
        MarketplaceCouponRedemption,
        MarketplaceCommissionRule,
        MarketplaceCustomerRefund,
        MarketplacePayoutBatch,
        MarketplacePayoutSettings,
        PayoutLedgerEntry,
        MarketplaceArticle,
        MarketplaceCustomerConsentRecord,
        MarketplaceCustomerDataRequest,
        VendorShippingProfile,
        MarketplaceWishlist,
        MarketplaceWishlistItem,
        MarketplaceReport,
        MarketplaceReportEvidence,
        MarketplaceVendorEnforcement,
        MarketplaceVendorAppeal,
        MarketplaceVendorAppealEvidence,
        MarketplaceCartReservation,
        MarketplaceReview,
        MarketplaceReviewMedia,
        MarketplacePurchaseRewardGrant,
        MarketplacePurchaseRewardRule,
        MarketplaceReviewRewardGrant,
        MarketplaceReviewRewardSettings,
        MarketplaceRewardWalletTransaction,
        MarketplaceRewardRedemptionSettings,
        MarketplaceRewardRedemption,
        MarketplaceProductView,
        MarketplaceFormTemplate,
        MarketplaceCategory,
        MarketplaceCategoryField,
        MarketplaceListingCategory,
        MarketplaceListingFieldValue,
        MarketplaceServicePackage,
        MarketplaceVendorCategoryRequest,
        MarketplaceVendorCategoryRequestDocument,
        MarketplaceAvailabilitySession,
        MarketplaceEventTicketType,
        MarketplaceEventScheduleItem,
        MarketplaceDigitalFile,
        MarketplaceDigitalDownloadGrant,
    ],
    controllers: [MarketplaceDigitalDownloadController, PromotionPaymentController, VendorOnboardingDownloadController],
    providers: [
        VendorService,
        RoleApplicationService,
        VendorOnboardingService,
        CustomerIdentityService,
        VendorProvisioningService,
        ConnectedPaymentSetupService,
        BookingService,
        MarketplaceChatService,
        MarketplaceChatRealtimeService,
        MarketplaceChatGateway,
        MarketplaceCatalogService,
        DigitalFileSecurityService,
        MarketplaceDigitalDownloadService,
        MarketplaceCategoryService,
        MarketplaceVendorCategoryRequestService,
        MarketplaceOrderService,
        PlatformOverviewService,
        VendorOverviewService,
        MarketplaceShippingService,
        AffiliateService,
        SupportService,
        PromotionService,
        PromotionFinanceService,
        PromotionCardGateway,
        MarketplaceCouponService,
        FinanceService,
        CompanyPaymentService,
        MarketplaceCommissionRuleService,
        MarketplaceCustomerRefundService,
        ContentService,
        CustomerManagementService,
        MarketplaceRoleService,
        MarketplaceWishlistService,
        MarketplaceReportService,
        MarketplaceVendorEnforcementService,
        MarketplaceVendorAppealService,
        MarketplaceCartReservationService,
        MarketplaceReviewService,
        MarketplaceReviewRewardService,
        MarketplacePurchaseRewardService,
        MarketplaceRewardRedemptionService,
        {
            provide: MARKETPLACE_PLUGIN_OPTIONS,
            useFactory: () => MarketplacePlugin.options,
        },
    ],
    configuration: config => {
        config.apiOptions.middleware ??= [];
        config.apiOptions.middleware.push({
            route: '/marketplace-promotions/stripe-webhook',
            beforeListen: true,
            handler: raw({ type: 'application/json', limit: '1mb' }),
        });
        config.authOptions.customPermissions.push(...marketplacePermissions);
        config.paymentOptions.paymentMethodHandlers.push(multivendorPaymentMethodHandler);
        config.orderOptions.process = [
            configureDefaultOrderProcess({
                checkFulfillmentStates: false,
                arrangingPaymentRequiresShipping: false,
                arrangingPaymentRequiresStock: false,
            }),
            multivendorOrderProcess,
        ];
        config.orderOptions.stockAllocationStrategy = new CheckoutStockAllocationStrategy();
        config.orderOptions.orderItemPriceCalculationStrategy = new MarketplaceQuotePriceCalculationStrategy();
        config.schedulerOptions.tasks = [
            ...(config.schedulerOptions.tasks ?? []),
            releaseStaleCheckoutReservationsTask,
            releaseExpiredCartReservationsTask,
            releaseExpiredPendingBookingsTask,
            sendSubscriptionRenewalEmailsTask,
            prepareMarketplacePayoutsTask,
        ];
        config.orderOptions.orderSellerStrategy = new MultivendorSellerStrategy();
        config.catalogOptions.productVariantPriceUpdateStrategy =
            new DefaultProductVariantPriceUpdateStrategy({ syncPricesAcrossChannels: true });
        config.shippingOptions.shippingEligibilityCheckers.push(multivendorShippingEligibilityChecker);
        config.shippingOptions.shippingCalculators.push(marketplaceShippingCalculator);
        config.shippingOptions.shippingLineAssignmentStrategy =
            new MultivendorShippingLineAssignmentStrategy();
        config.customFields.Product.push(
            {
                name: 'marketplaceType',
                type: 'string',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace product type' }],
            },
            {
                name: 'vendorProfileId',
                type: 'string',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Vendor profile ID' }],
            },
            {
                name: 'marketplaceMetadata',
                type: 'text',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Type-specific marketplace metadata' }],
            },
        );
        config.customFields.ProductVariant.push(
            {
                name: 'lowStockThreshold',
                type: 'int',
                public: true,
                defaultValue: 5,
                label: [{ languageCode: LanguageCode.en, value: 'Low stock alert level' }],
            },
            {
                name: 'allowBackorders',
                type: 'boolean',
                public: true,
                defaultValue: false,
                label: [{ languageCode: LanguageCode.en, value: 'Allow backorders' }],
            },
            {
                name: 'backorderLimit',
                type: 'int',
                public: true,
                defaultValue: 0,
                label: [{ languageCode: LanguageCode.en, value: 'Backorder limit' }],
            },
            {
                name: 'maxOrderQuantity',
                type: 'int',
                public: true,
                defaultValue: 0,
                label: [{ languageCode: LanguageCode.en, value: 'Maximum order quantity' }],
            },
            {
                name: 'capacity',
                type: 'int',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Booking or ticket capacity' }],
            },
            {
                name: 'availabilityStartsAt',
                type: 'datetime',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Availability starts at' }],
            },
            {
                name: 'availabilityEndsAt',
                type: 'datetime',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Availability ends at' }],
            },
        );
        config.customFields.Seller.push(
            {
                name: 'vendorProfileId',
                type: 'string',
                public: false,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Vendor profile ID' }],
            },
            {
                name: 'connectedAccountId',
                type: 'string',
                public: false,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Connected payout account ID' }],
            },
        );
        config.customFields.Customer.push(
            {
                name: 'loyaltyPoints',
                type: 'int',
                public: false,
                defaultValue: 0,
                label: [{ languageCode: LanguageCode.en, value: 'Loyalty points' }],
            },
            {
                name: 'referralCode',
                type: 'string',
                public: false,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Referral code' }],
            },
        );
        config.customFields.Order.push(
            {
                name: 'affiliateCode',
                type: 'string',
                public: false,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Affiliate attribution code' }],
            },
            {
                name: 'marketplaceStatus',
                type: 'string',
                public: true,
                defaultValue: 'PENDING',
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace fulfillment status' }],
            },
            {
                name: 'marketplaceTrackingCode',
                type: 'string',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace tracking code' }],
            },
            {
                name: 'marketplaceStatusNote',
                type: 'text',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Customer-facing marketplace status note' }],
            },
            {
                name: 'marketplaceCustomerNotes',
                type: 'text',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Customer notes by marketplace vendor' }],
            },
            {
                name: 'marketplaceConfirmedAt',
                type: 'datetime',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace confirmed at' }],
            },
            {
                name: 'marketplaceStatusUpdatedAt',
                type: 'datetime',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace status updated at' }],
            },
            {
                name: 'marketplaceDeliveredAt',
                type: 'datetime',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace delivered at' }],
            },
        );
        config.customFields.OrderLine.push(
            {
                name: 'marketplaceQuoteId',
                type: 'string',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace personalized quote ID' }],
            },
            {
                name: 'marketplaceBookingId',
                type: 'string',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace paid booking ID' }],
            },
            {
                name: 'marketplaceRenewalBookingId',
                type: 'string',
                public: true,
                nullable: true,
                label: [{ languageCode: LanguageCode.en, value: 'Marketplace subscription renewal booking ID' }],
            },
        );
        return config;
    },
    shopApiExtensions: {
        schema: shopApiExtensions,
        resolvers: [ShopMarketplaceResolver, VendorOnboardingShopResolver],
    },
    adminApiExtensions: {
        schema: adminApiExtensions,
        resolvers: [AdminMarketplaceResolver, VendorOnboardingAdminResolver],
    },
})
export class MarketplacePlugin implements OnApplicationBootstrap {
    static options: MarketplacePluginOptions;

    constructor(
        private processContext: ProcessContext,
        private connectedPaymentSetupService: ConnectedPaymentSetupService,
        private marketplaceShippingService: MarketplaceShippingService,
        private marketplaceCatalogService: MarketplaceCatalogService,
        private marketplaceOrderService: MarketplaceOrderService,
        private marketplaceChatService: MarketplaceChatService,
        private marketplaceCommissionRuleService: MarketplaceCommissionRuleService,
        private marketplacePurchaseRewardService: MarketplacePurchaseRewardService,
        private financeService: FinanceService,
        private requestContextService: RequestContextService,
    ) {}

    static init(options: MarketplacePluginOptions) {
        MarketplacePlugin.options = options;
        return MarketplacePlugin;
    }

    async onApplicationBootstrap() {
        if (this.processContext.isServer) {
            await this.connectedPaymentSetupService.ensureMarketplaceInfrastructure();
            await this.marketplaceShippingService.ensureShippingInfrastructure();
            await this.marketplaceCatalogService.ensureMarketplaceStockLocationVisibility();
            const adminContext = await this.requestContextService.create({ apiType: 'admin' });
            await this.marketplaceCatalogService.ensureDynamicCatalog(adminContext);
            await this.marketplaceCommissionRuleService.ensureDefaultGlobalRule(adminContext);
            await this.marketplacePurchaseRewardService.ensureDefaultGlobalRule(adminContext);
            await this.financeService.ensureDefaultPayoutSettings(adminContext);
            await this.marketplaceOrderService.reconcileDeliveredInventory(adminContext);
            await this.marketplaceOrderService.reconcileCancelledInventory(adminContext);
            await this.marketplaceOrderService.reconcileTerminalOrderLedgers(adminContext);
            await this.marketplaceChatService.reconcileOrderConversations(adminContext);
        }
    }
}
