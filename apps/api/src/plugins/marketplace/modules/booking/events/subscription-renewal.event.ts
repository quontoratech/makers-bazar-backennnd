import { RequestContext, VendureEvent } from '@vendure/core';

export class MarketplaceSubscriptionRenewalEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public emailAddress: string,
        public productName: string,
        public className: string,
        public accessEndsAt: Date,
        public graceEndsAt: Date,
        public renewalToken: string,
    ) {
        super();
    }
}

export class MarketplaceSubscriptionCancellationEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public emailAddress: string,
        public vendorName: string,
        public customerName: string,
        public productName: string,
        public className: string,
        public reason?: string,
    ) {
        super();
    }
}
