import { ID } from '@vendure/core';

export interface OpenSupportCaseInput {
    vendorProfileId?: string;
    orderId?: string;
    category: string;
    subject: string;
    message: string;
    priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
    assetIds?: string[];
}

export interface OpenMarketplaceReturnCaseInput {
    sellerOrderId: ID;
    reason: string;
    items: Array<{ orderLineId: ID; quantity: number }>;
    assetIds?: string[];
}

export interface ReplyToSupportCaseInput {
    id: ID;
    body: string;
    authorRole: string;
    assetIds?: string[];
    status?: 'OPEN' | 'WAITING_FOR_CUSTOMER' | 'WAITING_FOR_VENDOR' | 'ESCALATED' | 'RESOLVED' | 'CLOSED'
        | 'RETURN_APPROVED' | 'RETURN_REJECTED' | 'RETURN_RECEIVED' | 'REFUND_PENDING' | 'REFUNDED';
}

export interface ResolveSupportCaseInput {
    id: ID;
    decision: string;
    financialAdjustment?: number;
}
