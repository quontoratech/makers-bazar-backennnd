import gql from 'graphql-tag';

import { commonMarketplaceSchema } from './common-schema';
import { onboardingAdminSchema } from '../modules/onboarding/onboarding.api';

export const adminApiExtensions = gql`
    ${commonMarketplaceSchema}
    ${onboardingAdminSchema}

    input ReviewMarketplaceVendorInput {
        id: ID!
        status: String!
        reviewNote: String!
        commissionPercent: Float
        payoutSchedule: String
    }

    input ProvisionMarketplaceVendorInput {
        vendorProfileId: ID!
        temporaryPassword: String!
    }

    input UpdateMyMarketplaceVendorStorefrontInput {
        description: String
        featuredProductId: ID
        logoAssetId: ID
        logoUrl: String
        bannerAssetId: ID
        bannerUrl: String
        contactEmail: String
        phoneNumber: String
        policies: JSON
        serviceAreas: [MarketplaceVendorServiceAreaInput!]
        availabilityPaused: Boolean
        availabilityPauseReason: String
        availabilityTimezone: String
        weeklyHours: [MarketplaceVendorWeeklyHoursInput!]
        unavailableDates: [MarketplaceVendorUnavailableDateInput!]
        holidayModeEnabled: Boolean
        holidayStartsAt: DateTime
        holidayEndsAt: DateTime
        holidayReason: String
    }

    input MarketplaceVendorServiceAreaInput {
        id: ID
        scope: String!
        countryCode: String!
        province: String
        city: String
        areas: [String!]
    }

    input MarketplaceVendorWeeklyHoursInput {
        dayOfWeek: Int!
        enabled: Boolean!
        opensAt: String!
        closesAt: String!
    }

    input MarketplaceVendorUnavailableDateInput {
        id: ID
        date: String!
        reason: String!
    }

    input UpdateMarketplaceBookingStatusInput {
        id: ID!
        status: String!
        internalNote: String
        secureAccessReference: String
    }

    input ReviewMarketplaceAffiliateInput {
        id: ID!
        status: String!
        commissionPercent: Float
    }

    input AdminReplyToMarketplaceSupportCaseInput {
        id: ID!
        body: String!
        authorRole: String!
        assetIds: [String!]
        status: String
    }

    input ResolveMarketplaceSupportCaseInput {
        id: ID!
        decision: String!
        financialAdjustment: Money
    }

    extend type MarketplaceSupportCase {
        internalMessages: [MarketplaceSupportMessage!]
    }

    input MarketplaceCommissionRuleFilterInput {
        scope: String
        status: String
        targetId: String
        targetCode: String
        term: String
    }

    input MarketplaceCouponFilterInput {
        purpose: String
        scope: String
        status: String
        term: String
    }

    input CreateMarketplaceCouponInput {
        code: String!
        name: String!
        description: String
        purpose: String
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
        minimumSpend: Money
        currencyCode: String
        fundingSource: String!
        totalUsageLimit: Int
        perCustomerUsageLimit: Int
        status: String
        startsAt: DateTime
        endsAt: DateTime
    }

    input UpdateMarketplaceCouponInput {
        id: ID!
        code: String!
        name: String!
        description: String
        purpose: String
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
        minimumSpend: Money
        currencyCode: String
        fundingSource: String!
        totalUsageLimit: Int
        perCustomerUsageLimit: Int
        status: String
        startsAt: DateTime
        endsAt: DateTime
    }

    input CreateMarketplaceCommissionRuleInput {
        name: String!
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        commissionPercent: Float
        feePercent: Float
        fixedFee: Money
        currencyCode: String
        priority: Int
        status: String
        startsAt: DateTime
        endsAt: DateTime
        description: String
        metadata: JSON
    }

    input UpdateMarketplaceCommissionRuleInput {
        id: ID!
        name: String!
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        commissionPercent: Float
        feePercent: Float
        fixedFee: Money
        currencyCode: String
        priority: Int
        status: String
        startsAt: DateTime
        endsAt: DateTime
        description: String
        metadata: JSON
    }

    input UpdateMarketplacePayoutSettingsInput {
        holdingPeriodDays: Int!
        reservePercent: Float!
        minimumPayoutThreshold: Money!
        payoutSchedule: String!
        currencyCode: String
        requireSeparateApproval: Boolean
        adjustmentRules: JSON
    }

    input CreateMarketplacePayoutBatchInput {
        vendorIds: [ID!]
        note: String
    }

    input ApproveMarketplacePayoutBatchInput {
        id: ID!
        note: String
    }

    input ProcessMarketplacePayoutRecipientInput {
        payoutEntryId: ID!
        status: String!
        externalReference: String
        reason: String
    }

    input ProcessMarketplacePayoutBatchInput {
        id: ID!
        "Record PAID after an external transfer, FAILED after a failed transfer, or CANCELLED before funds are sent."
        status: String!
        "Required bank or wallet confirmation reference when recording PAID."
        externalReference: String
        "Required explanation when recording FAILED or CANCELLED."
        reason: String
        "Record outcomes for individual recipients when a batch contains separate transfers."
        payouts: [ProcessMarketplacePayoutRecipientInput!]
    }

    input UpdateMarketplaceVendorPayoutAccountInput {
        method: String!
        accountHolderName: String!
        bankName: String
        accountIdentifier: String
        accountIdentifierConfirmation: String
    }

    input ReviewMarketplaceVendorPayoutAccountInput {
        vendorId: ID!
        status: String!
        note: String
    }

    input CreateMarketplaceCustomerRefundInput {
        sellerOrderId: ID!
        supportCaseId: ID
        method: String!
        accountHolderName: String!
        bankName: String
        accountIdentifier: String!
        reason: String!
    }

    input ProcessMarketplaceCustomerRefundInput {
        id: ID!
        status: String!
        transactionReference: String
        decisionNote: String
    }

    input MarketplaceCustomerManagementFilterInput {
        term: String
        verificationStatus: String
        riskLevel: String
    }

    input MarketplaceCustomerCorrectionInput {
        firstName: String
        lastName: String
        phoneNumber: String
        emailAddress: String
    }

    input CreateMarketplaceCustomerDataRequestInput {
        customerId: ID!
        type: String!
        requestNote: String!
        correction: MarketplaceCustomerCorrectionInput
    }

    input ProcessMarketplaceCustomerDataRequestInput {
        id: ID!
        status: String!
        adminNote: String!
        confirmDeletion: Boolean
    }

    type MarketplaceManagedCustomerSummary {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        firstName: String!
        lastName: String!
        displayName: String!
        emailAddress: String!
        phoneNumber: String
        verified: Boolean!
        lastLogin: DateTime
        status: String!
        orderCount: Int!
        totalSpent: Money!
        refundTotal: Money!
        openSupportCases: Int!
        riskLevel: String!
        riskScore: Int!
        riskSignalCount: Int!
        openPrivacyRequestCount: Int!
    }

    type MarketplaceManagedCustomerList {
        items: [MarketplaceManagedCustomerSummary!]!
        totalItems: Int!
        verifiedCount: Int!
        attentionCount: Int!
        openRequestCount: Int!
    }

    type MarketplaceManagedCustomerAddress {
        id: ID!
        fullName: String
        company: String
        streetLine1: String!
        streetLine2: String
        city: String
        province: String
        postalCode: String
        countryCode: String
        countryName: String
        phoneNumber: String
        defaultShippingAddress: Boolean!
        defaultBillingAddress: Boolean!
    }

    type MarketplaceManagedCustomerOrder {
        id: ID!
        code: String!
        createdAt: DateTime!
        placedAt: DateTime
        state: String!
        marketplaceStatus: String!
        subTotal: Money!
        shipping: Money!
        total: Money!
        currencyCode: String!
        couponCodes: [String!]!
        shippingAddress: JSON
    }

    type MarketplaceManagedCustomerPayment {
        id: ID!
        createdAt: DateTime!
        orderId: String!
        orderCode: String!
        method: String!
        amount: Money!
        state: String!
        transactionId: String
        errorMessage: String
    }

    type MarketplaceManagedCustomerRefund {
        id: ID!
        createdAt: DateTime!
        orderId: String!
        orderCode: String!
        paymentId: String!
        method: String!
        total: Money!
        state: String!
        transactionId: String
        reason: String
    }

    type MarketplaceCustomerRiskSignal {
        code: String!
        severity: String!
        title: String!
        description: String!
        evidenceCount: Int!
    }

    type MarketplaceCustomerRiskAssessment {
        level: String!
        score: Int!
        signals: [MarketplaceCustomerRiskSignal!]!
        evaluatedAt: DateTime!
    }

    type MarketplaceCustomerRetentionAssessment {
        eligible: Boolean!
        retentionDays: Int!
        retainedUntil: DateTime
        reasons: [String!]!
        action: String!
    }

    type MarketplaceCustomerConsentRecord {
        id: ID!
        createdAt: DateTime!
        type: String!
        granted: Boolean!
        version: String!
        source: String!
        recordedAt: DateTime!
    }

    type MarketplaceCustomerDataRequest {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        code: String!
        customerId: String!
        customerUserId: String!
        customerEmail: String!
        type: String!
        status: String!
        requestNote: String!
        correction: JSON
        adminNote: String
        requestedByUserId: String!
        handledByUserId: String
        dueAt: DateTime!
        completedAt: DateTime
        exportGeneratedAt: DateTime
        retentionReason: String
    }

    type MarketplaceManagedCustomerProfile {
        summary: MarketplaceManagedCustomerSummary!
        addresses: [MarketplaceManagedCustomerAddress!]!
        orders: [MarketplaceManagedCustomerOrder!]!
        payments: [MarketplaceManagedCustomerPayment!]!
        refunds: [MarketplaceManagedCustomerRefund!]!
        reviews: [MarketplaceReview!]!
        supportCases: [MarketplaceSupportCase!]!
        consentRecords: [MarketplaceCustomerConsentRecord!]!
        policyReports: [MarketplaceReport!]!
        privacyRequests: [MarketplaceCustomerDataRequest!]!
        risk: MarketplaceCustomerRiskAssessment!
        retention: MarketplaceCustomerRetentionAssessment!
    }

    type MarketplacePlatformMetric {
        count: Int!
        amount: Money!
        detail: String!
    }

    type MarketplaceOperationalQueue {
        key: String!
        label: String!
        count: Int!
        tone: String!
        description: String!
        href: String!
        oldestAt: DateTime
    }

    type MarketplacePlatformMetrics {
        promotionRevenue: MarketplacePlatformMetric!
        commissionRevenue: MarketplacePlatformMetric!
        marketplaceEarnings: MarketplacePlatformMetric!
        sales: MarketplacePlatformMetric!
        orders: MarketplacePlatformMetric!
        activeCustomers: MarketplacePlatformMetric!
        activeVendors: MarketplacePlatformMetric!
        listings: MarketplacePlatformMetric!
        payments: MarketplacePlatformMetric!
        totalPayments: MarketplacePlatformMetric!
        refunds: MarketplacePlatformMetric!
        refundLiability: MarketplacePlatformMetric!
        disputes: MarketplacePlatformMetric!
        payouts: MarketplacePlatformMetric!
    }

    type MarketplaceCustomerRefund {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        sellerOrderId: String!
        supportCaseId: String
        returnItems: [MarketplaceReturnItem!]
        sellerOrderCode: String!
        customerOrderId: String!
        customerOrderCode: String!
        customerId: String!
        customerName: String!
        customerEmail: String!
        vendorId: String!
        vendorName: String!
        orderStatus: String!
        refundScope: String!
        productAmount: Money!
        customerPaidProductAmount: Money!
        deliveryAmount: Money!
        marketplaceFundingAmount: Money!
        rewardCoins: Int!
        couponCode: String
        couponDiscountAmount: Money!
        couponFundingSource: String
        cashAmount: Money!
        grossAmount: Money!
        currencyCode: String!
        status: String!
        method: String!
        accountHolderName: String!
        bankName: String
        accountIdentifier: String!
        reason: String!
        requestedByUserId: String!
        paidByUserId: String
        paidAt: DateTime
        transactionReference: String
        rejectedByUserId: String
        rejectedAt: DateTime
        decisionNote: String
    }

    type MarketplaceCustomerRefundDashboard {
        items: [MarketplaceCustomerRefund!]!
        totalItems: Int!
        unpaidCount: Int!
        unpaidAmount: Money!
        paidCount: Int!
        paidAmount: Money!
        rejectedCount: Int!
        currencyCode: String!
    }

    type MarketplacePlatformOverview {
        generatedAt: DateTime!
        periodStart: DateTime!
        periodEnd: DateTime!
        periodDays: Int!
        currencyCode: String!
        metrics: MarketplacePlatformMetrics!
        queues: [MarketplaceOperationalQueue!]!
        totalQueueItems: Int!
    }

    type MarketplaceVendorPayoutAccountReview {
        vendorId: ID!
        vendorName: String!
        ownerName: String!
        ownerEmailAddress: String!
        method: String
        accountHolderName: String
        bankName: String
        accountIdentifier: String
        accountIdentifierMasked: String
        verificationStatus: String!
        submittedAt: DateTime
        verifiedAt: DateTime
        verifiedByUserId: String
        verificationNote: String
    }

    input CreateMarketplaceLedgerAdjustmentInput {
        beneficiaryId: ID!
        beneficiaryType: String
        kind: String!
        direction: String
        amount: Money!
        reason: String!
        orderId: String
        externalReference: String
        metadata: JSON
    }

    input MarketplaceFinanceReportInput {
        reportType: String!
        from: DateTime
        to: DateTime
        vendorId: String
    }

    input CreateMarketplacePromotionInput {
        ownerType: String!
        ownerId: String
        campaignType: String!
        title: String!
        description: String
        placement: String!
        budget: Money
        maxPlacements: Int
        startsAt: DateTime!
        endsAt: DateTime!
        target: JSON
        creative: JSON
    }

    input ReviewMarketplacePromotionInput {
        id: ID!
        status: String!
    }

    input UpdateMarketplacePromotionInput {
        id: ID!
        title: String
        description: String
        placement: String
        budget: Money
        maxPlacements: Int
        startsAt: DateTime
        endsAt: DateTime
        target: JSON
        creative: JSON
    }

    input CreateMarketplacePromotionRateInput {
        id: ID
        scope: String!
        placement: String!
        vendorProfileId: String
        categoryId: String
        categoryCode: String
        campaignId: String
        pricePerDay: Money!
        currencyCode: String
        active: Boolean
        note: String
    }

    input CreateMarketplacePromotionRequestInput {
        productId: ID
        targetType: String
        categoryId: ID
        placement: String!
        campaignId: ID
        startsAt: DateTime!
        durationDays: Int!
        expectedAmount: Money
    }

    input SubmitMarketplacePromotionPaymentInput {
        id: ID!
        paymentReference: String!
        paymentNote: String
    }

    input MarketplacePromotionPaymentFilterInput {
        skip: Int
        take: Int
        term: String
        status: String
        vendorProfileId: String
    }

    input ReviewMarketplacePromotionRequestInput {
        id: ID!
        status: String!
        paymentStatus: String
        adminNote: String
    }

    input UpdateMarketplacePromotionSettingsInput {
        homeSlots: Int!
        categorySlots: Int!
        paymentWindowHours: Int!
        paymentInstructions: String!
    }

    input CreateMarketplaceArticleInput {
        slug: String!
        title: String!
        excerpt: String!
        body: String!
        featuredAssetId: String
        tags: [String!]
        relations: JSON
        seo: JSON
    }

    input UpdateMarketplaceArticleStatusInput {
        id: ID!
        status: String!
        publishedAt: DateTime
    }

    input MarketplaceProductOptionGroupInput {
        id: ID
        name: String!
        values: [String!]!
    }

    input MarketplaceProductVariantInput {
        id: ID
        sku: String!
        price: Money!
        compareAtPrice: Money
        imageAssetId: ID
        stockOnHand: Int!
        optionValues: JSON
        barcode: String
        weightGrams: Int
        lowStockThreshold: Int
        allowBackorders: Boolean
        backorderLimit: Int
        maxOrderQuantity: Int
        availabilityEndsAt: DateTime
    }

    input MarketplaceInventoryUpdateInput {
        variantId: ID!
        stockOnHand: Int!
        lowStockThreshold: Int!
        allowBackorders: Boolean!
        backorderLimit: Int!
        maxOrderQuantity: Int!
    }

    input CreateMarketplaceProductInput {
        name: String!
        slug: String
        description: String!
        categoryId: ID
        categoryCode: String
        secondaryCategoryIds: [ID!]
        brand: String
        tags: [String!]
        attributes: JSON
        stylingVideoUrl: String
        deliveryInformation: String
        shippingProfileId: String
        returnPolicy: String
        disclaimer: String
        seoTitle: String
        seoDescription: String
        assetIds: [String!]
        featuredAssetId: String
        optionGroups: [MarketplaceProductOptionGroupInput!]
        variants: [MarketplaceProductVariantInput!]!
        servicePackages: JSON
        serviceAddOns: JSON
        availabilitySessions: JSON
        eventTicketTypes: JSON
        eventScheduleItems: JSON
        digitalFiles: JSON
    }

    input UpdateMarketplaceProductInput {
        id: ID!
        name: String!
        slug: String
        description: String!
        categoryId: ID
        categoryCode: String
        secondaryCategoryIds: [ID!]
        brand: String
        tags: [String!]
        attributes: JSON
        stylingVideoUrl: String
        deliveryInformation: String
        shippingProfileId: String
        returnPolicy: String
        disclaimer: String
        seoTitle: String
        seoDescription: String
        assetIds: [String!]
        featuredAssetId: String
        optionGroups: [MarketplaceProductOptionGroupInput!]
        variants: [MarketplaceProductVariantInput!]!
        servicePackages: JSON
        serviceAddOns: JSON
        availabilitySessions: JSON
        eventTicketTypes: JSON
        eventScheduleItems: JSON
        digitalFiles: JSON
    }

    input CreateMarketplaceCategoryInput {
        name: String!
        slug: String
        parentId: ID
        description: String
        icon: String
        imageAssetId: ID
        sortOrder: Int
        isActive: Boolean
        chatEnabled: Boolean
        formTemplateId: ID
    }

    input UpdateMarketplaceCategoryInput {
        id: ID!
        name: String
        slug: String
        parentId: ID
        description: String
        icon: String
        imageAssetId: ID
        sortOrder: Int
        isActive: Boolean
        chatEnabled: Boolean
        formTemplateId: ID
        inheritFormTemplate: Boolean
    }

    input UpsertMarketplaceCategoryFieldInput {
        id: ID
        categoryId: ID!
        fieldKey: String!
        label: String!
        inputType: String!
        required: Boolean
        section: String
        helpText: String
        placeholder: String
        unit: String
        options: [String!]
        validation: JSON
        ui: JSON
        condition: JSON
        sortOrder: Int
        isActive: Boolean
        overrideMode: String
    }

    input UpdateMarketplaceFormTemplateInput {
        id: ID!
        name: String
        isActive: Boolean
        schema: JSON
    }

    input CreateMarketplaceFormTemplateInput {
        key: String!
        name: String!
        listingType: String!
        schema: JSON!
        isActive: Boolean
    }

    input ReviewMarketplaceRoleApplicationInput {
        id: ID!
        status: String!
        reviewNote: String
    }

    input MarketplaceOrderFilterInput {
        term: String
        vendorId: String
        customerId: String
        customerOrderCode: String
        status: String
    }

    input MarketplaceOrderLineAdjustmentInput {
        variantId: ID!
        quantity: Int!
        reason: String
    }

    input UpdateMarketplaceOrderStatusInput {
        orderId: ID!
        status: String!
        trackingCode: String
        statusNote: String
        lineAdjustments: [MarketplaceOrderLineAdjustmentInput!]
    }

    input MarketplaceShippingZoneInput {
        id: String
        name: String!
        cities: [String!]
        provinces: [String!]
        postalCodes: [String!]
        rate: Money!
        minDeliveryDays: Int!
        maxDeliveryDays: Int!
        enabled: Boolean
    }

    input MarketplaceDeliveryProfileInput {
        id: String
        name: String!
        description: String
        enabled: Boolean
        mode: String!
        flatRate: Money!
        fallbackEnabled: Boolean
        fallbackRate: Money!
        processingDays: Int!
        defaultMinDeliveryDays: Int!
        defaultMaxDeliveryDays: Int!
        zones: [MarketplaceShippingZoneInput!]
    }

    input UpdateMarketplaceShippingProfileInput {
        defaultProfileId: String!
        deliveryProfiles: [MarketplaceDeliveryProfileInput!]!
    }

    input MarketplaceReportFilterInput {
        status: String
        category: String
        term: String
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

    input ReviewMarketplaceReportInput {
        id: ID!
        status: String!
        adminNote: String
        actionTaken: String
        enforcement: MarketplaceVendorEnforcementInput
        removeLinkedReview: Boolean
    }

    input RespondToMarketplaceReviewInput {
        id: ID!
        response: String!
    }

    input MarketplaceVendorEnforcementInput {
        type: String!
        message: String!
        durationDays: Int
        confirmPermanentRemoval: Boolean
    }

    input SubmitMarketplaceVendorAppealInput {
        enforcementId: ID!
        statement: String!
        evidenceIds: [ID!]!
    }

    input ReviewMarketplaceVendorAppealInput {
        id: ID!
        decision: String!
        adminNote: String
    }

    input UpdateMarketplaceReviewRewardSettingsInput {
        enabled: Boolean!
        productReviewPoints: Int!
        imageBonusPoints: Int!
        videoBonusPoints: Int!
        vendorReviewPoints: Int!
    }

    input UpdateMarketplaceRewardRedemptionSettingsInput {
        enabled: Boolean!
        minimumWalletBalance: Int!
        coinsPerPkr: Int!
    }

    input CreateMarketplacePurchaseRewardRuleInput {
        name: String!
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        pointsPerUnit: Int!
        priority: Int
        status: String
        startsAt: DateTime
        endsAt: DateTime
        description: String
    }

    input UpdateMarketplacePurchaseRewardRuleInput {
        id: ID!
        name: String!
        scope: String!
        targetId: String
        targetCode: String
        targetName: String
        pointsPerUnit: Int!
        priority: Int
        status: String
        startsAt: DateTime
        endsAt: DateTime
        description: String
    }

    input MarketplaceVendorCategoryRequestDocumentInput {
        id: ID!
        documentType: String!
        fieldKey: String!
        expiresAt: DateTime
    }

    input SubmitMarketplaceVendorCategoryRequestInput {
        listingTypes: [String!]!
        businessReason: String!
        experience: String!
        fulfilmentPlan: String!
        categoryData: JSON!
        kycData: JSON!
        complianceConfirmed: Boolean!
        documents: [MarketplaceVendorCategoryRequestDocumentInput!]
    }

    input ReviewMarketplaceVendorCategoryRequestInput {
        id: ID!
        status: String!
        adminNote: String!
    }

    extend type Query {
        marketplaceRoleTemplates: [MarketplaceRoleTemplate!]!
        marketplaceVendors(options: MarketplaceListOptions, status: String): MarketplaceVendorProfileList!
        marketplaceBookings(options: MarketplaceListOptions): MarketplaceBookingList!
        marketplaceAffiliates(options: MarketplaceListOptions): MarketplaceAffiliateProfileList!
        marketplaceSupportCases(options: MarketplaceListOptions): MarketplaceSupportCaseList!
        marketplaceReturnCases(options: MarketplaceListOptions, sellerOrderIds: [ID!]): MarketplaceSupportCaseList!
        myMarketplaceVendorReturnCases: [MarketplaceSupportCase!]!
        marketplacePromotionCampaigns(options: MarketplaceListOptions): MarketplacePromotionCampaignList!
        marketplacePromotionRates: [MarketplacePromotionRate!]!
        marketplacePromotionTargets: MarketplacePromotionTargets!
        marketplacePromotionRequests(options: MarketplaceListOptions, status: String): MarketplacePromotionRequestList!
        myMarketplacePromotionRequests: MarketplacePromotionRequestList!
        myMarketplacePromotionRates: [MarketplacePromotionRate!]!
        myMarketplacePromotionCampaigns: [MarketplacePromotionCampaign!]!
        marketplacePromotionSettings: MarketplacePromotionSettings!
        marketplacePromotionPaymentOptions: MarketplacePromotionPaymentOptions!
        marketplacePromotionPayments(input: MarketplacePromotionPaymentFilterInput): MarketplacePromotionPaymentDashboard!
        myMarketplacePromotionQuote(input: CreateMarketplacePromotionRequestInput!): MarketplacePromotionQuote!
        marketplaceArticleList(options: MarketplaceListOptions): MarketplaceArticleList!
        marketplacePayoutLedger(
            options: MarketplaceListOptions
            beneficiaryId: String
        ): MarketplacePayoutLedgerEntryList!
        marketplaceCommissionRules(
            options: MarketplaceListOptions
            filter: MarketplaceCommissionRuleFilterInput
        ): MarketplaceCommissionRuleList!
        marketplaceCoupons(options: MarketplaceListOptions, filter: MarketplaceCouponFilterInput): MarketplaceCouponList!
        marketplaceCouponDashboard: MarketplaceCouponDashboard!
        marketplaceFinanceDashboard: MarketplaceFinanceDashboard!
        marketplaceVendorPayoutAccounts(status: String): [MarketplaceVendorPayoutAccountReview!]!
        marketplaceManagedCustomers(
            options: MarketplaceListOptions
            filter: MarketplaceCustomerManagementFilterInput
        ): MarketplaceManagedCustomerList!
        marketplaceManagedCustomer(id: ID!): MarketplaceManagedCustomerProfile!
        marketplaceManagedCustomerExport(id: ID!): JSON!
        marketplaceReviewRewardDashboard: MarketplaceReviewRewardAdminDashboard!
        myMarketplaceVendorCategoryAccess: MarketplaceVendorCategoryAccessDashboard!
        marketplaceVendorCategoryRequests(status: String): [MarketplaceVendorCategoryRequest!]!
        marketplaceCustomerRefunds(status: String): MarketplaceCustomerRefundDashboard!
        marketplacePlatformOverview: MarketplacePlatformOverview!
        myMarketplaceVendorFinance: MarketplaceVendorFinanceDashboard!
        marketplaceVendorFinanceStatement(vendorId: ID!): MarketplaceVendorFinanceStatement!
        marketplaceFinanceReport(input: MarketplaceFinanceReportInput!): MarketplaceFinanceReport!
        marketplaceIdentity: MarketplaceIdentity
        marketplaceRoleApplications(
            options: MarketplaceListOptions
            status: String
            role: String
        ): MarketplaceRoleApplicationList!
        marketplaceProductCategories: [MarketplaceProductCategoryDefinition!]!
        marketplaceCategoryTree(includeInactive: Boolean): [MarketplaceCategory!]!
        marketplaceCategories(includeInactive: Boolean): [MarketplaceCategory!]!
        marketplaceCategoryFormSchema(categoryId: ID!): MarketplaceResolvedFormSchema!
        marketplaceFormTemplates(includeInactive: Boolean): [MarketplaceFormTemplate!]!
        marketplaceCategoryFields(categoryId: ID!): [MarketplaceCategoryField!]!
        myMarketplaceVendorProfile: MarketplaceVendorProfile!
        myMarketplaceProducts: MarketplaceCatalogProductList!
        myMarketplaceProduct(id: ID!): MarketplaceCatalogProduct!
        myMarketplaceVendorOrders(options: MarketplaceListOptions, filter: MarketplaceOrderFilterInput): MarketplaceOrderList!
        myMarketplaceVendorOverview: MarketplaceVendorOverview!
        myMarketplaceVendorReviewDashboard(options: MarketplaceListOptions): MarketplaceVendorReviewDashboard!
        myMarketplaceInventory: MarketplaceInventory!
        marketplaceOrders(options: MarketplaceListOptions, filter: MarketplaceOrderFilterInput): MarketplaceOrderList!
        myMarketplaceShippingProfile: MarketplaceShippingProfile!
        marketplaceReports(options: MarketplaceListOptions, filter: MarketplaceReportFilterInput): MarketplaceReportList!
        myMarketplaceVendorEnforcements: [MarketplaceVendorEnforcement!]!
        myMarketplaceVendorAppeals: [MarketplaceVendorAppeal!]!
        marketplaceVendorAppeals(options: MarketplaceListOptions, status: String): MarketplaceVendorAppealList!
        marketplaceChatConversations(options: MarketplaceChatListOptions): MarketplaceChatConversationList!
        marketplaceChatConversation(id: ID!): MarketplaceChatConversation!
        marketplaceChatSocketTicket: MarketplaceChatSocketTicket!
        marketplaceChatAttachment(id: ID!): MarketplaceChatAttachmentDownload!
    }

    extend type Mutation {
        initializeMarketplaceRoles: [MarketplaceRoleTemplate!]!
        reviewMarketplaceVendor(input: ReviewMarketplaceVendorInput!): MarketplaceVendorProfile!
        provisionMarketplaceVendor(input: ProvisionMarketplaceVendorInput!): MarketplaceVendorProfile!
        updateMyMarketplaceVendorStorefront(input: UpdateMyMarketplaceVendorStorefrontInput!): MarketplaceVendorProfile!
        updateMarketplaceBookingStatus(input: UpdateMarketplaceBookingStatusInput!): MarketplaceBooking!
        reviewMarketplaceAffiliate(input: ReviewMarketplaceAffiliateInput!): MarketplaceAffiliateProfile!
        adminReplyToMarketplaceSupportCase(
            input: AdminReplyToMarketplaceSupportCaseInput!
        ): MarketplaceSupportCase!
        resolveMarketplaceSupportCase(input: ResolveMarketplaceSupportCaseInput!): MarketplaceSupportCase!
        vendorReplyToMarketplaceReturnCase(id: ID!, body: String!): MarketplaceSupportCase!
        adminMessageMarketplaceReturnVendor(id: ID!, body: String!): MarketplaceSupportCase!
        decideMarketplaceReturnCase(id: ID!, decision: String!, note: String!, requiresReturn: Boolean): MarketplaceSupportCase!
        markMarketplaceReturnReceived(id: ID!, note: String!): MarketplaceSupportCase!
        createMarketplacePromotion(input: CreateMarketplacePromotionInput!): MarketplacePromotionCampaign!
        updateMarketplacePromotion(input: UpdateMarketplacePromotionInput!): MarketplacePromotionCampaign!
        reviewMarketplacePromotion(input: ReviewMarketplacePromotionInput!): MarketplacePromotionCampaign!
        createMarketplacePromotionRate(input: CreateMarketplacePromotionRateInput!): MarketplacePromotionRate!
        createMarketplacePromotionRequest(input: CreateMarketplacePromotionRequestInput!): MarketplacePromotionRequest!
        submitMarketplacePromotionPayment(input: SubmitMarketplacePromotionPaymentInput!): MarketplacePromotionRequest!
        createMarketplacePromotionCardCheckout(id: ID!): MarketplacePromotionCardCheckout!
        syncMarketplacePromotionCardCheckout(sessionId: String!): MarketplacePromotionRequest!
        cancelMarketplacePromotionCardCheckout(id: ID!): MarketplacePromotionRequest!
        reviewMarketplacePromotionRequest(input: ReviewMarketplacePromotionRequestInput!): MarketplacePromotionRequest!
        updateMarketplacePromotionSettings(input: UpdateMarketplacePromotionSettingsInput!): MarketplacePromotionSettings!
        cancelMyMarketplacePromotionRequest(id: ID!): MarketplacePromotionRequest!
        createMarketplaceArticle(input: CreateMarketplaceArticleInput!): MarketplaceArticle!
        updateMarketplaceArticleStatus(input: UpdateMarketplaceArticleStatusInput!): MarketplaceArticle!
        approveMarketplacePayout(id: ID!, reason: String!): MarketplacePayoutLedgerEntry!
        createMarketplaceCommissionRule(input: CreateMarketplaceCommissionRuleInput!): MarketplaceCommissionRule!
        updateMarketplaceCommissionRule(input: UpdateMarketplaceCommissionRuleInput!): MarketplaceCommissionRule!
        deleteMarketplaceCommissionRule(id: ID!): MarketplaceActionResult!
        createMarketplaceCoupon(input: CreateMarketplaceCouponInput!): MarketplaceCoupon!
        updateMarketplaceCoupon(input: UpdateMarketplaceCouponInput!): MarketplaceCoupon!
        deleteMarketplaceCoupon(id: ID!): MarketplaceActionResult!
        updateMarketplacePayoutSettings(input: UpdateMarketplacePayoutSettingsInput!): MarketplacePayoutSettings!
        createMarketplacePayoutBatch(input: CreateMarketplacePayoutBatchInput!): MarketplacePayoutBatch!
        confirmMarketplaceCompanyReceipt(orderId: ID!, amount: Money!, reference: String!): MarketplaceActionResult!
        approveMarketplacePayoutBatch(input: ApproveMarketplacePayoutBatchInput!): MarketplacePayoutBatch!
        processMarketplacePayoutBatch(input: ProcessMarketplacePayoutBatchInput!): MarketplacePayoutBatch!
        createMarketplaceLedgerAdjustment(input: CreateMarketplaceLedgerAdjustmentInput!): MarketplacePayoutLedgerEntry!
        updateMyMarketplaceVendorPayoutAccount(input: UpdateMarketplaceVendorPayoutAccountInput!): MarketplaceVendorPayoutAccount!
        reviewMarketplaceVendorPayoutAccount(input: ReviewMarketplaceVendorPayoutAccountInput!): MarketplaceVendorPayoutAccount!
        createMarketplaceCustomerRefund(input: CreateMarketplaceCustomerRefundInput!): MarketplaceCustomerRefund!
        processMarketplaceCustomerRefund(input: ProcessMarketplaceCustomerRefundInput!): MarketplaceCustomerRefund!
        createMarketplaceCustomerDataRequest(input: CreateMarketplaceCustomerDataRequestInput!): MarketplaceCustomerDataRequest!
        processMarketplaceCustomerDataRequest(input: ProcessMarketplaceCustomerDataRequestInput!): MarketplaceCustomerDataRequest!
        updateMarketplaceReviewRewardSettings(input: UpdateMarketplaceReviewRewardSettingsInput!): MarketplaceReviewRewardSettings!
        updateMarketplaceRewardRedemptionSettings(input: UpdateMarketplaceRewardRedemptionSettingsInput!): MarketplaceRewardRedemptionSettings!
        createMarketplacePurchaseRewardRule(input: CreateMarketplacePurchaseRewardRuleInput!): MarketplacePurchaseRewardRule!
        updateMarketplacePurchaseRewardRule(input: UpdateMarketplacePurchaseRewardRuleInput!): MarketplacePurchaseRewardRule!
        deleteMarketplacePurchaseRewardRule(id: ID!): MarketplaceActionResult!
        uploadMarketplaceVendorCategoryRequestDocuments(files: [Upload!]!): [MarketplaceVendorCategoryRequestDocument!]!
        removeMarketplaceVendorCategoryRequestDocument(id: ID!): MarketplaceActionResult!
        submitMarketplaceVendorCategoryRequest(input: SubmitMarketplaceVendorCategoryRequestInput!): MarketplaceVendorCategoryRequest!
        reviewMarketplaceVendorCategoryRequest(input: ReviewMarketplaceVendorCategoryRequestInput!): MarketplaceVendorCategoryRequest!
        reviewMarketplaceRoleApplication(input: ReviewMarketplaceRoleApplicationInput!): MarketplaceRoleApplication!
        blockMarketplaceRoleApplication(id: ID!, reason: String!): MarketplaceRoleApplication!
        unblockMarketplaceRoleApplication(id: ID!): MarketplaceRoleApplication!
        approveMarketplaceRoleApplication(id: ID!): MarketplaceRoleApplication!
        changeMarketplaceTemporaryPassword(currentPassword: String!, newPassword: String!): MarketplaceActionResult!
        createMarketplaceProduct(input: CreateMarketplaceProductInput!): MarketplaceCatalogProduct!
        updateMarketplaceProduct(input: UpdateMarketplaceProductInput!): MarketplaceCatalogProduct!
        createMarketplaceCategory(input: CreateMarketplaceCategoryInput!): MarketplaceCategory!
        createMarketplaceFormTemplate(input: CreateMarketplaceFormTemplateInput!): MarketplaceFormTemplate!
        updateMarketplaceCategory(input: UpdateMarketplaceCategoryInput!): MarketplaceCategory!
        reorderMarketplaceCategories(parentId: ID, categoryIds: [ID!]!): [MarketplaceCategory!]!
        deleteMarketplaceCategory(id: ID!): MarketplaceActionResult!
        upsertMarketplaceCategoryField(input: UpsertMarketplaceCategoryFieldInput!): MarketplaceCategoryField!
        deleteMarketplaceCategoryField(id: ID!): MarketplaceActionResult!
        updateMarketplaceFormTemplate(input: UpdateMarketplaceFormTemplateInput!): MarketplaceFormTemplate!
        bulkUpdateMarketplaceInventory(input: [MarketplaceInventoryUpdateInput!]!): MarketplaceInventory!
        publishMarketplaceProduct(id: ID!): MarketplaceCatalogProduct!
        deleteMarketplaceProduct(id: ID!): MarketplaceActionResult!
        updateMarketplaceOrderStatus(input: UpdateMarketplaceOrderStatusInput!): MarketplaceOrder!
        respondToMarketplaceReview(input: RespondToMarketplaceReviewInput!): MarketplaceReview!
        updateMyMarketplaceShippingProfile(input: UpdateMarketplaceShippingProfileInput!): MarketplaceShippingProfile!
        uploadMarketplaceReportEvidence(files: [Upload!]!): [MarketplaceReportEvidence!]!
        submitMarketplaceReport(input: SubmitMarketplaceReportInput!): MarketplaceReport!
        reviewMarketplaceReport(input: ReviewMarketplaceReportInput!): MarketplaceReport!
        acknowledgeMarketplaceVendorEnforcement(id: ID!): MarketplaceVendorEnforcement!
        uploadMarketplaceVendorAppealEvidence(files: [Upload!]!): [MarketplaceVendorAppealEvidence!]!
        submitMarketplaceVendorAppeal(input: SubmitMarketplaceVendorAppealInput!): MarketplaceVendorAppeal!
        reviewMarketplaceVendorAppeal(input: ReviewMarketplaceVendorAppealInput!): MarketplaceVendorAppeal!
        sendMarketplaceChatMessage(input: SendMarketplaceChatMessageInput!): MarketplaceChatMessage!
        markMarketplaceChatConversationRead(id: ID!): MarketplaceChatReadResult!
        uploadMarketplaceChatAttachments(conversationId: ID!, files: [Upload!]!): [MarketplaceChatAttachment!]!
        createMarketplaceListingQuote(input: CreateMarketplaceListingQuoteInput!): MarketplaceChatMessage!
    }
`;
