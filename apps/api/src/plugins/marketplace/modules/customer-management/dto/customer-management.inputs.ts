import { ID } from '@vendure/core';

export interface MarketplaceCustomerFilterInput {
    term?: string;
    verificationStatus?: string;
    riskLevel?: string;
}

export interface CreateMarketplaceCustomerDataRequestInput {
    customerId: ID;
    type: string;
    requestNote: string;
    correction?: {
        firstName?: string;
        lastName?: string;
        phoneNumber?: string;
        emailAddress?: string;
    };
}

export interface ProcessMarketplaceCustomerDataRequestInput {
    id: ID;
    status: string;
    adminNote: string;
    confirmDeletion?: boolean;
}
