import { ID } from '@vendure/core';

import {
    MarketplacePurchaseRewardRuleScope,
    MarketplacePurchaseRewardRuleStatus,
} from '../entities/marketplace-purchase-reward-rule.entity';

export interface CreateMarketplacePurchaseRewardRuleInput {
    name: string;
    scope: MarketplacePurchaseRewardRuleScope;
    targetId?: string;
    targetCode?: string;
    targetName?: string;
    pointsPerUnit: number;
    priority?: number;
    status?: MarketplacePurchaseRewardRuleStatus;
    startsAt?: Date | string | null;
    endsAt?: Date | string | null;
    description?: string;
}

export interface UpdateMarketplacePurchaseRewardRuleInput extends CreateMarketplacePurchaseRewardRuleInput {
    id: ID;
}
