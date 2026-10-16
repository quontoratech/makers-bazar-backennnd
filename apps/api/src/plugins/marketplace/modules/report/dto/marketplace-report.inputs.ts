export interface SubmitMarketplaceReportInput {
    reporterName: string;
    reporterEmail: string;
    reporterPhone: string;
    targetType: 'SHOP' | 'LISTING' | 'USER' | 'SUSPICIOUS_ACTIVITY' | 'REVIEW';
    reportedUserId?: string | null;
    reportedUserName?: string | null;
    reportedUserEmail?: string | null;
    vendorProfileId?: string | null;
    vendorName?: string | null;
    productId?: string | null;
    reviewId?: string | null;
    listingName?: string | null;
    reportedUrl?: string | null;
    orderCode?: string | null;
    orderDetails?: string | null;
    category: string;
    subject: string;
    description: string;
    evidenceIds?: string[];
}

export interface ReviewMarketplaceReportInput {
    id: string;
    status: 'UNDER_REVIEW' | 'APPROVED' | 'ACTION_REQUIRED' | 'ACTION_TAKEN' | 'RESOLVED' | 'DISMISSED';
    adminNote?: string | null;
    actionTaken?: string | null;
    enforcement?: ApplyMarketplaceVendorEnforcementInput | null;
    removeLinkedReview?: boolean | null;
}

export interface ApplyMarketplaceVendorEnforcementInput {
    type: 'WARNING' | 'RESTRICTION' | 'PERMANENT_REMOVAL';
    message: string;
    durationDays?: number | null;
    confirmPermanentRemoval?: boolean | null;
}
