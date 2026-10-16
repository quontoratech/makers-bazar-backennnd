export interface MarketplaceCouponFilterInput {
    purpose?: string;
    scope?: string;
    status?: string;
    term?: string;
}

export interface CreateMarketplaceCouponInput {
    code: string;
    name: string;
    description?: string;
    purpose?: string;
    rewardRecipientType?: string;
    rewardRecipientId?: string;
    rewardRecipientCode?: string;
    rewardRecipientName?: string;
    scope: string;
    targetId?: string;
    targetCode?: string;
    targetName?: string;
    discountType: string;
    discountValue: number;
    maximumDiscount?: number;
    minimumSpend?: number;
    currencyCode?: string;
    fundingSource: string;
    totalUsageLimit?: number;
    perCustomerUsageLimit?: number;
    status?: string;
    startsAt?: Date | string;
    endsAt?: Date | string;
}

export interface UpdateMarketplaceCouponInput extends CreateMarketplaceCouponInput {
    id: string;
}

export interface MarketplaceCouponQuoteItemInput {
    variantId: string;
    quantity: number;
    unitPrice: number;
}
