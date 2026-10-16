import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { ActiveOrderService, Allow, Ctx, ID, Permission, RequestContext, Transaction } from '@vendure/core';

import { AffiliateService } from '../modules/affiliate/services/affiliate.service';
import { RoleApplicationService } from '../modules/applications/services/role-application.service';
import { BookingService } from '../modules/booking/services/booking.service';
import { CreateBookingInput } from '../modules/booking/dto/booking.inputs';
import { MarketplaceCatalogService } from '../modules/catalog/services/marketplace-catalog.service';
import { MarketplaceDigitalDownloadService } from '../modules/catalog/services/marketplace-digital-download.service';
import { ContentService } from '../modules/content/services/content.service';
import { CustomerIdentityService } from '../modules/identity/services/customer-identity.service';
import { MarketplaceOrderService } from '../modules/order/services/marketplace-order.service';
import { MarketplaceShippingService } from '../modules/shipping/services/marketplace-shipping.service';
import { PromotionService } from '../modules/promotion/services/promotion.service';
import { MarketplaceCouponService } from '../modules/promotion/services/marketplace-coupon.service';
import { SupportService } from '../modules/support/services/support.service';
import { VendorService } from '../modules/vendor/services/vendor.service';
import { MarketplaceWishlistService } from '../modules/wishlist/services/marketplace-wishlist.service';
import { MarketplaceReportService } from '../modules/report/services/marketplace-report.service';
import { MarketplaceCartReservationService } from '../modules/inventory/services/marketplace-cart-reservation.service';
import { MarketplaceReviewService } from '../modules/review/services/marketplace-review.service';
import { MarketplaceReviewRewardService } from '../modules/review/services/marketplace-review-reward.service';
import { MarketplacePurchaseRewardService } from '../modules/review/services/marketplace-purchase-reward.service';
import { MarketplaceRewardRedemptionService } from '../modules/review/services/marketplace-reward-redemption.service';
import { VendorOverviewService } from '../modules/overview/services/vendor-overview.service';
import { MarketplaceChatService } from '../modules/chat/services/marketplace-chat.service';
import {
    CreateMarketplaceListingInquiryInput,
    SendMarketplaceChatMessageInput,
} from '../modules/chat/dto/marketplace-chat.inputs';

@Resolver()
export class ShopMarketplaceResolver {
    constructor(
        private vendorService: VendorService,
        private roleApplicationService: RoleApplicationService,
        private customerIdentityService: CustomerIdentityService,
        private bookingService: BookingService,
        private marketplaceCatalogService: MarketplaceCatalogService,
        private marketplaceDigitalDownloadService: MarketplaceDigitalDownloadService,
        private marketplaceOrderService: MarketplaceOrderService,
        private marketplaceShippingService: MarketplaceShippingService,
        private affiliateService: AffiliateService,
        private supportService: SupportService,
        private promotionService: PromotionService,
        private marketplaceCouponService: MarketplaceCouponService,
        private contentService: ContentService,
        private marketplaceWishlistService: MarketplaceWishlistService,
        private marketplaceReportService: MarketplaceReportService,
        private marketplaceCartReservationService: MarketplaceCartReservationService,
        private marketplaceReviewService: MarketplaceReviewService,
        private marketplaceReviewRewardService: MarketplaceReviewRewardService,
        private marketplacePurchaseRewardService: MarketplacePurchaseRewardService,
        private marketplaceRewardRedemptionService: MarketplaceRewardRedemptionService,
        private vendorOverviewService: VendorOverviewService,
        private activeOrderService: ActiveOrderService,
        private marketplaceChatService: MarketplaceChatService,
    ) {}

    @Query()
    @Allow(Permission.Public)
    marketplaceVendor(@Ctx() ctx: RequestContext, @Args() args: { slug: string; location?: any }) {
        return this.vendorService.findPublicBySlug(ctx, args.slug, args.location);
    }

