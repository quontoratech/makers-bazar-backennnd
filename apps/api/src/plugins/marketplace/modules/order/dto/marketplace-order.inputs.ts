export interface MarketplaceOrderFilterInput {
    term?: string;
    vendorId?: string;
    customerId?: string;
    customerOrderCode?: string;
    status?: string;
}

export interface MarketplaceOrderLineAdjustmentInput {
    variantId: string;
    quantity: number;
    reason?: string;
}

export interface UpdateMarketplaceOrderStatusInput {
    orderId: string;
    status: string;
    trackingCode?: string;
    statusNote?: string;
    lineAdjustments?: MarketplaceOrderLineAdjustmentInput[];
}
