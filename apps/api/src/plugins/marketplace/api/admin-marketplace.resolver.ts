import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { AffiliateService } from '../modules/affiliate/services/affiliate.service';
import { RoleApplicationService } from '../modules/applications/services/role-application.service';
import { BookingService } from '../modules/booking/services/booking.service';
import {
    CreateMarketplaceCategoryInput,
    CreateMarketplaceFormTemplateInput,
    CreateMarketplaceProductInput,
    MarketplaceInventoryUpdateInput,
    UpdateMarketplaceCategoryInput,
    UpdateMarketplaceFormTemplateInput,
    UpdateMarketplaceProductInput,
    UpsertMarketplaceCategoryFieldInput,
} from '../modules/catalog/dto/marketplace-product.inputs';
import { MarketplaceCatalogService } from '../modules/catalog/services/marketplace-catalog.service';
import { MarketplaceVendorCategoryRequestService } from '../modules/catalog/services/marketplace-vendor-category-request.service';
import {
    ReviewMarketplaceVendorCategoryRequestInput,
    SubmitMarketplaceVendorCategoryRequestInput,
} from '../modules/catalog/dto/marketplace-vendor-category-request.inputs';
import { ContentService } from '../modules/content/services/content.service';
import { CustomerManagementService } from '../modules/customer-management/services/customer-management.service';
import { FinanceService } from '../modules/finance/services/finance.service';
import { MarketplaceCommissionRuleService } from '../modules/finance/services/commission-rule.service';
import { MarketplaceCustomerRefundService } from '../modules/finance/services/marketplace-customer-refund.service';
import {
    CreateMarketplaceCustomerRefundInput,
    ProcessMarketplaceCustomerRefundInput,
} from '../modules/finance/dto/marketplace-customer-refund.inputs';
import { MarketplaceOrderService } from '../modules/order/services/marketplace-order.service';
import { MarketplaceChatService } from '../modules/chat/services/marketplace-chat.service';
import {
    CreateMarketplaceListingQuoteInput,
    SendMarketplaceChatMessageInput,
} from '../modules/chat/dto/marketplace-chat.inputs';
import { VendorOverviewService } from '../modules/overview/services/vendor-overview.service';
import { PlatformOverviewService } from '../modules/overview/services/platform-overview.service';
import { MarketplaceReviewService } from '../modules/review/services/marketplace-review.service';
import { MarketplaceReviewRewardService } from '../modules/review/services/marketplace-review-reward.service';
import { MarketplacePurchaseRewardService } from '../modules/review/services/marketplace-purchase-reward.service';
import { MarketplaceRewardRedemptionService } from '../modules/review/services/marketplace-reward-redemption.service';
import { UpdateMarketplaceReviewRewardSettingsInput } from '../modules/review/dto/marketplace-review-reward.inputs';
import {
    CreateMarketplacePurchaseRewardRuleInput,
    UpdateMarketplacePurchaseRewardRuleInput,
} from '../modules/review/dto/marketplace-purchase-reward.inputs';
import { UpdateMarketplaceRewardRedemptionSettingsInput } from '../modules/review/dto/marketplace-reward-redemption.inputs';
import { MarketplaceShippingService } from '../modules/shipping/services/marketplace-shipping.service';
import { MarketplaceReportService } from '../modules/report/services/marketplace-report.service';
import { MarketplaceVendorEnforcementService } from '../modules/report/services/marketplace-vendor-enforcement.service';
import { MarketplaceVendorAppealService } from '../modules/report/services/marketplace-vendor-appeal.service';
import { PromotionService } from '../modules/promotion/services/promotion.service';
import { PromotionFinanceService } from '../modules/promotion/services/promotion-finance.service';
import { MarketplaceCouponService } from '../modules/promotion/services/marketplace-coupon.service';
import { MarketplaceRoleService } from '../modules/roles/services/marketplace-role.service';
import { SupportService } from '../modules/support/services/support.service';
import { VendorService } from '../modules/vendor/services/vendor.service';
import { CompanyPaymentService } from '../modules/vendor/services/company-payment.service';
import { VendorProvisioningService } from '../modules/vendor/services/vendor-provisioning.service';
import {
    affiliatePermission,
    approvePayoutPermission,
    applicationPermission,
    bookingPermission,
    contentPermission,
    financePermission,
    promotionPermission,
    supportPermission,
    vendorPermission,
} from '../permissions';
import { MarketplaceListOptions } from '../shared/pagination';

