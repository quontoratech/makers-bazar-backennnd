import { RequestContext, VendureEvent } from '@vendure/core';

export interface MarketplaceOrderStatusProduct {
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
}

export class MarketplaceOrderStatusEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public emailAddress: string,
        public customerFirstName: string,
        public orderCode: string,
        public sellerOrderCode: string,
        public vendorName: string,
        public status: string,
        public statusLabel: string,
        public statusMessage: string,
        public trackingCode: string | undefined,
        public statusNote: string | undefined,
        public products: MarketplaceOrderStatusProduct[],
        public downloadReady: boolean,
    ) {
        super();
    }
}
