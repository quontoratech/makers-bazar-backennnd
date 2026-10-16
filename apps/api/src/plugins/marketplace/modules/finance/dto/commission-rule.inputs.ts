import { ID } from '@vendure/core';

import {
    MarketplaceCommissionRuleScope,
    MarketplaceCommissionRuleStatus,
} from '../entities/marketplace-commission-rule.entity';

export interface MarketplaceCommissionRuleFilterInput {
    scope?: MarketplaceCommissionRuleScope;
    status?: MarketplaceCommissionRuleStatus;
    targetId?: string;
    targetCode?: string;
    term?: string;
}

export interface CreateMarketplaceCommissionRuleInput {
    name: string;
    scope: MarketplaceCommissionRuleScope;
    targetId?: string;
    targetCode?: string;
    targetName?: string;
    commissionPercent?: number;
    feePercent?: number;
    fixedFee?: number;
    currencyCode?: string;
    priority?: number;
    status?: MarketplaceCommissionRuleStatus;
    startsAt?: Date | string | null;
    endsAt?: Date | string | null;
    description?: string;
    metadata?: Record<string, string | number | boolean>;
}

export interface UpdateMarketplaceCommissionRuleInput extends CreateMarketplaceCommissionRuleInput {
    id: ID;
}
