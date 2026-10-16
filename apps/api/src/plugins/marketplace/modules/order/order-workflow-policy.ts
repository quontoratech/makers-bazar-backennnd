export type MarketplaceOrderFulfillmentType =
    | 'PHYSICAL'
    | 'FOOD'
    | 'DIGITAL'
    | 'SERVICE'
    | 'WORKSHOP'
    | 'EVENT'
    | 'MIXED';

const documentStatuses = new Set([
    'CONFIRMED',
    'PROCESSING',
    'PACKED',
    'PARTIALLY_FULFILLED',
    'OUT_OF_STOCK_EXCEPTION',
    'DISPATCHED',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'FULFILLED',
]);

const physicalStatuses: Record<string, string[]> = {
    PENDING: ['CONFIRMED', 'REJECTED', 'OUT_OF_STOCK_EXCEPTION', 'CANCELLED'],
    CONFIRMED: ['PROCESSING', 'PACKED', 'PARTIALLY_FULFILLED', 'OUT_OF_STOCK_EXCEPTION', 'CANCELLED'],
    PROCESSING: ['PACKED', 'PARTIALLY_FULFILLED', 'OUT_OF_STOCK_EXCEPTION', 'CANCELLED'],
    PACKED: ['DISPATCHED', 'PARTIALLY_FULFILLED', 'OUT_OF_STOCK_EXCEPTION', 'CANCELLED'],
    PARTIALLY_FULFILLED: ['PROCESSING', 'PACKED', 'DISPATCHED', 'DELIVERED', 'FULFILLED', 'CANCELLED'],
    OUT_OF_STOCK_EXCEPTION: ['PARTIALLY_FULFILLED', 'PROCESSING', 'CANCELLED'],
    DISPATCHED: ['OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED'],
    OUT_FOR_DELIVERY: ['DELIVERY_FAILED', 'DELIVERED'],
    DELIVERY_FAILED: ['OUT_FOR_DELIVERY', 'CANCELLED', 'RETURN_REQUESTED'],
    DELIVERED: ['FULFILLED', 'RETURN_REQUESTED'],
    FULFILLED: ['RETURN_REQUESTED', 'RETURNED', 'REFUNDED'],
    RETURN_REQUESTED: ['RETURN_APPROVED', 'RETURN_REJECTED'],
    RETURN_APPROVED: ['RETURNED', 'REFUNDED'],
    RETURN_REJECTED: ['FULFILLED'],
    RETURNED: ['REFUNDED'],
};

const nonShippingStatuses: Record<string, string[]> = {
    PENDING: ['CONFIRMED', 'REJECTED', 'CANCELLED'],
    CONFIRMED: ['PROCESSING', 'FULFILLED', 'CANCELLED'],
    PROCESSING: ['FULFILLED', 'CANCELLED'],
    // These paths let older orders leave physical-only states cleanly.
    PACKED: ['FULFILLED', 'CANCELLED'],
    PARTIALLY_FULFILLED: ['PROCESSING', 'FULFILLED', 'CANCELLED'],
    OUT_OF_STOCK_EXCEPTION: ['PROCESSING', 'FULFILLED', 'CANCELLED'],
    DISPATCHED: ['FULFILLED', 'CANCELLED'],
    OUT_FOR_DELIVERY: ['FULFILLED', 'CANCELLED'],
    DELIVERY_FAILED: ['PROCESSING', 'FULFILLED', 'CANCELLED'],
    DELIVERED: ['FULFILLED'],
    FULFILLED: ['RETURN_REQUESTED'],
    RETURN_REQUESTED: ['RETURN_APPROVED', 'RETURN_REJECTED'],
    RETURN_APPROVED: ['REFUNDED'],
    RETURN_REJECTED: ['FULFILLED'],
};

const digitalStatuses: Record<string, string[]> = {
    ...nonShippingStatuses,
    PENDING: ['CONFIRMED', 'FULFILLED', 'REJECTED', 'CANCELLED'],
};

const labels: Partial<Record<MarketplaceOrderFulfillmentType, Record<string, string>>> = {
    FOOD: {
        PENDING: 'New food order',
        CONFIRMED: 'Order confirmed',
        PROCESSING: 'Preparing',
        PACKED: 'Ready for dispatch',
        PARTIALLY_FULFILLED: 'Partially available',
        FULFILLED: 'Completed',
    },
    DIGITAL: {
        PENDING: 'New digital order',
        CONFIRMED: 'Order confirmed',
        REJECTED: 'Order declined',
        PROCESSING: 'Preparing access',
        PACKED: 'Access ready',
        FULFILLED: 'Ebook delivered',
        CANCELLED: 'Order cancelled',
    },
    SERVICE: {
        PENDING: 'New service order',
        CONFIRMED: 'Service confirmed',
        REJECTED: 'Service declined',
        PROCESSING: 'Service in progress',
        PACKED: 'Ready for service',
        FULFILLED: 'Service completed',
        CANCELLED: 'Service cancelled',
    },
    WORKSHOP: {
        PENDING: 'New class booking',
        CONFIRMED: 'Booking confirmed',
        REJECTED: 'Booking declined',
        PROCESSING: 'Session scheduled',
        PACKED: 'Ready to begin',
        FULFILLED: 'Class completed',
        CANCELLED: 'Booking cancelled',
    },
    EVENT: {
        PENDING: 'New event booking',
        CONFIRMED: 'Booking confirmed',
        REJECTED: 'Booking declined',
        PROCESSING: 'Event scheduled',
        PACKED: 'Event ready',
        FULFILLED: 'Event completed',
        CANCELLED: 'Booking cancelled',
    },
};