@Resolver()
export class AdminMarketplaceResolver {
    constructor(
        private roleService: MarketplaceRoleService,
        private roleApplicationService: RoleApplicationService,
        private vendorService: VendorService,
        private vendorProvisioningService: VendorProvisioningService,
        private bookingService: BookingService,
        private marketplaceCatalogService: MarketplaceCatalogService,
        private marketplaceVendorCategoryRequestService: MarketplaceVendorCategoryRequestService,
        private affiliateService: AffiliateService,
        private supportService: SupportService,
        private promotionService: PromotionService,
        private promotionFinanceService: PromotionFinanceService,
        private marketplaceCouponService: MarketplaceCouponService,
        private contentService: ContentService,
        private customerManagementService: CustomerManagementService,
        private financeService: FinanceService,
        private companyPaymentService: CompanyPaymentService,
        private marketplaceCommissionRuleService: MarketplaceCommissionRuleService,
        private marketplaceCustomerRefundService: MarketplaceCustomerRefundService,
        private marketplaceOrderService: MarketplaceOrderService,
        private marketplaceChatService: MarketplaceChatService,
        private platformOverviewService: PlatformOverviewService,
        private vendorOverviewService: VendorOverviewService,
        private marketplaceReviewService: MarketplaceReviewService,
        private marketplaceReviewRewardService: MarketplaceReviewRewardService,
        private marketplacePurchaseRewardService: MarketplacePurchaseRewardService,
        private marketplaceRewardRedemptionService: MarketplaceRewardRedemptionService,
        private marketplaceShippingService: MarketplaceShippingService,
        private marketplaceReportService: MarketplaceReportService,
        private marketplaceVendorEnforcementService: MarketplaceVendorEnforcementService,
        private marketplaceVendorAppealService: MarketplaceVendorAppealService,
    ) {}

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    confirmMarketplaceCompanyReceipt(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID; amount: number; reference: string }) {
        return this.companyPaymentService.confirmReceipt(ctx, args.orderId, args.amount, args.reference);
    }

    @Query()
    @Allow(Permission.ReadAdministrator)
    marketplaceRoleTemplates() {
        return this.roleService.listTemplates();
    }

    @Query()
    @Allow(vendorPermission.Read)
    marketplaceVendors(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; status?: string },
    ) {
        return this.vendorService.findAll(ctx, args.options, args.status);
    }

    @Query()
    @Allow(vendorPermission.Read)
    myMarketplaceVendorProfile(@Ctx() ctx: RequestContext) {
        return this.vendorService.findMine(ctx);
    }

    @Query()
    @Allow(bookingPermission.Read)
    marketplaceBookings(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions },
    ) {
        return this.bookingService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(affiliatePermission.Read)
    marketplaceAffiliates(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions },
    ) {
        return this.affiliateService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(supportPermission.Read)
    marketplaceSupportCases(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions },
    ) {
        return this.supportService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceReturnCases(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; sellerOrderIds?: ID[] },
    ) {
        return this.supportService.findReturnCases(ctx, args.options, args.sellerOrderIds);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceVendorReturnCases(@Ctx() ctx: RequestContext) {
        return this.supportService.findVendorReturnCases(ctx);
    }

    @Query()
    @Allow(promotionPermission.Read)
    marketplacePromotionCampaigns(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions },
    ) {
        return this.promotionService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(promotionPermission.Read)
    marketplacePromotionRates(@Ctx() ctx: RequestContext) {
        return this.promotionService.findRates(ctx);
    }

    @Query()
    @Allow(promotionPermission.Read)
    async marketplacePromotionTargets(@Ctx() ctx: RequestContext) {
        const canCreate = ctx.userHasPermissions([promotionPermission.Create]);
        const canUpdate = ctx.userHasPermissions([promotionPermission.Update]);
        return {
            ...await this.promotionService.targets(ctx),
            canManage: canCreate || canUpdate,
            canCreate,
            canUpdate,
        };
    }

    @Query()
    @Allow(promotionPermission.Read)
    marketplacePromotionRequests(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; status?: string },
    ) {
        return this.promotionService.findRequests(ctx, args.status, false, args.options);
    }

    @Query()
    @Allow(Permission.ReadPromotion, promotionPermission.Read)
    myMarketplacePromotionRequests(@Ctx() ctx: RequestContext) {
        return this.promotionService.findRequests(ctx, undefined, true);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    myMarketplacePromotionRates(@Ctx() ctx: RequestContext) {
        return this.promotionService.findRates(ctx, true);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    myMarketplacePromotionCampaigns(@Ctx() ctx: RequestContext) {
        return this.promotionService.vendorCampaigns(ctx);
    }

    @Query()
    @Allow(Permission.ReadPromotion, promotionPermission.Read)
    marketplacePromotionSettings(@Ctx() ctx: RequestContext) {
        return this.promotionService.settings(ctx);
    }

    @Query()
    @Allow(Permission.ReadPromotion, promotionPermission.Read)
    marketplacePromotionPaymentOptions(@Ctx() ctx: RequestContext) {
        return this.promotionService.paymentOptions(ctx);
    }

    @Query()
    @Allow(promotionPermission.Read, financePermission.Update, approvePayoutPermission.Permission)
    marketplacePromotionPayments(@Ctx() ctx: RequestContext, @Args() args: { input?: any }) {
        return this.promotionFinanceService.dashboard(ctx, args.input);
    }

    @Query()
    @Allow(Permission.ReadPromotion)
    myMarketplacePromotionQuote(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.quote(ctx, args.input);
    }

    @Query()
    @Allow(contentPermission.Read)
    marketplaceArticleList(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions },
    ) {
        return this.contentService.findAll(ctx, args.options);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplacePayoutLedger(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; beneficiaryId?: string },
    ) {
        return this.financeService.findAll(ctx, args.options, args.beneficiaryId);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceCommissionRules(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; filter?: any },
    ) {
        return this.marketplaceCommissionRuleService.findAll(ctx, args.options, args.filter);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceCoupons(@Ctx() ctx: RequestContext, @Args() args: { options?: MarketplaceListOptions; filter?: any }) {
        return this.marketplaceCouponService.findAll(ctx, args.options, args.filter);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceCouponDashboard(@Ctx() ctx: RequestContext) {
        return this.marketplaceCouponService.dashboard(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceVendorPayoutAccounts(
        @Ctx() ctx: RequestContext,
        @Args() args: { status?: string },
    ) {
        return this.financeService.vendorPayoutAccounts(ctx, args.status);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceManagedCustomers(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; filter?: any },
    ) {
        return this.customerManagementService.findAll(ctx, args.options, args.filter);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceManagedCustomer(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.customerManagementService.findOne(ctx, args.id);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceManagedCustomerExport(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.customerManagementService.exportCustomerData(ctx, args.id);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    async marketplaceReviewRewardDashboard(@Ctx() ctx: RequestContext) {
        return {
            ...await this.marketplaceReviewRewardService.adminDashboard(ctx),
            purchaseRules: await this.marketplacePurchaseRewardService.findAll(ctx),
            ...await this.marketplaceRewardRedemptionService.dashboard(ctx),
        };
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    myMarketplaceVendorCategoryAccess(@Ctx() ctx: RequestContext) {
        return this.marketplaceVendorCategoryRequestService.vendorDashboard(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceVendorCategoryRequests(@Ctx() ctx: RequestContext, @Args() args: { status?: string }) {
        return this.marketplaceVendorCategoryRequestService.findAll(ctx, args.status);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceFinanceDashboard(@Ctx() ctx: RequestContext) {
        return this.financeService.dashboard(ctx);
    }

    @Query()
    @Allow(financePermission.Read)
    myMarketplaceVendorFinance(@Ctx() ctx: RequestContext) {
        return this.financeService.myVendorFinance(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceVendorFinanceStatement(@Ctx() ctx: RequestContext, @Args() args: { vendorId: ID }) {
        return this.financeService.vendorStatement(ctx, args.vendorId);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceFinanceReport(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.generateReport(ctx, args.input);
    }

    @Query()
    @Allow(Permission.Authenticated)
    marketplaceIdentity(@Ctx() ctx: RequestContext) {
        return this.roleApplicationService.getIdentity(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin, applicationPermission.Read)
    marketplaceRoleApplications(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; status?: any; role?: any },
    ) {
        return this.roleApplicationService.findAll(ctx, args.options, args.status, args.role);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    marketplaceProductCategories(@Ctx() ctx: RequestContext) {
        return this.marketplaceCatalogService.getCategoryDefinitions(ctx);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    marketplaceCategoryTree(
        @Ctx() ctx: RequestContext,
        @Args() args: { includeInactive?: boolean },
    ) {
        const includeInactive = args.includeInactive === true && ctx.userHasPermissions([Permission.SuperAdmin]);
        return this.marketplaceCatalogService.categoryTree(ctx, includeInactive);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    marketplaceCategories(
        @Ctx() ctx: RequestContext,
        @Args() args: { includeInactive?: boolean },
    ) {
        if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
            return this.marketplaceCatalogService.vendorCategories(ctx);
        }
        return this.marketplaceCatalogService.categories(ctx, args.includeInactive === true);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    marketplaceCategoryFormSchema(@Ctx() ctx: RequestContext, @Args() args: { categoryId: ID }) {
        return this.marketplaceCatalogService.categoryFormSchema(
            ctx,
            String(args.categoryId),
            !ctx.userHasPermissions([Permission.SuperAdmin]),
        );
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceFormTemplates(
        @Ctx() ctx: RequestContext,
        @Args() args: { includeInactive?: boolean },
    ) {
        return this.marketplaceCatalogService.formTemplates(ctx, args.includeInactive === true);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceCategoryFields(@Ctx() ctx: RequestContext, @Args() args: { categoryId: ID }) {
        return this.marketplaceCatalogService.categoryFields(ctx, String(args.categoryId));
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    myMarketplaceProducts(@Ctx() ctx: RequestContext) {
        return this.marketplaceCatalogService.listVendorProducts(ctx);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    myMarketplaceProduct(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceCatalogService.findVendorProduct(ctx, args.id);
    }

    @Query()
    @Allow(Permission.ReadCatalog)
    myMarketplaceInventory(@Ctx() ctx: RequestContext) {
        return this.marketplaceCatalogService.getVendorInventory(ctx);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    myMarketplaceVendorOrders(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: any; filter?: any },
    ) {
        return this.marketplaceOrderService.listVendorOrders(ctx, args.options, args.filter);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    myMarketplaceVendorOverview(@Ctx() ctx: RequestContext) {
        return this.vendorOverviewService.getOverview(ctx);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    myMarketplaceVendorReviewDashboard(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions },
    ) {
        return this.marketplaceReviewService.vendorDashboard(ctx, args.options);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplacePlatformOverview(@Ctx() ctx: RequestContext) {
        return this.platformOverviewService.getOverview(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceCustomerRefunds(@Ctx() ctx: RequestContext, @Args() args: { status?: string }) {
        return this.marketplaceCustomerRefundService.dashboard(ctx, args.status);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceOrders(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: any; filter?: any },
    ) {
        return this.marketplaceOrderService.listAdminOrders(ctx, args.options, args.filter);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    marketplaceChatConversations(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
        return this.marketplaceChatService.listAdminConversations(ctx, args.options);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    marketplaceChatConversation(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.adminConversation(ctx, String(args.id));
    }

    @Query()
    @Allow(Permission.ReadOrder)
    marketplaceChatSocketTicket(@Ctx() ctx: RequestContext) {
        return this.marketplaceChatService.adminSocketTicket(ctx);
    }

    @Query()
    @Allow(Permission.ReadOrder)
    marketplaceChatAttachment(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.adminAttachment(ctx, String(args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadOrder)
    sendMarketplaceChatMessage(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SendMarketplaceChatMessageInput },
    ) {
        return this.marketplaceChatService.sendAdminMessage(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadOrder)
    createMarketplaceListingQuote(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateMarketplaceListingQuoteInput },
    ) {
        return this.marketplaceChatService.createVendorListingQuote(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadOrder)
    markMarketplaceChatConversationRead(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.markAdminConversationRead(ctx, String(args.id));
    }

    @Mutation()
    @Allow(Permission.ReadOrder)
    uploadMarketplaceChatAttachments(
        @Ctx() ctx: RequestContext,
        @Args() args: { conversationId: ID; files: Array<Promise<any>> },
    ) {
        return this.marketplaceChatService.uploadAdminAttachments(
            ctx,
            String(args.conversationId),
            args.files.map(file => ({ file })),
        );
    }

    @Query()
    @Allow(vendorPermission.Read)
    myMarketplaceShippingProfile(@Ctx() ctx: RequestContext) {
        return this.marketplaceShippingService.getMyProfile(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceReports(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; filter?: any },
    ) {
        return this.marketplaceReportService.findAll(ctx, args.options, args.filter);
    }

    @Query()
    @Allow(vendorPermission.Read)
    myMarketplaceVendorEnforcements(@Ctx() ctx: RequestContext) {
        return this.marketplaceVendorEnforcementService.findMine(ctx);
    }

    @Query()
    @Allow(vendorPermission.Read)
    myMarketplaceVendorAppeals(@Ctx() ctx: RequestContext) {
        return this.marketplaceVendorAppealService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.SuperAdmin)
    marketplaceVendorAppeals(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: MarketplaceListOptions; status?: string },
    ) {
        return this.marketplaceVendorAppealService.findAll(ctx, args.options, args.status);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    initializeMarketplaceRoles(@Ctx() ctx: RequestContext) {
        return this.roleService.initializePlatformRoles(ctx);
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    reviewMarketplaceVendor(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.vendorService.review(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    provisionMarketplaceVendor(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.vendorProvisioningService.provision(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    updateMyMarketplaceVendorStorefront(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.vendorService.updateMine(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(bookingPermission.Update)
    updateMarketplaceBookingStatus(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.bookingService.updateStatus(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(affiliatePermission.Update)
    reviewMarketplaceAffiliate(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.affiliateService.review(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(supportPermission.Update)
    adminReplyToMarketplaceSupportCase(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.supportService.replyAsAdmin(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(supportPermission.Update, financePermission.Update)
    resolveMarketplaceSupportCase(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.supportService.resolve(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    vendorReplyToMarketplaceReturnCase(@Ctx() ctx: RequestContext, @Args() args: { id: ID; body: string }) {
        return this.supportService.replyAsVendor(ctx, args.id, args.body);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    adminMessageMarketplaceReturnVendor(@Ctx() ctx: RequestContext, @Args() args: { id: ID; body: string }) {
        return this.supportService.messageReturnVendor(ctx, args.id, args.body);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    decideMarketplaceReturnCase(@Ctx() ctx: RequestContext, @Args() args: {
        id: ID; decision: string; note: string; requiresReturn?: boolean;
    }) {
        return this.supportService.decideReturnCase(ctx, args.id, args.decision, args.note, args.requiresReturn);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    markMarketplaceReturnReceived(@Ctx() ctx: RequestContext, @Args() args: { id: ID; note: string }) {
        return this.supportService.markReturnReceived(ctx, args.id, args.note);
    }

    @Mutation()
    @Transaction()
    @Allow(promotionPermission.Create)
    createMarketplacePromotion(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(promotionPermission.Update)
    updateMarketplacePromotion(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(promotionPermission.Update)
    reviewMarketplacePromotion(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.review(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin, promotionPermission.Create)
    createMarketplacePromotionRate(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.createRate(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadPromotion, promotionPermission.Create)
    createMarketplacePromotionRequest(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.createRequest(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadPromotion, promotionPermission.Create)
    submitMarketplacePromotionPayment(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.submitPayment(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadPromotion)
    createMarketplacePromotionCardCheckout(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.promotionService.createCardCheckout(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadPromotion)
    syncMarketplacePromotionCardCheckout(@Ctx() ctx: RequestContext, @Args() args: { sessionId: string }) {
        return this.promotionService.syncCardCheckout(ctx, args.sessionId);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadPromotion)
    cancelMarketplacePromotionCardCheckout(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.promotionService.cancelCardCheckout(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(promotionPermission.Update)
    reviewMarketplacePromotionRequest(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.reviewRequest(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(promotionPermission.Update)
    updateMarketplacePromotionSettings(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.promotionService.updateSettings(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.ReadPromotion)
    cancelMyMarketplacePromotionRequest(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.promotionService.cancelMine(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(contentPermission.Create)
    createMarketplaceArticle(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.contentService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(contentPermission.Update)
    updateMarketplaceArticleStatus(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.contentService.updateStatus(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(approvePayoutPermission.Permission)
    approveMarketplacePayout(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; reason: string },
    ) {
        return this.financeService.approve(ctx, args.id, args.reason);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceCommissionRule(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceCommissionRuleService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplaceCommissionRule(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceCommissionRuleService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteMarketplaceCommissionRule(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceCommissionRuleService.delete(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceCoupon(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceCouponService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplaceCoupon(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceCouponService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteMarketplaceCoupon(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceCouponService.delete(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplacePayoutSettings(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.updateSettings(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplacePayoutBatch(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.createPayoutBatch(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    approveMarketplacePayoutBatch(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.approvePayoutBatch(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    processMarketplacePayoutBatch(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.processPayoutBatch(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceLedgerAdjustment(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.createAdjustment(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    updateMyMarketplaceVendorPayoutAccount(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.updateMyVendorPayoutAccount(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    reviewMarketplaceVendorPayoutAccount(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.financeService.reviewVendorPayoutAccount(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceCustomerRefund(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateMarketplaceCustomerRefundInput },
    ) {
        return this.marketplaceCustomerRefundService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    processMarketplaceCustomerRefund(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: ProcessMarketplaceCustomerRefundInput },
    ) {
        return this.marketplaceCustomerRefundService.process(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceCustomerDataRequest(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.customerManagementService.createDataRequest(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    processMarketplaceCustomerDataRequest(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.customerManagementService.processDataRequest(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin, applicationPermission.Update)
    reviewMarketplaceRoleApplication(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.roleApplicationService.review(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    blockMarketplaceRoleApplication(@Ctx() ctx: RequestContext, @Args() args: { id: ID; reason: string }) {
        return this.roleApplicationService.blockVendor(ctx, args.id, args.reason);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    unblockMarketplaceRoleApplication(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.roleApplicationService.unblockVendor(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    approveMarketplaceRoleApplication(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.roleApplicationService.approveAndProvision(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    changeMarketplaceTemporaryPassword(
        @Ctx() ctx: RequestContext,
        @Args() args: { currentPassword: string; newPassword: string },
    ) {
        return this.roleApplicationService.changeTemporaryPassword(
            ctx,
            args.currentPassword,
            args.newPassword,
        );
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.CreateCatalog)
    createMarketplaceProduct(@Ctx() ctx: RequestContext, @Args() args: { input: CreateMarketplaceProductInput }) {
        return this.marketplaceVendorEnforcementService.assertCanManageStore(ctx)
            .then(() => this.marketplaceCatalogService.createVendorProduct(ctx, args.input));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceCategory(@Ctx() ctx: RequestContext, @Args() args: { input: CreateMarketplaceCategoryInput }) {
        return this.marketplaceCatalogService.createCategory(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplaceFormTemplate(@Ctx() ctx: RequestContext, @Args() args: { input: CreateMarketplaceFormTemplateInput }) {
        return this.marketplaceCatalogService.createFormTemplate(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplaceCategory(@Ctx() ctx: RequestContext, @Args() args: { input: UpdateMarketplaceCategoryInput }) {
        return this.marketplaceCatalogService.updateCategory(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    reorderMarketplaceCategories(
        @Ctx() ctx: RequestContext,
        @Args() args: { parentId?: ID; categoryIds: ID[] },
    ) {
        return this.marketplaceCatalogService.reorderCategories(
            ctx,
            args.parentId ? String(args.parentId) : undefined,
            args.categoryIds.map(String),
        );
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteMarketplaceCategory(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceCatalogService.deleteCategory(ctx, String(args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    upsertMarketplaceCategoryField(@Ctx() ctx: RequestContext, @Args() args: { input: UpsertMarketplaceCategoryFieldInput }) {
        return this.marketplaceCatalogService.upsertCategoryField(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteMarketplaceCategoryField(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceCatalogService.deleteCategoryField(ctx, String(args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplaceFormTemplate(@Ctx() ctx: RequestContext, @Args() args: { input: UpdateMarketplaceFormTemplateInput }) {
        return this.marketplaceCatalogService.updateFormTemplate(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    updateMarketplaceProduct(@Ctx() ctx: RequestContext, @Args() args: { input: UpdateMarketplaceProductInput }) {
        return this.marketplaceVendorEnforcementService.assertCanManageStore(ctx)
            .then(() => this.marketplaceCatalogService.updateVendorProduct(ctx, args.input));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    bulkUpdateMarketplaceInventory(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: MarketplaceInventoryUpdateInput[] },
    ) {
        return this.marketplaceVendorEnforcementService.assertCanManageStore(ctx)
            .then(() => this.marketplaceCatalogService.bulkUpdateVendorInventory(ctx, args.input));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    publishMarketplaceProduct(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceVendorEnforcementService.assertCanManageStore(ctx)
            .then(() => this.marketplaceCatalogService.publishVendorProduct(ctx, args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.DeleteCatalog)
    deleteMarketplaceProduct(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceVendorEnforcementService.assertCanManageStore(ctx)
            .then(() => this.marketplaceCatalogService.deleteVendorProduct(ctx, args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    updateMarketplaceOrderStatus(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceOrderService.updateVendorStatus(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateOrder)
    respondToMarketplaceReview(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceReviewService.respondAsVendor(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplaceReviewRewardSettings(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateMarketplaceReviewRewardSettingsInput },
    ) {
        return this.marketplaceReviewRewardService.updateSettings(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplaceRewardRedemptionSettings(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateMarketplaceRewardRedemptionSettingsInput },
    ) {
        return this.marketplaceRewardRedemptionService.updateSettings(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    createMarketplacePurchaseRewardRule(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateMarketplacePurchaseRewardRuleInput },
    ) {
        return this.marketplacePurchaseRewardService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    updateMarketplacePurchaseRewardRule(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: UpdateMarketplacePurchaseRewardRuleInput },
    ) {
        return this.marketplacePurchaseRewardService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    deleteMarketplacePurchaseRewardRule(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplacePurchaseRewardService.delete(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    uploadMarketplaceVendorCategoryRequestDocuments(
        @Ctx() ctx: RequestContext,
        @Args() args: { files: Array<Promise<any>> },
    ) {
        return this.marketplaceVendorCategoryRequestService.uploadDocuments(ctx, args.files.map(file => ({ file })));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    removeMarketplaceVendorCategoryRequestDocument(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceVendorCategoryRequestService.removeUnsubmittedDocument(ctx, String(args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.UpdateCatalog)
    submitMarketplaceVendorCategoryRequest(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SubmitMarketplaceVendorCategoryRequestInput },
    ) {
        return this.marketplaceVendorCategoryRequestService.submit(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    reviewMarketplaceVendorCategoryRequest(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: ReviewMarketplaceVendorCategoryRequestInput },
    ) {
        return this.marketplaceVendorCategoryRequestService.review(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    updateMyMarketplaceShippingProfile(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceVendorEnforcementService.assertCanManageStore(ctx)
            .then(() => this.marketplaceShippingService.updateMyProfile(ctx, args.input));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    reviewMarketplaceReport(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceReportService.review(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    uploadMarketplaceReportEvidence(@Ctx() ctx: RequestContext, @Args() args: { files: Array<Promise<any>> }) {
        return this.marketplaceReportService.uploadEvidence(ctx, args.files.map(file => ({ file })));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    submitMarketplaceReport(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceReportService.submit(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    acknowledgeMarketplaceVendorEnforcement(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceVendorEnforcementService.acknowledgeMine(ctx, String(args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    uploadMarketplaceVendorAppealEvidence(
        @Ctx() ctx: RequestContext,
        @Args() args: { files: Array<Promise<any>> },
    ) {
        return this.marketplaceVendorAppealService.uploadEvidence(ctx, args.files.map(file => ({ file })));
    }

    @Mutation()
    @Transaction()
    @Allow(vendorPermission.Update)
    submitMarketplaceVendorAppeal(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceVendorAppealService.submit(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.SuperAdmin)
    reviewMarketplaceVendorAppeal(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceVendorAppealService.review(ctx, args.input);
    }
}
