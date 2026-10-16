import gql from 'graphql-tag';

export const commonMarketplaceSchema = gql`
    input MarketplaceListOptions {
        skip: Int
        take: Int
    }

    type MarketplaceVendorServiceArea {
        id: ID!
        scope: String!
        countryCode: String!
        province: String
        city: String
        areas: [String!]!
    }

    type MarketplaceVendorWeeklyHours {
        dayOfWeek: Int!
        enabled: Boolean!
        opensAt: String!
        closesAt: String!
    }

    type MarketplaceVendorUnavailableDate {
        id: ID!
        date: String!
        reason: String!
    }

    type MarketplaceVendorAvailability {
        status: String!
        isOpen: Boolean!
        acceptsPerishableOrders: Boolean!
        label: String!
        reason: String
        timezone: String!
        currentDate: String!
        todayHours: String
        weeklyHours: [MarketplaceVendorWeeklyHours!]!
    }

    type MarketplaceFulfillmentPerformance {
        totalOrders: Int!
        completedOrders: Int!
        cancelledOrders: Int!
        acceptanceRate: Int
        completionRate: Int
        label: String!
    }

    type MarketplaceReviewSummary {
        average: Float
        count: Int!
        ratingBreakdown: JSON!
        badges: [String!]!
        fulfillmentPerformance: MarketplaceFulfillmentPerformance
    }

    type MarketplaceReviewTargetSummary {
        targetType: String!
        average: Float
        count: Int!
        ratingBreakdown: JSON!
    }

    type MarketplaceReviewMedia {
        id: ID!
        createdAt: DateTime!
        assetId: String!
        name: String!
        preview: String!
        source: String!
        mimeType: String!
        mediaType: String!
    }

    type MarketplaceReview {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customerUserId: String!
        customerId: String!
        customerName: String!
        orderId: String!
        orderCode: String!
        targetType: String!
        productId: String
        productSlug: String
        productName: String
        variantId: String
        variantName: String
        vendorProfileId: String
        vendorName: String
        vendorSlug: String
        rating: Int!
        title: String
        body: String
        status: String!
        verified: Boolean!
        vendorResponse: String
        vendorResponseCreatedAt: DateTime
        vendorResponseUpdatedAt: DateTime
        moderationReason: String
        moderatedAt: DateTime
        media: [MarketplaceReviewMedia!]!
    }

    type MarketplaceReviewList {
        items: [MarketplaceReview!]!
        totalItems: Int!
    }

    type MarketplaceReviewRewardSettings {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        productReviewPoints: Int!
        imageBonusPoints: Int!
        videoBonusPoints: Int!
        vendorReviewPoints: Int!
        updatedByUserId: String
    }

    type MarketplacePurchaseRewardRule {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        pointsPerUnit: Int!
        priority: Int!
        status: String!
        startsAt: DateTime
        endsAt: DateTime
        description: String
        updatedByUserId: String
    }

    type MarketplacePurchaseRewardQuote {
        enabled: Boolean!
        pointsPerUnit: Int!
        ruleId: ID
        ruleName: String
        ruleScope: String
    }

    type MarketplaceCoupon {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        name: String!
        description: String
        purpose: String!
        rewardRecipientType: String
        rewardRecipientId: String
        rewardRecipientCode: String
        rewardRecipientName: String
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        discountType: String!
        discountValue: Float!
        maximumDiscount: Money
        minimumSpend: Money!
        currencyCode: String!
        fundingSource: String!
        totalUsageLimit: Int
        perCustomerUsageLimit: Int!
        status: String!
        startsAt: DateTime
        endsAt: DateTime
        createdByUserId: String
        updatedByUserId: String
    }

    type MarketplaceCouponList {
        items: [MarketplaceCoupon!]!
        totalItems: Int!
    }

    type MarketplaceCouponQuote {
        id: ID
        orderId: String
        orderCode: String
        valid: Boolean!
        message: String!
        code: String!
        name: String!
        scope: String!
        fundingSource: String!
        eligibleSubtotal: Money!
        amount: Money!
        currencyCode: String!
        status: String
    }

    type MarketplaceCouponRedemption {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        couponId: String!
        couponCode: String!
        orderId: String!
        orderCode: String!
        customerId: String!
        customerUserId: String!
        customerName: String!
        eligibleSubtotal: Money!
        amount: Money!
        currencyCode: String!
        fundingSource: String!
        status: String!
        reservedAt: DateTime!
        appliedAt: DateTime
        reversedAt: DateTime
        reversalReason: String
        ruleSnapshot: JSON!
        allocations: JSON
    }

    type MarketplaceCouponDashboard {
        activeCoupons: Int!
        totalRedemptions: Int!
        totalDiscount: Money!
        marketplaceFunded: Money!
        vendorFunded: Money!
        recentRedemptions: [MarketplaceCouponRedemption!]!
    }

    type MarketplaceRewardWalletTransaction {
        id: ID!
        createdAt: DateTime!
        customerId: String!
        customerUserId: String!
        customerName: String!
        reviewId: String!
        orderCode: String!
        reviewTargetType: String!
        component: String!
        type: String!
        points: Int!
        reason: String!
    }

    type MarketplaceRewardRedemptionSettings {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        enabled: Boolean!
        minimumWalletBalance: Int!
        coinsPerPkr: Int!
        updatedByUserId: String
    }

    type MarketplaceRewardRedemptionAllocation {
        sellerOrderId: String!
        sellerOrderCode: String!
        vendorId: String!
        vendorName: String!
        coins: Int!
        amount: Money!
        vendorGrossAmount: Money!
        customerFundedAmount: Money!
        reversedAt: DateTime
    }

    type MarketplaceRewardRedemption {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        orderId: String!
        orderCode: String!
        customerId: String!
        customerUserId: String!
        customerName: String!
        coins: Int!
        amount: Money!
        currencyCode: String!
        status: String!
        reservedAt: DateTime!
        appliedAt: DateTime
        reversedAt: DateTime
        reversalReason: String
        allocations: [MarketplaceRewardRedemptionAllocation!]
    }

    type MarketplaceRewardRedemptionQuote {
        id: ID!
        orderId: String!
        orderCode: String!
        coins: Int!
        amount: Money!
        customerPayableAmount: Money!
        currencyCode: String!
        status: String!
        minimumWalletBalance: Int!
        coinsPerPkr: Int!
    }

    type MarketplaceCustomerRewardWallet {
        settings: MarketplaceReviewRewardSettings!
        redemptionSettings: MarketplaceRewardRedemptionSettings!
        balance: Int!
        lifetimeEarned: Int!
        lifetimeReversed: Int!
        lifetimeSpent: Int!
        transactions: [MarketplaceRewardWalletTransaction!]!
    }

    type MarketplaceReviewRewardAdminDashboard {
        settings: MarketplaceReviewRewardSettings!
        redemptionSettings: MarketplaceRewardRedemptionSettings!
        purchaseRules: [MarketplacePurchaseRewardRule!]!
        balance: Int!
        lifetimeEarned: Int!
        lifetimeReversed: Int!
        lifetimeSpent: Int!
        rewardedCustomers: Int!
        totalCoinsRedeemed: Int!
        totalRewardFunding: Money!
        recentRedemptions: [MarketplaceRewardRedemption!]!
        recentTransactions: [MarketplaceRewardWalletTransaction!]!
    }

    type MarketplaceVendorReviewDashboard {
        summary: MarketplaceReviewSummary!
        targetSummaries: [MarketplaceReviewTargetSummary!]!
        reviews: MarketplaceReviewList!
        totalReviews: Int!
        respondedReviews: Int!
        responseRate: Int
        performanceBadges: [String!]!
        qualityWarnings: [String!]!
    }

    type MarketplaceVendorProfile {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        slug: String!
        shopName: String!
        ownerFirstName: String!
        ownerLastName: String!
        ownerEmailAddress: String!
        contactEmail: String
        phoneNumber: String
        businessType: String
        description: String
        featuredProductId: String
        logoAssetId: String
        logoUrl: String
        bannerAssetId: String
        bannerUrl: String
        status: String!
        sellerId: String
        channelId: String
        categories: [String!]
        operatingLocations: [String!]
        serviceAreas: [MarketplaceVendorServiceArea!]
        policies: JSON
        commissionPercent: Float!
        payoutSchedule: String!
        healthScore: Int!
        verified: Boolean!
        paused: Boolean!
        availabilityPaused: Boolean!
        availabilityPauseReason: String
        availabilityTimezone: String!
        weeklyHours: [MarketplaceVendorWeeklyHours!]
        unavailableDates: [MarketplaceVendorUnavailableDate!]
        holidayModeEnabled: Boolean!
        enforcementStatus: String!
        restrictedUntil: DateTime
        enforcementReason: String
        warningCount: Int!
        removedAt: DateTime
        holidayStartsAt: DateTime
        holidayEndsAt: DateTime
        holidayReason: String
        availability: MarketplaceVendorAvailability!
        reviewNote: String
        ratingAverage: Float
        ratingCount: Int
        ratingBreakdown: JSON
        badges: [String!]
        fulfillmentPerformance: MarketplaceFulfillmentPerformance
    }

    type MarketplaceVendorProfileList {
        items: [MarketplaceVendorProfile!]!
        totalItems: Int!
    }

    type MarketplaceShippingZone {
        id: ID!
        name: String!
        cities: [String!]!
        provinces: [String!]!
        postalCodes: [String!]!
        rate: Money!
        minDeliveryDays: Int!
        maxDeliveryDays: Int!
        enabled: Boolean!
    }

    type MarketplaceDeliveryProfile {
        id: ID!
        name: String!
        description: String
        enabled: Boolean!
        mode: String!
        flatRate: Money!
        fallbackEnabled: Boolean!
        fallbackRate: Money!
        processingDays: Int!
        defaultMinDeliveryDays: Int!
        defaultMaxDeliveryDays: Int!
        zones: [MarketplaceShippingZone!]!
    }

    type MarketplaceShippingProfile {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        vendorProfileId: String!
        shippingMethodId: String
        mode: String!
        flatRate: Money!
        fallbackRate: Money!
        processingDays: Int!
        defaultMinDeliveryDays: Int!
        defaultMaxDeliveryDays: Int!
        zones: [MarketplaceShippingZone!]!
        defaultProfileId: String!
        deliveryProfiles: [MarketplaceDeliveryProfile!]!
    }

    type MarketplaceShippingQuoteItem {
        vendorId: String!
        vendorName: String!
        profileId: String!
        profileName: String!
        productNames: [String!]!
        mode: String!
        ruleName: String!
        rate: Money!
        processingDays: Int!
        minDeliveryDays: Int!
        maxDeliveryDays: Int!
    }

    type MarketplaceShippingQuote {
        total: Money!
        currencyCode: String!
        items: [MarketplaceShippingQuoteItem!]!
    }

    type MarketplaceBooking {
        id: ID!
        details: JSON
        createdAt: DateTime!
        updatedAt: DateTime!
        customerId: String!
        vendorProfileId: String!
        orderId: String
        productVariantId: String!
        availabilitySessionId: String
        eventTicketTypeId: String
        bookingType: String!
        title: String!
        startsAt: DateTime!
        endsAt: DateTime!
        quantity: Int!
        capacity: Int
        status: String!
        billingModel: String!
        paidAt: DateTime
        renewalReminderSentAt: DateTime
        paymentStatus: String!
        agreedPrice: Money
        subscriptionClassName: String
        graceEndsAt: DateTime
        renewalToken: String
        cancellationRequestedAt: DateTime
        cancelledAt: DateTime
        customerName: String
        customerEmail: String
        attendeeDetails: JSON
        customerNote: String
        internalNote: String
        secureAccessReference: String
    }

    type MarketplaceBookingList {
        items: [MarketplaceBooking!]!
        totalItems: Int!
        workshopOrders: JSON
    }

    type MarketplaceSubscriptionRenewal {
        bookingId: ID!
        productId: ID!
        productVariantId: ID!
        productName: String!
        productSlug: String!
        variantName: String!
        sku: String!
        vendorProfileId: String!
        vendorName: String!
        vendorSlug: String!
        price: Money!
        className: String!
        graceEndsAt: DateTime!
        periodDays: Int!
        nextStartsAt: DateTime!
        nextEndsAt: DateTime!
    }

    type MarketplaceDigitalDownloadGrant {
        url: String!
        expiresAt: DateTime!
        fileName: String!
    }

    type MarketplaceAffiliateProfile {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        customerId: String!
        slug: String!
        referralCode: String!
        displayName: String!
        bio: String
        status: String!
        channels: JSON
        commissionPercent: Float!
        attributedOrderCount: Int!
        availableBalance: Money!
        payoutAccount: JSON
    }

    type MarketplaceAffiliateProfileList {
        items: [MarketplaceAffiliateProfile!]!
        totalItems: Int!
    }

    type MarketplaceSupportMessage {
        authorId: String!
        authorRole: String!
        body: String!
        createdAt: DateTime!
        assetIds: [String!]
    }

    type MarketplaceReturnItem {
        orderLineId: ID!
        quantity: Int!
        productName: String
        variantName: String
        sku: String
    }

    type MarketplaceSupportCase {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        openedByUserId: String!
        assignedAdministratorId: String
        vendorProfileId: String
        orderId: String
        sellerOrderId: String
        sellerOrderStatusBeforeReturn: String
        returnItems: [MarketplaceReturnItem!]
        returnWindowDays: Int
        returnDeadlineAt: DateTime
        returnRequired: Boolean
        refundId: String
        refundStatus: String
        category: String!
        subject: String!
        priority: String!
        status: String!
        messages: [MarketplaceSupportMessage!]
        decision: String
        financialAdjustment: Money
        resolvedAt: DateTime
    }

    type MarketplaceSupportCaseList {
        items: [MarketplaceSupportCase!]!
        totalItems: Int!
    }

    type MarketplaceReturnEligibility {
        eligible: Boolean!
        windowDays: Int!
        deadlineAt: DateTime
        reason: String
        sellerOrderStatus: String!
        returnableItems: [MarketplaceReturnItem!]!
    }

    type MarketplacePromotionCampaign {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        ownerType: String!
        ownerId: String
        campaignType: String!
        title: String!
        description: String
        placement: String!
        budget: Money!
        maxPlacements: Int!
        reservedPlacements: Int
        status: String!
        effectiveStatus: String
        startsAt: DateTime!
        endsAt: DateTime!
        target: JSON
        creative: JSON
        metrics: JSON
    }

    type MarketplacePromotionCampaignList {
        items: [MarketplacePromotionCampaign!]!
        totalItems: Int!
    }

    type MarketplacePromotionRate {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        scope: String!
        placement: String!
        vendorProfileId: String
        categoryId: String
        categoryCode: String
        campaignId: String
        pricePerDay: Money!
        currencyCode: String!
        active: Boolean!
        note: String
    }

    type MarketplacePromotionSettings {
        homeSlots: Int!
        categorySlots: Int!
        paymentWindowHours: Int!
        paymentInstructions: String!
    }

    type MarketplacePromotionPaymentOptions {
        cardEnabled: Boolean!
        manualEnabled: Boolean!
    }

    type MarketplacePromotionCardCheckout {
        url: String
        paymentStatus: String!
    }

    type MarketplacePromotionPaymentSummary {
        verifiedCount: Int!
        verifiedAmount: Money!
        refundedAmount: Money!
        netRevenue: Money!
        pendingCount: Int!
        pendingAmount: Money!
        currencyCode: String!
    }

    type MarketplacePromotionPayment {
        id: ID!
        requestId: String!
        requestCode: String!
        vendorProfileId: String!
        vendorName: String!
        productName: String!
        placement: String!
        promotionStatus: String!
        amount: Money!
        refundedAmount: Money!
        currencyCode: String!
        method: String!
        status: String!
        reference: String
        checkoutSessionId: String
        cardBrand: String
        cardLast4: String
        note: String
        createdAt: DateTime!
        verifiedAt: DateTime
        verifiedByUserId: String
        startsAt: DateTime
        endsAt: DateTime
    }

    type MarketplacePromotionPaymentDashboard {
        items: [MarketplacePromotionPayment!]!
        totalItems: Int!
        summary: MarketplacePromotionPaymentSummary!
    }

    type MarketplacePromotionTarget {
        id: ID!
        code: String!
        name: String!
    }

    type MarketplacePromotionTargets {
        vendors: [MarketplacePromotionTarget!]!
        categories: [MarketplacePromotionTarget!]!
        canManage: Boolean!
        canCreate: Boolean!
        canUpdate: Boolean!
    }

    type MarketplacePromotionQuote {
        pricePerDay: Money!
        amount: Money!
        currencyCode: String!
        rateScope: String!
        startsAt: DateTime!
        endsAt: DateTime!
        available: Boolean!
        message: String
    }

    type MarketplacePromotionRequest {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        productId: String
        targetType: String!
        productName: String!
        productSlug: String!
        vendorProfileId: String!
        vendorName: String!
        categoryId: String
        categoryCode: String!
        categoryName: String!
        placement: String!
        campaignId: String
        campaignCode: String
        startsAt: DateTime!
        endsAt: DateTime!
        durationDays: Int!
        pricePerDay: Money!
        amount: Money!
        currencyCode: String!
        rateScope: String!
        status: String!
        paymentStatus: String!
        paymentReference: String
        cardCheckoutOpen: Boolean
        paymentNote: String
        adminNote: String
        submittedAt: DateTime!
        reviewedAt: DateTime
        reviewedByUserId: String
        paymentDueAt: DateTime
        paymentSubmittedAt: DateTime
        paymentVerifiedAt: DateTime
        paymentVerifiedByUserId: String
        approvedAt: DateTime
        priority: Int!
    }

    type MarketplacePromotionRequestList {
        items: [MarketplacePromotionRequest!]!
        totalItems: Int!
    }

    type MarketplaceArticle {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        slug: String!
        title: String!
        excerpt: String!
        body: String!
        authorAdministratorId: String
        featuredAssetId: String
        status: String!
        publishedAt: DateTime
        tags: [String!]
        relations: JSON
        seo: JSON
    }

    type MarketplaceArticleList {
        items: [MarketplaceArticle!]!
        totalItems: Int!
    }

    type MarketplacePayoutLedgerEntry {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        beneficiaryType: String!
        beneficiaryId: String!
        orderId: String
        kind: String!
        amount: Money!
        currencyCode: String!
        status: String!
        availableAt: DateTime
        externalReference: String
        reason: String
        metadata: JSON
    }

    type MarketplacePayoutLedgerEntryList {
        items: [MarketplacePayoutLedgerEntry!]!
        totalItems: Int!
    }

    type MarketplaceCommissionRule {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        commissionPercent: Float!
        feePercent: Float!
        fixedFee: Money!
        currencyCode: String!
        priority: Int!
        status: String!
        startsAt: DateTime
        endsAt: DateTime
        description: String
        metadata: JSON
    }

    type MarketplaceCommissionRuleList {
        items: [MarketplaceCommissionRule!]!
        totalItems: Int!
    }

    type MarketplacePayoutSettings {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        holdingPeriodDays: Int!
        reservePercent: Float!
        minimumPayoutThreshold: Money!
        payoutSchedule: String!
        currencyCode: String!
        requireSeparateApproval: Boolean!
        adjustmentRules: JSON
    }

    type MarketplaceVendorPayoutAccount {
        method: String
        accountHolderName: String
        bankName: String
        accountIdentifierMasked: String
        verificationStatus: String!
        submittedAt: DateTime
        verifiedAt: DateTime
        verificationNote: String
    }

    type MarketplacePayoutBatch {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        status: String!
        totalAmount: Money!
        currencyCode: String!
        vendorIds: [String!]
        payoutEntryIds: [String!]
        createdByUserId: String
        approvedByUserId: String
        processedByUserId: String
        approvedAt: DateTime
        processedAt: DateTime
        externalReference: String
        note: String
        failureReason: String
        metadata: JSON
    }

    type MarketplaceVendorFinanceBalance {
        vendorId: String!
        vendorName: String!
        currencyCode: String!
        grossSales: Money!
        commission: Money!
        fees: Money!
        deliveryAdjustments: Money!
        refunds: Money!
        taxes: Money!
        penalties: Money!
        adjustments: Money!
        rewardFunding: Money!
        couponFunding: Money!
        couponDiscounts: Money!
        customerFundedSales: Money!
        netEarnings: Money!
        onHoldBalance: Money!
        pendingBalance: Money!
        pendingPayout: Money!
        paidPayout: Money!
        failedPayout: Money!
        availableBalance: Money!
        reserveHeld: Money!
        payableBalance: Money!
        payoutAccount: MarketplaceVendorPayoutAccount!
        lastPayoutAt: DateTime
    }

    type MarketplaceVendorFinanceStatement {
        vendorId: String!
        vendorName: String!
        currencyCode: String!
        balance: MarketplaceVendorFinanceBalance
        entries: [MarketplacePayoutLedgerEntry!]!
    }

    type MarketplaceFinanceReport {
        reportType: String!
        generatedAt: DateTime!
        currencyCode: String!
        totals: JSON!
        rows: JSON!
    }

    type MarketplaceFinanceDashboard {
        settings: MarketplacePayoutSettings!
        balances: [MarketplaceVendorFinanceBalance!]!
        payoutBatches: [MarketplacePayoutBatch!]!
        recentLedgerEntries: [MarketplacePayoutLedgerEntry!]!
        reportSummary: JSON!
    }

    type MarketplaceVendorFinanceAlert {
        id: String!
        type: String!
        tone: String!
        title: String!
        message: String!
        createdAt: DateTime!
    }

    type MarketplaceVendorFinanceDashboard {
        vendorId: String!
        vendorName: String!
        currencyCode: String!
        balance: MarketplaceVendorFinanceBalance!
        settings: MarketplacePayoutSettings!
        payoutAccount: MarketplaceVendorPayoutAccount!
        entries: [MarketplacePayoutLedgerEntry!]!
        payoutBatches: [MarketplacePayoutBatch!]!
        alerts: [MarketplaceVendorFinanceAlert!]!
    }

    type MarketplaceVendorOverviewMetrics {
        grossSales: Money!
        ledgeredSales: Int!
        orders: Int!
        averageOrderValue: Money!
        productViews: Int!
        conversionRate: Float
        pendingOrders: Int!
        stockAlerts: Int!
        stockOuts: Int!
        bookings: Int!
        pendingBookings: Int!
        cancelledOrders: Int!
        cancellationRate: Float!
        cancelledValue: Money!
        returns: Int!
        returnRate: Float!
        refundedOrders: Int!
        refundRate: Float!
        refundAmount: Money!
        disputes: Int!
        openCases: Int!
        ratingAverage: Float
        ratingCount: Int!
        estimatedCommission: Money!
        estimatedFees: Money!
        estimatedEarnings: Money!
        pendingPayout: Money!
        availablePayout: Money!
        paidPayout: Money!
        payoutStatus: String!
        payoutSchedule: String!
        commissionPercent: Float!
        effectiveCommissionPercent: Float!
        currencyCode: String!
    }

    type MarketplaceVendorStockAlert {
        productId: ID!
        productName: String!
        productSlug: String!
        variantId: ID!
        variantName: String!
        sku: String!
        availableStock: Int!
        status: String!
    }

    type MarketplaceVendorListingPerformance {
        productId: ID!
        productName: String!
        productSlug: String!
        unitsSold: Int!
        orderCount: Int!
        revenue: Money!
        views: Int!
        conversionRate: Float
        availableStock: Int!
        stockStatus: String!
    }

    type MarketplaceVendorOverview {
        metrics: MarketplaceVendorOverviewMetrics!
        pendingActionCount: Int!
        recentOrders: [MarketplaceOrder!]!
        stockAlerts: [MarketplaceVendorStockAlert!]!
        upcomingBookings: [MarketplaceBooking!]!
        openCases: [MarketplaceSupportCase!]!
        recentPayouts: [MarketplacePayoutLedgerEntry!]!
        bestPerformingListings: [MarketplaceVendorListingPerformance!]!
        lowPerformingListings: [MarketplaceVendorListingPerformance!]!
    }

    type MarketplaceRoleTemplate {
        code: String!
        description: String!
        permissions: [String!]!
    }

    type MarketplaceActionResult {
        success: Boolean!
        message: String!
    }

    type MarketplaceRegistrationChallenge {
        success: Boolean!
        message: String!
        expiresAt: DateTime!
        maskedEmail: String!
    }

    type MarketplaceIdentity {
        role: String!
        displayName: String!
        identifier: String!
        mustChangePassword: Boolean!
        dashboardPath: String!
    }

    type MarketplaceApplicationHistoryEntry {
        status: String!
        at: DateTime!
        note: String
    }

    type MarketplaceRoleApplication {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        reference: String!
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
        status: String!
        rejectionCount: Int!
        blockedAt: DateTime
        blockedReason: String
        reviewNote: String
        reviewedAt: DateTime
        vendorProfileId: String
        mustChangePassword: Boolean!
        history: [MarketplaceApplicationHistoryEntry!]
    }

    type MarketplaceRoleApplicationList {
        items: [MarketplaceRoleApplication!]!
        totalItems: Int!
    }

    type MarketplaceProductFieldDefinition {
        key: String!
        label: String!
        type: String!
        required: Boolean!
        section: String
        helpText: String
        placeholder: String
        unit: String
        options: [String!]
        validation: JSON
        ui: JSON
        condition: JSON
        sortOrder: Int
    }

    type MarketplaceProductCategoryDefinition {
        id: ID
        code: String!
        name: String!
        productType: String!
        listingType: String
        description: String!
        breadcrumb: [String!]
        fields: [MarketplaceProductFieldDefinition!]!
    }

    type MarketplaceFormTemplate {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        key: String!
        name: String!
        listingType: String!
        version: Int!
        isActive: Boolean!
        schema: JSON!
    }

    type MarketplaceCategory {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        slug: String!
        name: String!
        parentId: ID
        description: String!
        icon: String
        imageAssetId: ID
        sortOrder: Int!
        isActive: Boolean!
        chatEnabled: Boolean!
        vendorSelectable: Boolean
        formTemplateId: ID
        assignedFormTemplate: MarketplaceFormTemplate
        effectiveFormTemplate: MarketplaceFormTemplate
        breadcrumb: [String!]!
        level: Int!
        children: [MarketplaceCategory!]
    }

    type MarketplaceCategoryField {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        categoryId: ID!
        fieldKey: String!
        label: String!
        inputType: String!
        required: Boolean!
        section: String!
        helpText: String
        placeholder: String
        unit: String
        options: [String!]
        validation: JSON
        ui: JSON
        condition: JSON
        sortOrder: Int!
        isActive: Boolean!
        overrideMode: String!
    }

    type MarketplaceResolvedFormSchema {
        category: MarketplaceCategory!
        formTemplate: MarketplaceFormTemplate!
        fields: [MarketplaceProductFieldDefinition!]!
    }

    type MarketplaceVendorCategoryRequestDocument {
        id: ID!
        createdAt: DateTime!
        assetId: String!
        name: String!
        preview: String!
        source: String!
        mimeType: String!
        documentType: String!
        fieldKey: String!
        expiresAt: DateTime
    }

    type MarketplaceVendorCategoryRequest {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        vendorProfileId: String!
        vendorName: String!
        requestedCategoryId: String!
        requestedCategoryCode: String!
        requestedCategoryName: String!
        requestedCategoryBreadcrumb: [String!]!
        listingType: String!
        listingTypes: [String!]!
        businessReason: String!
        experience: String!
        fulfilmentPlan: String!
        categoryData: JSON!
        kycData: JSON!
        complianceConfirmed: Boolean!
        status: String!
        submittedAt: DateTime!
        reviewedAt: DateTime
        adminNote: String
        documents: [MarketplaceVendorCategoryRequestDocument!]!
    }

    type MarketplaceVendorCategoryAccessOption {
        listingType: String!
        formName: String!
        formKey: String!
        categoryCount: Int!
        currentlyApproved: Boolean!
        requestPending: Boolean!
        requestable: Boolean!
        documentsRequired: Boolean!
    }

    type MarketplaceVendorCategoryAccessDashboard {
        vendorId: ID!
        vendorName: String!
        approvedCategories: [String!]!
        options: [MarketplaceVendorCategoryAccessOption!]!
        requests: [MarketplaceVendorCategoryRequest!]!
    }

    type MarketplaceProductAsset {
        id: ID!
        name: String!
        preview: String!
    }

    type MarketplaceCatalogVariant {
        id: ID!
        name: String!
        sku: String!
        enabled: Boolean!
        price: Money!
        priceWithTax: Money!
        compareAtPrice: Money
        availabilityEndsAt: DateTime
        featuredAsset: MarketplaceProductAsset
        stockOnHand: Int!
        stockAllocated: Int!
        options: [String!]!
        optionValues: JSON
        barcode: String
        weightGrams: Int
        lowStockThreshold: Int!
        allowBackorders: Boolean!
        backorderLimit: Int!
        maxOrderQuantity: Int!
        saleableStock: Int!
    }

    type MarketplaceInventoryMovement {
        id: ID!
        createdAt: DateTime!
        type: String!
        quantity: Int!
    }

    type MarketplaceInventoryItem {
        productId: ID!
        productName: String!
        productStatus: String!
        productType: String!
        variantId: ID!
        variantName: String!
        sku: String!
        stockOnHand: Int!
        stockAllocated: Int!
        availableStock: Int!
        saleableStock: Int!
        lowStockThreshold: Int!
        allowBackorders: Boolean!
        backorderLimit: Int!
        maxOrderQuantity: Int!
        status: String!
        history: [MarketplaceInventoryMovement!]!
    }

    type MarketplaceInventory {
        items: [MarketplaceInventoryItem!]!
        totalItems: Int!
        lowStockCount: Int!
        outOfStockCount: Int!
    }

    type MarketplaceCatalogOptionGroup {
        id: ID!
        name: String!
        values: [String!]!
    }

    type MarketplaceCatalogProduct {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        slug: String!
        description: String!
        enabled: Boolean!
        status: String!
        productType: String!
        listingType: String!
        categoryId: ID!
        categoryCode: String!
        categoryName: String!
        categoryBreadcrumb: [String!]!
        chatEnabled: Boolean!
        formTemplateKey: String!
        schemaVersion: Int!
        fieldValues: JSON!
        fieldDefinitions: [MarketplaceProductFieldDefinition!]!
        vendorProfileId: String!
        vendorName: String!
        vendorSlug: String!
        location: String!
        vendorLocations: [String!]!
        vendorAvailability: MarketplaceVendorAvailability!
        metadata: JSON!
        featuredAsset: MarketplaceProductAsset
        assets: [MarketplaceProductAsset!]!
        optionGroups: [MarketplaceCatalogOptionGroup!]!
        variants: [MarketplaceCatalogVariant!]!
        minPrice: Money!
        totalStock: Int!
        deliveryProfileName: String
        deliveryMinDays: Int
        deliveryMaxDays: Int
        preparationTimeMinutes: Int
        eventStartsAt: DateTime
        eventEndsAt: DateTime
        ratingAverage: Float
        ratingCount: Int!
        ratingBreakdown: JSON!
        badges: [String!]!
        servicePackages: JSON!
        serviceAddOns: JSON!
        availabilitySessions: JSON!
        eventTicketTypes: JSON!
        eventScheduleItems: JSON!
        digitalFiles: JSON!
        isPromoted: Boolean!
        promotionPlacement: String
        promotionEndsAt: DateTime
        promotionRank: Int
    }

    type MarketplaceCatalogProductList {
        items: [MarketplaceCatalogProduct!]!
        totalItems: Int!
    }

    type MarketplaceOrderLine {
        id: ID!
        productId: String!
        productName: String!
        productSlug: String!
        variantId: String!
        variantName: String!
        sku: String!
        quantity: Int!
        unitPrice: Money!
        lineTotal: Money!
        image: String
        vendorId: String
        vendorName: String
        productType: String!
        downloadableFiles: JSON!
        customerNote: String
    }

    type MarketplaceOrderCustomerNote {
        vendorId: String!
        vendorName: String!
        vendorSlug: String
        note: String!
    }

    type MarketplaceOrder {
        id: ID!
        code: String!
        customerOrderId: String!
        customerOrderCode: String!
        sellerOrderCode: String
        sellerOrderIds: [ID!]!
        orderType: String!
        status: String!
        vendureState: String!
        paymentStatus: String!
        companyPaymentDue: Money!
        paymentState: String
        paymentMethod: String
        companyReceiptReference: String
        companyReceiptAmount: Money
        companyReceiptConfirmedAt: DateTime
        companyReceiptConfirmedBy: String
        createdAt: DateTime!
        updatedAt: DateTime!
        placedAt: DateTime
        customerId: String!
        customerName: String!
        customerEmail: String!
        vendorId: String
        vendorName: String
        vendorSlug: String
        subTotal: Money!
        shipping: Money!
        total: Money!
        rewardCoins: Int!
        rewardFunding: Money!
        couponCode: String
        couponDiscount: Money!
        couponFundingSource: String
        customerFundedSubTotal: Money!
        currencyCode: String!
        totalQuantity: Int!
        shippingAddress: JSON
        trackingCode: String
        customerNote: String
        customerNotes: [MarketplaceOrderCustomerNote!]!
        statusNote: String
        confirmedAt: DateTime
        statusUpdatedAt: DateTime
        decisionDueAt: DateTime
        decisionOverdue: Boolean!
        projectDeadline: String
        projectDeadlineOverdue: Boolean!
        chatAvailable: Boolean!
        fulfillmentType: String!
        printableDocuments: [String!]!
        availableStatuses: [String!]!
        lines: [MarketplaceOrderLine!]!
    }

    type MarketplaceOrderList {
        items: [MarketplaceOrder!]!
        totalItems: Int!
    }

    type MarketplaceWishlistItem {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        itemType: String!
        referenceId: String!
        name: String!
        slug: String!
        image: String
        price: Money
        compareAtPrice: Money
        vendorName: String
        vendorSlug: String
        category: String
        location: String
    }

    type MarketplaceWishlist {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        description: String
        visibility: String!
        shareEnabled: Boolean!
        shareToken: String
        shareAccessKey: String
        itemCount: Int!
        items: [MarketplaceWishlistItem!]!
    }

    type MarketplaceReportEvidence {
        id: ID!
        createdAt: DateTime!
        assetId: String!
        name: String!
        preview: String!
        mimeType: String!
    }

    type MarketplaceReport {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        reporterName: String!
        reporterEmail: String!
        reporterPhone: String!
        targetType: String!
        reportedUserId: String
        reportedUserName: String
        reportedUserEmail: String
        vendorProfileId: String
        vendorName: String!
        productId: String
        reviewId: String
        listingName: String
        reportedUrl: String
        orderCode: String
        orderDetails: String
        category: String!
        subject: String!
        description: String!
        status: String!
        supportConversationId: String
        adminNote: String
        actionTaken: String
        enforcementActionId: String
        enforcementActionType: String
        enforcementEndsAt: DateTime
        reviewedAt: DateTime
        evidence: [MarketplaceReportEvidence!]!
    }

    type MarketplaceVendorEnforcement {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        reportId: String!
        reportCode: String!
        type: String!
        status: String!
        message: String!
        durationDays: Int
        startsAt: DateTime!
        endsAt: DateTime
        acknowledgedAt: DateTime
    }

    type MarketplaceVendorAppealEvidence {
        id: ID!
        createdAt: DateTime!
        assetId: String!
        name: String!
        preview: String!
        mimeType: String!
    }

    type MarketplaceVendorAppeal {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        vendorProfileId: String!
        enforcementId: String!
        reportCode: String!
        vendorName: String!
        statement: String!
        status: String!
        supportConversationId: String
        adminNote: String
        reviewedAt: DateTime
        evidence: [MarketplaceVendorAppealEvidence!]!
    }

    type MarketplaceVendorAppealList {
        items: [MarketplaceVendorAppeal!]!
        totalItems: Int!
    }

    type MarketplaceReportList {
        items: [MarketplaceReport!]!
        totalItems: Int!
    }

    input MarketplaceChatListOptions {
        term: String
        status: String
        take: Int
    }

    input SendMarketplaceChatMessageInput {
        conversationId: ID!
        body: String!
        clientMessageId: String!
        attachmentIds: [ID!]
    }

    input CreateMarketplaceListingInquiryInput {
        productId: ID!
        inquiryType: String
        eventType: String
        eventDate: String
        startTime: String
        endTime: String
        guestCount: Int
        city: String
        venue: String
        budget: Money
        theme: String
        projectTitle: String
        projectType: String
        deadline: String
        brandName: String
        targetAudience: String
        projectGoal: String
        conceptCount: Int
        conceptNotes: String
        colorTheme: String
        stylePreferences: String
        dimensions: String
        fileFormats: [String!]
        contentStatus: String
        usageType: String
        revisionRounds: Int
        referenceLinks: [String!]
        ndaRequired: Boolean
        className: String
        desiredStartDate: String
        details: String!
    }

    input CreateMarketplaceListingQuoteInput {
        conversationId: ID!
        amount: Money!
        description: String!
        validUntil: DateTime!
        addOns: [MarketplaceListingQuoteAddOnInput!]
    }

    input MarketplaceListingQuoteAddOnInput {
        name: String!
        included: [String!]!
        price: Money!
    }

    type MarketplaceChatAttachment {
        id: ID!
        createdAt: DateTime!
        name: String!
        mimeType: String!
        size: Int!
        isImage: Boolean!
        downloadUrl: String!
    }

    type MarketplaceChatAttachmentDownload {
        name: String!
        mimeType: String!
        size: Int!
        data: String!
    }

    type MarketplaceChatAppealEvidence {
        id: String!
        name: String!
        mimeType: String!
        preview: String!
    }

    type MarketplaceChatAppealSummary {
        appealType: String!
        reference: String!
        subject: String!
        statement: String!
        adminNote: String
        evidence: [MarketplaceChatAppealEvidence!]!
    }

    type MarketplaceChatOrderReceiptLine {
        orderLineId: String!
        productName: String!
        variantName: String!
        sku: String!
        quantity: Int!
        unitPrice: Money!
        lineTotal: Money!
    }

    type MarketplaceChatOrderReceipt {
        sellerOrderCode: String!
        customerOrderCode: String!
        currencyCode: String!
        lines: [MarketplaceChatOrderReceiptLine!]!
        itemsBeforeDiscount: Money!
        discount: Money!
        productSubtotal: Money!
        rewardCoins: Int!
        rewardFunding: Money!
        couponCode: String
        couponDiscount: Money!
        couponFundingSource: String
        customerFundedProductAmount: Money!
        shipping: Money!
        taxIncluded: Money!
        orderTotal: Money!
        customerPaidTotal: Money!
        placedAt: DateTime!
    }

    type MarketplaceChatInquirySummary {
        inquiryType: String
        productId: String!
        productSlug: String!
        productName: String!
        categoryName: String!
        eventType: String
        eventDate: String
        startTime: String
        endTime: String
        guestCount: Int
        city: String
        venue: String
        budget: Money
        theme: String
        projectTitle: String
        projectType: String
        deadline: String
        brandName: String
        targetAudience: String
        projectGoal: String
        conceptCount: Int
        conceptNotes: String
        colorTheme: String
        stylePreferences: String
        dimensions: String
        fileFormats: [String!]
        contentStatus: String
        usageType: String
        revisionRounds: Int
        referenceLinks: [String!]
        ndaRequired: Boolean
        details: String!
    }

    type MarketplaceChatQuoteSummary {
        id: ID!
        code: String!
        productId: String!
        productVariantId: String!
        amount: Money!
        currencyCode: String!
        description: String!
        addOns: [MarketplaceListingQuoteAddOn!]!
        status: String!
        validUntil: DateTime!
        checkoutUrl: String!
    }

    type MarketplaceListingQuote {
        id: ID!
        code: String!
        conversationId: String!
        productId: String!
        productVariantId: String!
        productName: String!
        productSlug: String!
        variantName: String!
        sku: String!
        vendorName: String!
        vendorSlug: String!
        image: String!
        requiresShipping: Boolean!
        amount: Money!
        currencyCode: String!
        description: String!
        addOns: [MarketplaceListingQuoteAddOn!]!
        status: String!
        validUntil: DateTime!
        checkoutUrl: String!
        orderId: String
        orderCode: String
    }

    type MarketplaceListingQuoteAddOn {
        name: String!
        included: [String!]!
        price: Money!
    }

    type MarketplaceChatMessage {
        id: ID!
        createdAt: DateTime!
        conversationId: String!
        senderUserId: String
        senderName: String!
        senderRole: String!
        kind: String!
        body: String!
        automated: Boolean!
        clientMessageId: String
        orderReceipt: MarketplaceChatOrderReceipt
        orderStatus: String
        statusNote: String
        appealSummary: MarketplaceChatAppealSummary
        inquirySummary: MarketplaceChatInquirySummary
        quote: MarketplaceChatQuoteSummary
        attachments: [MarketplaceChatAttachment!]!
    }

    type MarketplaceChatConversation {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        sellerOrderId: String
        sellerOrderCode: String
        customerOrderId: String
        customerOrderCode: String
        customerId: String!
        customerName: String!
        customerEmail: String!
        vendorId: String!
        vendorName: String!
        status: String!
        conversationType: String!
        sourceId: String
        sourceCode: String
        closeAt: DateTime
        closedAt: DateTime
        closedReason: String
        lastMessageAt: DateTime!
        lastMessagePreview: String!
        lastSenderRole: String!
        unreadCount: Int!
        messages: [MarketplaceChatMessage!]!
    }

    type MarketplaceChatConversationList {
        items: [MarketplaceChatConversation!]!
        totalItems: Int!
        unreadCount: Int!
    }

    type MarketplaceChatSocketTicket {
        token: String!
        expiresAt: DateTime!
    }

    type MarketplaceChatReadResult {
        success: Boolean!
        readAt: DateTime!
    }
`;