    @Query()
    @Allow(Permission.Public)
    marketplacePublicVendors(@Ctx() ctx: RequestContext, @Args() args: { options?: any; location?: any }) {
        return this.vendorService.findPublic(ctx, args.options, args.location);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceArticles(@Ctx() ctx: RequestContext) {
        return this.contentService.findPublished(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    activeMarketplaceCampaigns(@Ctx() ctx: RequestContext, @Args() args: { placement?: string }) {
        return this.promotionService.findActive(ctx, args.placement);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceBookings(@Ctx() ctx: RequestContext) {
        return this.bookingService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    marketplaceSubscriptionRenewal(@Ctx() ctx: RequestContext, @Args() args: { token: string }) {
        return this.bookingService.findRenewal(ctx, args.token);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceAffiliateProfile(@Ctx() ctx: RequestContext) {
        return this.affiliateService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceSupportCases(@Ctx() ctx: RequestContext) {
        return this.supportService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    marketplaceReturnEligibility(@Ctx() ctx: RequestContext, @Args() args: { sellerOrderId: ID }) {
        return this.supportService.returnEligibility(ctx, args.sellerOrderId);
    }

    @Query()
    @Allow(Permission.Authenticated)
    marketplaceIdentity(@Ctx() ctx: RequestContext) {
        return this.roleApplicationService.getIdentity(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    trackMarketplaceRoleApplication(
        @Ctx() ctx: RequestContext,
        @Args() args: { reference: string; emailAddress: string },
    ) {
        return this.roleApplicationService.track(ctx, args.reference, args.emailAddress);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceProductCategories(@Ctx() ctx: RequestContext) {
        return this.marketplaceCatalogService.getCategoryDefinitions(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceCategoryTree(@Ctx() ctx: RequestContext) {
        return this.marketplaceCatalogService.categoryTree(ctx, false);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceCategoryFormSchema(@Ctx() ctx: RequestContext, @Args() args: { categoryId: ID }) {
        return this.marketplaceCatalogService.categoryFormSchema(ctx, String(args.categoryId), true);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceCatalogProducts(
        @Ctx() ctx: RequestContext,
        @Args() args: { categoryCode?: string; term?: string; location?: any; filter?: any; sort?: string },
    ) {
        return this.marketplaceCatalogService.listPublicProducts(ctx, args.categoryCode, args.term, args.location, args.filter, args.sort);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceCatalogProduct(@Ctx() ctx: RequestContext, @Args() args: { slug: string; location?: any }) {
        return this.marketplaceCatalogService.findPublicProductBySlug(ctx, args.slug, args.location);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceOrders(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: { skip?: number; take?: number } },
    ) {
        return this.marketplaceOrderService.listCustomerOrders(ctx, args.options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceSellerOrders(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: { skip?: number; take?: number } },
    ) {
        return this.marketplaceOrderService.listCustomerSellerOrders(ctx, args.options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceChatConversations(@Ctx() ctx: RequestContext, @Args() args: { options?: any }) {
        return this.marketplaceChatService.listCustomerConversations(ctx, args.options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceChatConversation(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.customerConversation(ctx, String(args.id));
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceChatSocketTicket(@Ctx() ctx: RequestContext) {
        return this.marketplaceChatService.customerSocketTicket(ctx);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceChatAttachment(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.customerAttachment(ctx, String(args.id));
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceListingQuote(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.customerListingQuote(ctx, String(args.id));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    sendMyMarketplaceChatMessage(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: SendMarketplaceChatMessageInput },
    ) {
        return this.marketplaceChatService.sendCustomerMessage(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    createMyMarketplaceListingInquiry(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: CreateMarketplaceListingInquiryInput },
    ) {
        return this.marketplaceChatService.createCustomerListingInquiry(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    confirmMyMarketplaceListingQuoteOrder(
        @Ctx() ctx: RequestContext,
        @Args() args: { quoteId: ID; orderId: ID },
    ) {
        return this.marketplaceChatService.confirmCustomerListingQuoteOrder(ctx, String(args.quoteId), String(args.orderId));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    markMyMarketplaceChatConversationRead(@Ctx() ctx: RequestContext, @Args() args: { id: ID }) {
        return this.marketplaceChatService.markCustomerConversationRead(ctx, String(args.id));
    }

    @Mutation()
    @Allow(Permission.Authenticated)
    uploadMyMarketplaceChatAttachments(
        @Ctx() ctx: RequestContext,
        @Args() args: { conversationId: ID; files: Array<Promise<any>> },
    ) {
        return this.marketplaceChatService.uploadCustomerAttachments(
            ctx,
            String(args.conversationId),
            args.files.map(file => ({ file })),
        );
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceShippingQuote(
        @Ctx() ctx: RequestContext,
        @Args() args: { items: any[]; destination: any },
    ) {
        return this.marketplaceShippingService.quote(ctx, args.items, args.destination);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceWishlists(@Ctx() ctx: RequestContext) {
        return this.marketplaceWishlistService.findMine(ctx);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceSharedWishlist(
        @Ctx() ctx: RequestContext,
        @Args() args: { token: string; accessKey?: string },
    ) {
        return this.marketplaceWishlistService.findShared(ctx, args.token, args.accessKey);
    }

    @Query()
    @Allow(Permission.Authenticated)
    myMarketplaceReviews(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: { skip?: number; take?: number } },
    ) {
        return this.marketplaceReviewService.findMine(ctx, args.options);
    }

    @Query()
    @Allow(Permission.Authenticated)
    async myMarketplaceRewardWallet(@Ctx() ctx: RequestContext) {
        return {
            ...await this.marketplaceReviewRewardService.myWallet(ctx),
            redemptionSettings: await this.marketplaceRewardRedemptionService.settings(ctx),
        };
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceProductPurchaseReward(@Ctx() ctx: RequestContext, @Args() args: { productId: ID }) {
        return this.marketplacePurchaseRewardService.quoteForProduct(ctx, args.productId);
    }

    @Query()
    @Allow(Permission.Authenticated)
    marketplaceCouponQuote(@Ctx() ctx: RequestContext, @Args() args: { code: string; items: any[] }) {
        return this.marketplaceCouponService.quoteItems(ctx, args.code, args.items);
    }

    @Query()
    @Allow(Permission.Public)
    marketplaceReviews(
        @Ctx() ctx: RequestContext,
        @Args() args: { options?: { skip?: number; take?: number }; filter?: any },
    ) {
        return this.marketplaceReviewService.findPublic(ctx, args.options, args.filter);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    reserveMarketplaceRewardRedemption(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderId: ID; coins: number },
    ) {
        return this.marketplaceRewardRedemptionService.reserve(ctx, String(args.orderId), args.coins);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    releaseMarketplaceRewardRedemption(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderId: ID; reason?: string },
    ) {
        return this.marketplaceRewardRedemptionService.release(ctx, String(args.orderId), args.reason);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    reserveMarketplaceCoupon(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID; code: string }) {
        return this.marketplaceCouponService.reserve(ctx, String(args.orderId), args.code);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    releaseMarketplaceCoupon(@Ctx() ctx: RequestContext, @Args() args: { orderId: ID; reason?: string }) {
        return this.marketplaceCouponService.release(ctx, String(args.orderId), args.reason);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    registerMarketplaceVendor(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.vendorService.register(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    requestMarketplaceCustomerRegistration(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.customerIdentityService.requestRegistration(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    resendMarketplaceCustomerOtp(@Ctx() ctx: RequestContext, @Args() args: { emailAddress: string }) {
        return this.customerIdentityService.resendRegistrationOtp(ctx, args.emailAddress);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    verifyMarketplaceCustomerOtp(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.customerIdentityService.verifyRegistrationOtp(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    submitMarketplaceRoleApplication(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.roleApplicationService.submit(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    reserveMarketplaceCartItem(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceCartReservationService.reserve(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    releaseMarketplaceCartItem(
        @Ctx() ctx: RequestContext,
        @Args() args: { cartToken: string; variantId?: string },
    ) {
        return this.marketplaceCartReservationService.release(ctx, args.cartToken, args.variantId);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    consumeMarketplaceCartReservations(
        @Ctx() ctx: RequestContext,
        @Args() args: { cartToken: string; items: any[] },
    ) {
        return this.marketplaceCartReservationService.consume(ctx, args.cartToken, args.items);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    async prepareMarketplaceCartCheckout(
        @Ctx() ctx: RequestContext,
        @Args() args: { cartToken: string; items: any[] },
    ) {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined, true);
        return this.marketplaceCartReservationService.prepareCheckout(
            ctx,
            args.cartToken,
            args.items,
            order.id,
        );
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    createMarketplaceWishlist(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceWishlistService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    updateMarketplaceWishlist(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceWishlistService.update(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    deleteMarketplaceWishlist(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.marketplaceWishlistService.delete(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    addMarketplaceWishlistItem(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceWishlistService.addItem(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    removeMarketplaceWishlistItem(
        @Ctx() ctx: RequestContext,
        @Args() args: { wishlistId: string; itemId: string },
    ) {
        return this.marketplaceWishlistService.removeItem(ctx, args.wishlistId, args.itemId);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    enableMarketplaceWishlistShare(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: string; visibility: 'PUBLIC' | 'PRIVATE' },
    ) {
        return this.marketplaceWishlistService.enableShare(ctx, args.id, args.visibility);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    disableMarketplaceWishlistShare(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.marketplaceWishlistService.disableShare(ctx, args.id);
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
    @Allow(Permission.Authenticated)
    uploadMarketplaceReviewMedia(@Ctx() ctx: RequestContext, @Args() args: { files: Array<Promise<any>> }) {
        return this.marketplaceReviewService.uploadMedia(ctx, args.files.map(file => ({ file })));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    submitMarketplaceReview(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.marketplaceReviewService.submit(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    deleteMarketplaceReview(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.marketplaceReviewService.delete(ctx, args.id);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Public)
    recordMarketplaceProductView(
        @Ctx() ctx: RequestContext,
        @Args() args: { productId: string; sessionId: string },
    ) {
        return this.vendorOverviewService.recordProductView(ctx, args.productId, args.sessionId);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    createMarketplaceBooking(@Ctx() ctx: RequestContext, @Args() args: { input: CreateBookingInput }) {
        return this.bookingService.create(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    requestMarketplaceSubscriptionCancellation(
        @Ctx() ctx: RequestContext,
        @Args() args: { id: ID; reason?: string },
    ) {
        return this.bookingService.requestCancellation(ctx, { id: args.id, reason: args.reason });
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    requestMarketplaceDigitalDownload(@Ctx() ctx: RequestContext, @Args() args: { fileId: ID }) {
        return this.marketplaceDigitalDownloadService.requestGrant(ctx, String(args.fileId));
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    applyAsMarketplaceAffiliate(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.affiliateService.apply(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    openMarketplaceSupportCase(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.supportService.open(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    openMarketplaceReturnCase(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.supportService.openReturnCase(ctx, args.input);
    }

    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    replyToMarketplaceSupportCase(@Ctx() ctx: RequestContext, @Args() args: { input: any }) {
        return this.supportService.replyAsOwner(ctx, {
            ...args.input,
            authorRole: 'CUSTOMER',
        });
    }
}
