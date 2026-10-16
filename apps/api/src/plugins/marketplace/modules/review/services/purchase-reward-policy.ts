import {
    MarketplacePurchaseRewardRuleScope,
} from '../entities/marketplace-purchase-reward-rule.entity';

export const purchaseRewardScopePrecedence: Record<MarketplacePurchaseRewardRuleScope, number> = {
    CATEGORY: 3,
    VENDOR: 2,
    GLOBAL: 1,
};

export interface PurchaseRewardRuleCandidate {
    scope: MarketplacePurchaseRewardRuleScope;
    targetId?: string;
    targetCode?: string;
    targetName?: string;
    priority: number;
    createdAt: Date;
}

export function resolvePurchaseRewardRule<T extends PurchaseRewardRuleCandidate>(
    rules: T[],
    vendorValues: Array<string | undefined>,
    categoryTargets: Set<string>,
) {
    const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
    const vendorTargets = new Set(vendorValues.map(normalize).filter(Boolean));
    return rules.filter(rule => {
        if (rule.scope === 'GLOBAL') return true;
        const targets = new Set([rule.targetId, rule.targetCode, rule.targetName]
            .map(normalize).filter(Boolean));
        if (rule.scope === 'VENDOR') return [...targets].some(target => vendorTargets.has(target));
        return [...targets].some(target => categoryTargets.has(target));
    }).sort((left, right) => (
        purchaseRewardScopePrecedence[right.scope] - purchaseRewardScopePrecedence[left.scope]
        || right.priority - left.priority
        || right.createdAt.getTime() - left.createdAt.getTime()
    ))[0];
}
