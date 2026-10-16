import gql from 'graphql-tag';

import { commonMarketplaceSchema } from './common-schema';
import { onboardingShopSchema } from '../modules/onboarding/onboarding.api';

export const shopApiExtensions = gql`
    ${commonMarketplaceSchema}
    ${onboardingShopSchema}

    input RegisterMarketplaceVendorInput {
        shopName: String!
        slug: String
        ownerFirstName: String!
        ownerLastName: String!
        ownerEmailAddress: String!
        phoneNumber: String
        businessType: String
        description: String
        categories: [String!]
        operatingLocations: [String!]
    }

    input RegisterMarketplaceCustomerInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
        phoneNumber: String
        password: String!
        termsAccepted: Boolean!
        privacyAccepted: Boolean!
        marketingConsent: Boolean
    }

    input VerifyMarketplaceCustomerOtpInput {
        emailAddress: String!
        code: String!
    }

    input SubmitMarketplaceRoleApplicationInput {
        role: String!
        displayName: String!
        firstName: String!
        lastName: String!
        emailAddress: String!
        phoneNumber: String
        businessType: String
        websiteUrl: String
        description: String!
        categories: [String!]
        operatingLocations: [String!]
        profileData: JSON
    }

    input CreateMarketplaceBookingInput {
        vendorProfileId: String!
        productVariantId: String!
        availabilitySessionId: String
        eventTicketTypeId: String
        bookingType: String!
        purchaseMode: String
        title: String!
        startsAt: DateTime!
        endsAt: DateTime!
        quantity: Int
        attendeeDetails: JSON
        customerNote: String
    }

    input ApplyAsMarketplaceAffiliateInput {
        displayName: String!
        slug: String
        bio: String
        channels: JSON
    }

    input OpenMarketplaceSupportCaseInput {
        vendorProfileId: String
        orderId: String
        category: String!
        subject: String!
        message: String!
        priority: String
        assetIds: [String!]
    }

    input OpenMarketplaceReturnCaseInput {
        sellerOrderId: ID!
        reason: String!
        items: [MarketplaceReturnItemInput!]!
        assetIds: [String!]
    }

    input MarketplaceReturnItemInput {
        orderLineId: ID!
        quantity: Int!
    }

    input ReplyToMarketplaceSupportCaseInput {
        id: ID!
        body: String!
        assetIds: [String!]
    }

    input MarketplaceShippingQuoteItemInput {
        variantId: ID!
        quantity: Int!
    }

    input MarketplaceShippingDestinationInput {
        city: String!
        province: String
        postalCode: String
    }

    input MarketplaceCouponQuoteItemInput {
        variantId: ID!
        quantity: Int!
        unitPrice: Money!
    }

    input MarketplaceDiscoveryLocationInput {
        countryCode: String
        province: String
        city: String
        area: String
    }

    input MarketplaceCatalogProductFilterInput {
        categoryCode: String
        productType: String
        vendorId: String
        vendorSlug: String
        vendor: String
        location: String
        availability: String
        dietaryTags: [String!]
        minPrice: Money
        maxPrice: Money
        ratingMin: Float
        deliveryTimeMaxDays: Int
        dateFrom: DateTime
        dateTo: DateTime
    }

    input MarketplaceCartReservationInput {
        cartToken: String!
        variantId: ID!
        quantity: Int!
    }

    input MarketplaceCartReservationItemInput {
        variantId: ID!
        quantity: Int!
    }

    type MarketplaceCartReservationResult {
        cartToken: String!
        variantId: ID!
        quantity: Int!
        expiresAt: DateTime!
        saleableStock: Int!
    }

    type MarketplacePreparedCartCheckout {
        orderId: ID!
        code: String!
        state: String!
    }

    input CreateMarketplaceWishlistInput {
        name: String!
        description: String
    }

    input UpdateMarketplaceWishlistInput {
        id: ID!
        name: String
        description: String
    }

    input AddMarketplaceWishlistItemInput {
        wishlistId: ID!
        itemType: String!
        referenceId: String!
    }

    input SubmitMarketplaceReportInput {
        reporterName: String!
        reporterEmail: String!
        reporterPhone: String!
        targetType: String!
        reportedUserId: String
        reportedUserName: String
        reportedUserEmail: String
        vendorProfileId: String
        vendorName: String
        productId: String
        reviewId: String
        listingName: String
        reportedUrl: String
        orderCode: String
        orderDetails: String
        category: String!
        subject: String!
        description: String!
        evidenceIds: [String!]
    }

    input MarketplaceReviewFilterInput {
        targetType: String
        productId: String
        vendorProfileId: String
    }

    input SubmitMarketplaceReviewInput {
        id: ID
        orderId: ID!
        targetType: String!
        productId: ID
        variantId: ID
        vendorProfileId: String
        rating: Int!
        title: String
        body: String
        mediaIds: [ID!]
    }

    extend type Query {
        marketplaceVendor(slug: String!, location: MarketplaceDiscoveryLocationInput): MarketplaceVendorProfile
        marketplacePublicVendors(options: MarketplaceListOptions, location: MarketplaceDiscoveryLocationInput): MarketplaceVendorProfileList!
        marketplaceArticles: [MarketplaceArticle!]!
        activeMarketplaceCampaigns(placement: String): [MarketplacePromotionCampaign!]!
        myMarketplaceBookings: [MarketplaceBooking!]!
        marketplaceSubscriptionRenewal(token: String!): MarketplaceSubscriptionRenewal!
        myMarketplaceAffiliateProfile: MarketplaceAffiliateProfile
        myMarketplaceSupportCases: [MarketplaceSupportCase!]!
        marketplaceReturnEligibility(sellerOrderId: ID!): MarketplaceReturnEligibility!
        marketplaceIdentity: MarketplaceIdentity
        trackMarketplaceRoleApplication(reference: String!, emailAddress: String!): MarketplaceRoleApplication
        marketplaceProductCategories: [MarketplaceProductCategoryDefinition!]!
        marketplaceCategoryTree: [MarketplaceCategory!]!
        marketplaceCategoryFormSchema(categoryId: ID!): MarketplaceResolvedFormSchema!
        marketplaceCatalogProducts(categoryCode: String, term: String, location: MarketplaceDiscoveryLocationInput, filter: MarketplaceCatalogProductFilterInput, sort: String): MarketplaceCatalogProductList!
        marketplaceCatalogProduct(slug: String!, location: MarketplaceDiscoveryLocationInput): MarketplaceCatalogProduct
        myMarketplaceOrders(options: MarketplaceListOptions): MarketplaceOrderList!
        myMarketplaceSellerOrders(options: MarketplaceListOptions): MarketplaceOrderList!
        marketplaceShippingQuote(
            items: [MarketplaceShippingQuoteItemInput!]!
            destination: MarketplaceShippingDestinationInput!
        ): MarketplaceShippingQuote!
        myMarketplaceWishlists: [MarketplaceWishlist!]!
        marketplaceSharedWishlist(token: String!, accessKey: String): MarketplaceWishlist
        myMarketplaceReviews(options: MarketplaceListOptions): MarketplaceReviewList!
        myMarketplaceRewardWallet: MarketplaceCustomerRewardWallet!
        marketplaceProductPurchaseReward(productId: ID!): MarketplacePurchaseRewardQuote!
        marketplaceCouponQuote(code: String!, items: [MarketplaceCouponQuoteItemInput!]!): MarketplaceCouponQuote!
        marketplaceReviews(options: MarketplaceListOptions, filter: MarketplaceReviewFilterInput): MarketplaceReviewList!
        myMarketplaceChatConversations(options: MarketplaceChatListOptions): MarketplaceChatConversationList!
        myMarketplaceChatConversation(id: ID!): MarketplaceChatConversation!
        myMarketplaceChatSocketTicket: MarketplaceChatSocketTicket!
        myMarketplaceChatAttachment(id: ID!): MarketplaceChatAttachmentDownload!
        myMarketplaceListingQuote(id: ID!): MarketplaceListingQuote!
    }

    extend type Mutation {
        reserveMarketplaceRewardRedemption(orderId: ID!, coins: Int!): MarketplaceRewardRedemptionQuote!
        releaseMarketplaceRewardRedemption(orderId: ID!, reason: String): MarketplaceActionResult!
        reserveMarketplaceCoupon(orderId: ID!, code: String!): MarketplaceCouponQuote!
        releaseMarketplaceCoupon(orderId: ID!, reason: String): MarketplaceActionResult!
        registerMarketplaceVendor(input: RegisterMarketplaceVendorInput!): MarketplaceVendorProfile!
        createMarketplaceBooking(input: CreateMarketplaceBookingInput!): MarketplaceBooking!
        requestMarketplaceSubscriptionCancellation(id: ID!, reason: String): MarketplaceBooking!
        requestMarketplaceDigitalDownload(fileId: ID!): MarketplaceDigitalDownloadGrant!
        applyAsMarketplaceAffiliate(input: ApplyAsMarketplaceAffiliateInput!): MarketplaceAffiliateProfile!
        openMarketplaceSupportCase(input: OpenMarketplaceSupportCaseInput!): MarketplaceSupportCase!
        openMarketplaceReturnCase(input: OpenMarketplaceReturnCaseInput!): MarketplaceSupportCase!
        replyToMarketplaceSupportCase(input: ReplyToMarketplaceSupportCaseInput!): MarketplaceSupportCase!
        requestMarketplaceCustomerRegistration(input: RegisterMarketplaceCustomerInput!): MarketplaceRegistrationChallenge!
        resendMarketplaceCustomerOtp(emailAddress: String!): MarketplaceRegistrationChallenge!
        verifyMarketplaceCustomerOtp(input: VerifyMarketplaceCustomerOtpInput!): MarketplaceActionResult!
        submitMarketplaceRoleApplication(input: SubmitMarketplaceRoleApplicationInput!): MarketplaceRoleApplication!
        createMarketplaceWishlist(input: CreateMarketplaceWishlistInput!): MarketplaceWishlist!
        updateMarketplaceWishlist(input: UpdateMarketplaceWishlistInput!): MarketplaceWishlist!
        deleteMarketplaceWishlist(id: ID!): MarketplaceActionResult!
        addMarketplaceWishlistItem(input: AddMarketplaceWishlistItemInput!): MarketplaceWishlist!
        removeMarketplaceWishlistItem(wishlistId: ID!, itemId: ID!): MarketplaceWishlist!
        enableMarketplaceWishlistShare(id: ID!, visibility: String!): MarketplaceWishlist!
        disableMarketplaceWishlistShare(id: ID!): MarketplaceWishlist!
        uploadMarketplaceReportEvidence(files: [Upload!]!): [MarketplaceReportEvidence!]!
        submitMarketplaceReport(input: SubmitMarketplaceReportInput!): MarketplaceReport!
        uploadMarketplaceReviewMedia(files: [Upload!]!): [MarketplaceReviewMedia!]!
        submitMarketplaceReview(input: SubmitMarketplaceReviewInput!): MarketplaceReview!
        deleteMarketplaceReview(id: ID!): MarketplaceActionResult!
        recordMarketplaceProductView(productId: ID!, sessionId: String!): MarketplaceActionResult!
        reserveMarketplaceCartItem(input: MarketplaceCartReservationInput!): MarketplaceCartReservationResult!
        releaseMarketplaceCartItem(cartToken: String!, variantId: ID): MarketplaceActionResult!
        consumeMarketplaceCartReservations(cartToken: String!, items: [MarketplaceCartReservationItemInput!]!): MarketplaceActionResult!
        prepareMarketplaceCartCheckout(cartToken: String!, items: [MarketplaceCartReservationItemInput!]!): MarketplacePreparedCartCheckout!
        sendMyMarketplaceChatMessage(input: SendMarketplaceChatMessageInput!): MarketplaceChatMessage!
        markMyMarketplaceChatConversationRead(id: ID!): MarketplaceChatReadResult!
        uploadMyMarketplaceChatAttachments(conversationId: ID!, files: [Upload!]!): [MarketplaceChatAttachment!]!
        createMyMarketplaceListingInquiry(input: CreateMarketplaceListingInquiryInput!): MarketplaceChatConversation!
        confirmMyMarketplaceListingQuoteOrder(quoteId: ID!, orderId: ID!): MarketplaceListingQuote!
    }
`;
