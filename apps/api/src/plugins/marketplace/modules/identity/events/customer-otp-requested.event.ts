import { RequestContext, VendureEvent } from '@vendure/core';

export class CustomerOtpRequestedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public emailAddress: string,
        public firstName: string,
        public code: string,
        public expiresAt: Date,
    ) {
        super();
    }
}
