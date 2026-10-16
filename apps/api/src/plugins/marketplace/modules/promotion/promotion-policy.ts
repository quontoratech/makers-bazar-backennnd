import type { MarketplacePromotionRate } from './entities/marketplace-promotion-rate.entity';
import type { MarketplacePromotionRequest } from './entities/marketplace-promotion-request.entity';

export const PROMOTION_DAY_MS = 86_400_000;
const weights = { GLOBAL: 1, CATEGORY: 2, VENDOR: 3, VENDOR_CATEGORY: 4, CAMPAIGN: 5 };

export function categoryContains(parent: string | undefined, child: string) {
    return Boolean(parent && (child === parent || child.startsWith(`${parent}/`)));
}

export function selectPromotionRate(
    rates: MarketplacePromotionRate[],
    target: {
        vendorId: string;
        categoryId?: string;
        categoryCode: string;
        campaignId?: string;
        placement: 'HOME' | 'CATEGORY' | 'BOTH';
    },
) {
    return rates
        .filter(rate => rate.active && rate.placement === target.placement)
        .filter(rate => {
            if (rate.scope === 'GLOBAL') return true;
            if (rate.scope === 'VENDOR') return rate.vendorProfileId === target.vendorId;
            const categoryMatches =
                Boolean(target.categoryId && rate.categoryId === target.categoryId) ||
                categoryContains(rate.categoryCode, target.categoryCode);
            if (rate.scope === 'CATEGORY') return categoryMatches;
            if (rate.scope === 'VENDOR_CATEGORY')
                return rate.vendorProfileId === target.vendorId && categoryMatches;
            return Boolean(target.campaignId && rate.campaignId === target.campaignId);
        })
        .sort(
            (a, b) =>
                weights[b.scope] - weights[a.scope] ||
                (b.categoryCode?.length ?? 0) - (a.categoryCode?.length ?? 0) ||
                b.updatedAt.getTime() - a.updatedAt.getTime(),
        )[0];
}

export function promotionSurfaces(placement: string) {
    return placement === 'BOTH' ? ['HOME', 'CATEGORY'] : [placement];
}

export function reservationIsLive(request: MarketplacePromotionRequest, now: Date) {
    if (request.status === 'PENDING_PAYMENT')
        return Boolean(request.paymentDueAt && request.paymentDueAt > now);
    return (
        ['PAYMENT_SUBMITTED', 'PAYMENT_VERIFIED', 'APPROVED'].includes(request.status) && request.endsAt > now
    );
}

// Count the busiest instant, so non-overlapping reservations can share the same slot.
export function maximumPromotionOverlap(requests: MarketplacePromotionRequest[], start: Date, end: Date) {
    const events = requests
        .flatMap(request => {
            const from = Math.max(request.startsAt.getTime(), start.getTime());
            const to = Math.min(request.endsAt.getTime(), end.getTime());
            return from < to
                ? [
                      { time: from, change: 1 },
                      { time: to, change: -1 },
                  ]
                : [];
        })
        .sort((a, b) => a.time - b.time || a.change - b.change);
    let count = 0;
    let maximum = 0;
    for (const event of events) {
        count += event.change;
        maximum = Math.max(maximum, count);
    }
    return maximum;
}

export function effectivePromotionStatus(request: MarketplacePromotionRequest, now = new Date()) {
    if (request.status === 'PENDING_PAYMENT' && request.paymentDueAt && request.paymentDueAt <= now)
        return 'EXPIRED';
    if (request.status === 'APPROVED' && request.endsAt <= now) return 'EXPIRED';
    return request.status;
}