const shippingStatusMessages: Record<string, string> = {
    PENDING: 'Your order has been received and is waiting for the vendor to confirm it.',
    CONFIRMED: 'The vendor has confirmed your order.',
    REJECTED: 'The vendor could not accept your order.',
    PROCESSING: 'Your parcel is under processing and is being prepared by the vendor.',
    PACKED: 'Your parcel has been packed and is ready for dispatch.',
    PARTIALLY_FULFILLED: 'The vendor can fulfil part of your order and has shared the details.',
    OUT_OF_STOCK_EXCEPTION: 'Some items are unavailable. The vendor has shared the details.',
    DISPATCHED: 'Your parcel has been dispatched and is on its way to you.',
    OUT_FOR_DELIVERY: 'Your parcel is out for delivery and should reach you soon.',
    DELIVERY_FAILED: 'The delivery attempt was unsuccessful. The vendor will arrange the next step.',
    DELIVERED: 'Your parcel has been delivered.',
    FULFILLED: 'Your order has been fulfilled.',
    CANCELLED: 'Your order has been cancelled.',
    RETURN_REQUESTED: 'A return has been requested for your order.',
    RETURN_APPROVED: 'Your return request has been approved.',
    RETURN_REJECTED: 'Your return request was not approved.',
    RETURNED: 'Your returned parcel has been received.',
    REFUNDED: 'Your product refund has been approved. Finance will update you after the customer transfer is completed.',
};

export function resolveMarketplaceOrderFulfillmentType(productTypes: unknown[]): MarketplaceOrderFulfillmentType {
    const normalized = new Set(productTypes
        .map(value => String(value ?? '').trim().toUpperCase())
        .filter(Boolean)
        .map(value => value === 'PERISHABLE' ? 'FOOD' : value === 'WORKSHOP_EXPERIENCE' ? 'WORKSHOP' : value));
    if (!normalized.size) return 'PHYSICAL';
    if (normalized.size > 1) return 'MIXED';
    const value = [...normalized][0] ?? 'PHYSICAL';
    return ['PHYSICAL', 'FOOD', 'DIGITAL', 'SERVICE', 'WORKSHOP', 'EVENT'].includes(value)
        ? value as MarketplaceOrderFulfillmentType
        : 'PHYSICAL';
}

export function marketplaceOrderUsesShipping(type: MarketplaceOrderFulfillmentType) {
    return ['PHYSICAL', 'FOOD', 'MIXED'].includes(type);
}

export function marketplaceOrderAvailableStatuses(status: string, type: MarketplaceOrderFulfillmentType) {
    const workflow = type === 'DIGITAL'
        ? digitalStatuses
        : marketplaceOrderUsesShipping(type) ? physicalStatuses : nonShippingStatuses;
    return [...(workflow[status] ?? [])];
}

export function marketplaceOrderPrintableDocuments(status: string, type: MarketplaceOrderFulfillmentType) {
    if (!documentStatuses.has(status)) return [];
    return marketplaceOrderUsesShipping(type) ? ['invoice', 'packing-slip'] : ['invoice'];
}

export function marketplaceOrderStatusLabel(status: string, type: MarketplaceOrderFulfillmentType) {
    const configured = labels[type]?.[status];
    if (configured) return configured;
    const label = status.toLowerCase().replace(/_/g, ' ');
    return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function marketplaceOrderStatusMessage(status: string, type: MarketplaceOrderFulfillmentType) {
    if (marketplaceOrderUsesShipping(type) && shippingStatusMessages[status]) {
        return shippingStatusMessages[status];
    }
    const subject = type === 'EVENT'
        ? 'event booking'
        : type === 'WORKSHOP'
            ? 'class booking'
            : type === 'SERVICE'
                ? 'service order'
                : type === 'DIGITAL'
                    ? 'digital order'
                    : 'order';
    if (status === 'PENDING') return `Your ${subject} has been received and is waiting for vendor confirmation.`;
    if (status === 'CONFIRMED') return `The vendor has confirmed your ${subject}.`;
    if (status === 'REJECTED') return `The vendor could not accept your ${subject}.`;
    if (status === 'CANCELLED') return `Your ${subject} has been cancelled.`;
    if (status === 'FULFILLED') {
        if (type === 'DIGITAL') return 'Your ebook is ready. Sign in to your customer orders to download it securely.';
        if (type === 'SERVICE') return 'Your service has been completed.';
        if (type === 'WORKSHOP') return 'Your class has been completed.';
        if (type === 'EVENT') return 'Your event has been completed.';
        return 'Your order has been fulfilled.';
    }
    return `Your ${subject} is now ${marketplaceOrderStatusLabel(status, type).toLowerCase()}.`;
}
