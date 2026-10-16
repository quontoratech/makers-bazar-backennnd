import { RequestContext, VendureEvent } from '@vendure/core';

import {
    MarketplaceApplicationRole,
    MarketplaceApplicationStatus,
} from '../entities/role-application.entity';

export class RoleApplicationStatusEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public emailAddress: string,
        public firstName: string,
        public displayName: string,
        public reference: string,
        public role: MarketplaceApplicationRole,
        public status: MarketplaceApplicationStatus,
        public reviewNote?: string,
    ) {
        super();
    }
}

export class RoleApplicationApprovedEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public emailAddress: string,
        public firstName: string,
        public displayName: string,
        public reference: string,
        public role: MarketplaceApplicationRole,
        public temporaryPassword: string,
    ) {
        super();
    }
}
