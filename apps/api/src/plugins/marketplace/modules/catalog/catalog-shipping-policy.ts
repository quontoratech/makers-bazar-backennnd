const SHIPPING_LISTING_TYPES = new Set(['PHYSICAL_PRODUCT', 'ARTISAN_PRODUCT', 'FOOD_PRODUCT']);
const SHIPPING_PRODUCT_TYPES = new Set(['PHYSICAL', 'PERISHABLE']);

export function marketplaceListingRequiresShipping(listingType: unknown, marketplaceType: unknown) {
    const normalizedListingType = String(listingType ?? '').trim().toUpperCase();
    if (normalizedListingType) return SHIPPING_LISTING_TYPES.has(normalizedListingType);
    return SHIPPING_PRODUCT_TYPES.has(String(marketplaceType ?? '').trim().toUpperCase());
}
