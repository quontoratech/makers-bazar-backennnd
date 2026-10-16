import type { MarketplaceCouponFundingSource } from './entities/marketplace-coupon.entity';
import type { MarketplaceCouponRuleSnapshot } from './entities/marketplace-coupon-redemption.entity';

export interface CouponDiscountInput {
    eligibleSubtotal: number;
    discountType: 'PERCENTAGE' | 'FIXED';
    discountValue: number;
    maximumDiscount?: number;
}

export interface CouponTargetLine {
    productId: string;
    vendorId: string;
    categoryId: string;
    categoryCode: string;
    categoryName: string;
    productSlug: string;
}

export function calculateCouponDiscount(input: CouponDiscountInput) {
    const eligibleSubtotal = wholeMinorUnits(input.eligibleSubtotal, 'Eligible subtotal');
    if (!Number.isFinite(input.discountValue) || input.discountValue <= 0) {
        throw new Error('Coupon discount value must be greater than zero');
    }
    if (input.discountType === 'PERCENTAGE' && input.discountValue > 100) {
        throw new Error('Coupon percentage cannot exceed 100%');
    }
    if (input.discountType === 'FIXED' && !Number.isInteger(input.discountValue)) {
        throw new Error('Fixed coupon discount must use whole minor units');
    }
    const maximumDiscount = input.maximumDiscount == null
        ? undefined
        : wholeMinorUnits(input.maximumDiscount, 'Maximum discount');
    const calculated = input.discountType === 'PERCENTAGE'
        ? Math.round(eligibleSubtotal * input.discountValue / 100)
        : input.discountValue;
    return Math.max(0, Math.min(eligibleSubtotal, maximumDiscount == null
        ? calculated
        : Math.min(calculated, maximumDiscount)));
}

export function allocateCouponByWeight(total: number, weights: number[]) {
    const amount = wholeMinorUnits(total, 'Coupon allocation');
    const normalized = weights.map(weight => wholeMinorUnits(weight, 'Coupon allocation weight'));
    const weightTotal = normalized.reduce((sum, weight) => sum + weight, 0);
    if (!normalized.length || weightTotal <= 0) return normalized.map(() => 0);
    const exact = normalized.map(weight => amount * weight / weightTotal);
    const result = exact.map(value => Math.floor(value));
    const remainder = amount - result.reduce((sum, value) => sum + value, 0);
    const remainderOrder = exact
        .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
        .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
    for (let index = 0; index < remainder; index += 1) {
        const targetIndex = remainderOrder[index % remainderOrder.length]!.index;
        result[targetIndex] = (result[targetIndex] ?? 0) + 1;
    }
    return result;
}

export function couponCommissionBase(
    lineTotal: number,
    couponDiscount: number,
    fundingSource: MarketplaceCouponFundingSource,
) {
    const total = wholeMinorUnits(lineTotal, 'Commission line total');
    const discount = Math.min(total, wholeMinorUnits(couponDiscount, 'Coupon discount'));
    return fundingSource === 'VENDOR' ? total - discount : total;
}

export function couponMatchesLine(snapshot: MarketplaceCouponRuleSnapshot, line: CouponTargetLine) {
    if (snapshot.scope === 'GLOBAL') return true;
    const targets = new Set([snapshot.targetId, snapshot.targetCode, snapshot.targetName]
        .map(normalizeTarget).filter(Boolean));
    if (snapshot.scope === 'VENDOR') return targets.has(normalizeTarget(line.vendorId));
    if (snapshot.scope === 'CATEGORY') {
        return (snapshot.categoryIds ?? []).includes(line.categoryId)
            || targets.has(normalizeTarget(line.categoryId))
            || targets.has(normalizeTarget(line.categoryCode))
            || targets.has(normalizeTarget(line.categoryName));
    }
    if (snapshot.campaignOwnerType === 'VENDOR' && snapshot.campaignOwnerId
        && normalizeTarget(snapshot.campaignOwnerId) !== normalizeTarget(line.vendorId)) return false;
    const target = snapshot.campaignTarget ?? {};
    const checks = [
        targetValues(target, ['vendorId', 'vendorIds', 'vendors'])
            .some(value => normalizeTarget(value) === normalizeTarget(line.vendorId)),
        targetValues(target, ['categoryCode', 'categoryCodes', 'categories'])
            .some(value => {
                const expected = normalizeTarget(value);
                const categoryCode = normalizeTarget(line.categoryCode);
                return categoryCode === expected
                    || categoryCode.startsWith(`${expected}/`)
                    || [line.categoryId, line.categoryName]
                        .some(candidate => expected === normalizeTarget(candidate));
            }),
        targetValues(target, ['productId', 'productIds', 'products'])
            .some(value => normalizeTarget(value) === normalizeTarget(line.productId)),
        targetValues(target, ['productSlug', 'productSlugs', 'slugs'])
            .some(value => normalizeTarget(value) === normalizeTarget(line.productSlug)),
    ];
    const targetingKeys = [
        'vendorId', 'vendorIds', 'vendors', 'categoryCode', 'categoryCodes', 'categories',
        'productId', 'productIds', 'products', 'productSlug', 'productSlugs', 'slugs',
    ];
    return targetingKeys.some(key => target[key] != null) ? checks.some(Boolean) : true;
}

function targetValues(target: Record<string, string | string[]>, keys: string[]) {
    return keys.flatMap(key => {
        const value = target[key];
        return Array.isArray(value) ? value : value ? [value] : [];
    });
}

function normalizeTarget(value: unknown) {
    return String(value ?? '').trim().toLowerCase();
}

function wholeMinorUnits(value: number, label: string) {
    if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative whole amount`);
    return value;
}
