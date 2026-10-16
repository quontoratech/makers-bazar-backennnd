export type RefundableOrderStatus = 'CANCELLED' | 'REJECTED' | 'REFUNDED';

export interface CustomerRefundAmountInput {
    orderStatus: RefundableOrderStatus;
    productAmount: number;
    deliveryAmount: number;
    marketplaceFundingAmount: number;
}

export interface CustomerRefundAmounts {
    refundScope: 'FULL_WITH_DELIVERY' | 'PRODUCT_ONLY';
    productAmount: number;
    customerPaidProductAmount: number;
    deliveryAmount: number;
    marketplaceFundingAmount: number;
    cashAmount: number;
    grossAmount: number;
}

export function calculateCustomerRefundAmounts(input: CustomerRefundAmountInput): CustomerRefundAmounts {
    const productAmount = wholeMinorUnits(input.productAmount, 'Product amount');
    const configuredDelivery = wholeMinorUnits(input.deliveryAmount, 'Delivery amount');
    const marketplaceFundingAmount = Math.min(
        productAmount,
        wholeMinorUnits(input.marketplaceFundingAmount, 'Marketplace funding amount'),
    );
    const includeDelivery = input.orderStatus === 'CANCELLED' || input.orderStatus === 'REJECTED';
    const deliveryAmount = includeDelivery ? configuredDelivery : 0;
    const customerPaidProductAmount = Math.max(0, productAmount - marketplaceFundingAmount);

    return {
        refundScope: includeDelivery ? 'FULL_WITH_DELIVERY' : 'PRODUCT_ONLY',
        productAmount,
        customerPaidProductAmount,
        deliveryAmount,
        marketplaceFundingAmount,
        cashAmount: customerPaidProductAmount + deliveryAmount,
        grossAmount: productAmount + deliveryAmount,
    };
}

function wholeMinorUnits(value: number, label: string) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole amount`);
    return value;
}
