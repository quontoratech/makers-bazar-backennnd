import type { MarketplaceChatSenderRole } from './entities/marketplace-chat-conversation.entity';
import type {
    MarketplaceChatOrderReceipt,
    MarketplaceChatOrderReceiptLine,
} from './entities/marketplace-chat-message.entity';

export function canAccessMarketplaceChat(
    principal: { userId: string; role: MarketplaceChatSenderRole },
    conversation: { customerUserId: string; vendorOwnerUserId: string },
) {
    if (principal.role === 'CUSTOMER') return conversation.customerUserId === principal.userId;
    if (principal.role === 'VENDOR') return conversation.vendorOwnerUserId === principal.userId;
    return principal.role === 'ADMIN' || principal.role === 'SUPER_ADMIN';
}

export function marketplaceOrderChatEnabled(lines: Array<{ customFields?: unknown }>) {
    return lines.some(line => {
        const customFields = line.customFields as Record<string, unknown> | undefined;
        return Boolean(
            String(customFields?.marketplaceQuoteId ?? '').trim()
            || String(customFields?.marketplaceBookingId ?? '').trim()
            || String(customFields?.marketplaceRenewalBookingId ?? '').trim(),
        );
    });
}

export function calculateMarketplaceChatReceiptTotals(input: {
    itemsBeforeDiscount: number;
    productSubtotal: number;
    shipping: number;
    rewardCoins: number;
    rewardFunding: number;
    couponDiscount?: number;
}) {
    const couponDiscount = input.couponDiscount ?? 0;
    const amounts = Object.entries({ ...input, couponDiscount }).filter(([key]) => key !== 'rewardCoins');
    for (const [label, value] of amounts) {
        if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
    }
    if (!Number.isInteger(input.rewardCoins) || input.rewardCoins < 0) {
        throw new Error('rewardCoins must be a non-negative integer');
    }
    if (input.productSubtotal > input.itemsBeforeDiscount) {
        throw new Error('Product subtotal cannot exceed the pre-discount item value');
    }
    if (input.rewardFunding > input.productSubtotal) {
        throw new Error('Reward funding cannot exceed the product subtotal');
    }
    if (couponDiscount + input.rewardFunding > input.productSubtotal) {
        throw new Error('Combined coupon and reward funding cannot exceed the product subtotal');
    }
    const discount = input.itemsBeforeDiscount - input.productSubtotal;
    const customerFundedProductAmount = input.productSubtotal - input.rewardFunding - couponDiscount;
    return {
        discount,
        customerFundedProductAmount,
        orderTotal: input.productSubtotal + input.shipping,
        customerPaidTotal: customerFundedProductAmount + input.shipping,
    };
}

type StoredMarketplaceChatOrderReceipt = Partial<MarketplaceChatOrderReceipt>;
type StoredMarketplaceChatOrderReceiptLine = Partial<MarketplaceChatOrderReceiptLine>;

function nonNegativeInteger(value: unknown, fallback = 0) {
    const amount = Number(value ?? fallback);
    return Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : Math.max(0, Math.trunc(fallback));
}

function nonNegativeMoney(value: unknown, fallback = 0) {
    return nonNegativeInteger(value, fallback);
}

function normalizeMarketplaceChatOrderReceiptLine(
    line: StoredMarketplaceChatOrderReceiptLine,
): MarketplaceChatOrderReceiptLine {
    return {
        orderLineId: line.orderLineId ?? '',
        productName: line.productName ?? '',
        variantName: line.variantName ?? '',
        sku: line.sku ?? '',
        quantity: nonNegativeInteger(line.quantity),
        unitPrice: nonNegativeMoney(line.unitPrice),
        lineTotal: nonNegativeMoney(line.lineTotal),
    };
}

export function normalizeMarketplaceChatOrderReceipt(
    receipt?: StoredMarketplaceChatOrderReceipt | null,
): MarketplaceChatOrderReceipt | undefined {
    if (!receipt) return undefined;

    const itemsBeforeDiscount = nonNegativeMoney(receipt.itemsBeforeDiscount);
    const discount = nonNegativeMoney(receipt.discount);
    const productSubtotal = nonNegativeMoney(receipt.productSubtotal, itemsBeforeDiscount - discount);
    const rewardCoins = nonNegativeInteger(receipt.rewardCoins);
    const rewardFunding = nonNegativeMoney(receipt.rewardFunding);
    const couponDiscount = nonNegativeMoney(receipt.couponDiscount);
    const shipping = nonNegativeMoney(receipt.shipping);
    const taxIncluded = nonNegativeMoney(receipt.taxIncluded);
    const orderTotal = nonNegativeMoney(receipt.orderTotal, productSubtotal + shipping);
    const customerFundedProductAmount = nonNegativeMoney(
        receipt.customerFundedProductAmount,
        productSubtotal - rewardFunding - couponDiscount,
    );
    const customerPaidTotal = nonNegativeMoney(receipt.customerPaidTotal, customerFundedProductAmount + shipping);

    return {
        sellerOrderCode: receipt.sellerOrderCode ?? '',
        customerOrderCode: receipt.customerOrderCode ?? '',
        currencyCode: receipt.currencyCode ?? '',
        lines: (receipt.lines ?? []).map(normalizeMarketplaceChatOrderReceiptLine),
        itemsBeforeDiscount,
        discount,
        productSubtotal,
        rewardCoins,
        rewardFunding,
        couponCode: receipt.couponCode ?? undefined,
        couponDiscount,
        couponFundingSource: receipt.couponFundingSource ?? undefined,
        customerFundedProductAmount,
        shipping,
        taxIncluded,
        orderTotal,
        customerPaidTotal,
        placedAt: receipt.placedAt ?? new Date(0).toISOString(),
    };
}
