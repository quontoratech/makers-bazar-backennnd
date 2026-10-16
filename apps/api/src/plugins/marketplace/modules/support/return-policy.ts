export type MarketplaceReturnWindowDays = 7 | 14;

export interface MarketplaceReturnSelectionItem {
    orderLineId: string;
    quantity: number;
    productName?: string;
    variantName?: string;
    sku?: string;
}

/** Older cases without a selection applied to the complete vendor order. */
export function returnSelectionCoversWholeOrder(
    lines: Array<{ id: string | number; quantity: number }>,
    selected?: MarketplaceReturnSelectionItem[] | null,
): boolean {
    if (!selected) return true;
    if (!lines.length || selected.length !== lines.length) return false;
    const quantities = new Map(selected.map(item => [item.orderLineId, item.quantity]));
    return quantities.size === selected.length && lines.every(line => quantities.get(String(line.id)) === line.quantity);
}

export function configuredReturnWindowDays(): MarketplaceReturnWindowDays {
    return String(process.env.MARKETPLACE_RETURN_WINDOW_DAYS ?? '').trim() === '7' ? 7 : 14;
}

/** The delivery timestamp is immutable; changing order status never extends this deadline. */
export function evaluateReturnWindow(
    deliveredAt: Date | undefined,
    now: Date,
    days: MarketplaceReturnWindowDays,
): { eligible: boolean; deadlineAt?: Date; reason?: string } {
    if (!deliveredAt || !Number.isFinite(deliveredAt.getTime())) {
        return { eligible: false, reason: 'A confirmed delivery date is required before a return can be requested' };
    }
    const deadlineAt = new Date(deliveredAt.getTime() + days * 86_400_000);
    return now.getTime() <= deadlineAt.getTime()
        ? { eligible: true, deadlineAt }
        : { eligible: false, deadlineAt, reason: `The ${days}-day return window has ended` };
}
