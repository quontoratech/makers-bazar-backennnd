import { MarketplaceListingType } from './entities/marketplace-form-template.entity';

export function vendorAllowedListingTypes(categories: string[] | undefined) {
    const selected = (categories ?? []).map(value => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    if (!selected.length) return null;
    const allowed = new Set<MarketplaceListingType>();
    for (const value of selected) {
        if (['physical product', 'physical products', 'fashion', 'beauty wellness', 'home decor'].includes(value)) {
            allowed.add('PHYSICAL_PRODUCT');
        }
        if (['artisan product', 'artisan products'].includes(value)) allowed.add('ARTISAN_PRODUCT');
        if (['food bakery', 'food'].includes(value)) allowed.add('FOOD_PRODUCT');
        if (value === 'digital products') allowed.add('DIGITAL_PRODUCT');
        if (value === 'services') allowed.add('SERVICE');
        if (['workshops', 'experiences', 'classes'].includes(value)) allowed.add('WORKSHOP_EXPERIENCE');
        if (['events tickets', 'events', 'community gatherings', 'corporate bookings'].includes(value)) allowed.add('EVENT');
    }
    return allowed.size ? allowed : null;
}

export function canonicalVendorCategory(listingType: MarketplaceListingType) {
    const labels: Record<MarketplaceListingType, string> = {
        PHYSICAL_PRODUCT: 'Physical products',
        ARTISAN_PRODUCT: 'Artisan products',
        FOOD_PRODUCT: 'Food & bakery',
        DIGITAL_PRODUCT: 'Digital products',
        SERVICE: 'Services',
        WORKSHOP_EXPERIENCE: 'Workshops',
        EVENT: 'Events & tickets',
    };
    return labels[listingType];
}
