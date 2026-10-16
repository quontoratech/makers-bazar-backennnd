export interface SubmitMarketplaceVendorCategoryRequestInput {
    listingTypes: string[];
    businessReason: string;
    experience: string;
    fulfilmentPlan: string;
    categoryData: Record<string, unknown>;
    kycData: Record<string, unknown>;
    complianceConfirmed: boolean;
    documents?: Array<{
        id: string;
        documentType: string;
        fieldKey: string;
        expiresAt?: string;
    }>;
}

export interface ReviewMarketplaceVendorCategoryRequestInput {
    id: string;
    status: 'APPROVED' | 'REJECTED';
    adminNote: string;
}
