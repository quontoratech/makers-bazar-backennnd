import { ID } from '@vendure/core';

export interface CreateMarketplaceCustomerRefundInput {
    sellerOrderId: ID;
    supportCaseId?: ID;
    method: string;
    accountHolderName: string;
    bankName?: string | null;
    accountIdentifier: string;
    reason: string;
}

export interface ProcessMarketplaceCustomerRefundInput {
    id: ID;
    status: string;
    transactionReference?: string | null;
    decisionNote?: string | null;
}
