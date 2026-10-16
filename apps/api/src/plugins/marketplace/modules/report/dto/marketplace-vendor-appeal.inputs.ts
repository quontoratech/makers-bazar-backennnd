export interface SubmitMarketplaceVendorAppealInput {
    enforcementId: string;
    statement: string;
    evidenceIds: string[];
}

export interface ReviewMarketplaceVendorAppealInput {
    id: string;
    decision: 'APPROVED' | 'REJECTED';
    adminNote?: string | null;
}
