export type MarketplaceVendorServiceAreaScope = 'COUNTRY' | 'PROVINCE' | 'CITY' | 'AREA';

export interface MarketplaceVendorServiceArea {
    id: string;
    scope: MarketplaceVendorServiceAreaScope;
    countryCode: string;
    province?: string;
    city?: string;
    areas: string[];
}

export interface MarketplaceDiscoveryLocation {
    countryCode?: string;
    province?: string;
    city?: string;
    area?: string;
}

interface VendorLocationSource {
    serviceAreas?: MarketplaceVendorServiceArea[];
    operatingLocations?: string[];
}

function normalize(value: unknown) {
    return typeof value === 'string'
        ? value.trim().toLocaleLowerCase('en').replace(/\s+/g, ' ')
        : '';
}

export function vendorServesLocation(vendor: VendorLocationSource, location?: MarketplaceDiscoveryLocation) {
    const countryCode = normalize(location?.countryCode);
    const province = normalize(location?.province);
    const city = normalize(location?.city);
    const localArea = normalize(location?.area);
    if (!countryCode && !province && !city && !localArea) return true;

    const serviceAreas = vendor.serviceAreas ?? [];
    if (serviceAreas.length) {
        return serviceAreas.some(serviceArea => {
            if (countryCode && normalize(serviceArea.countryCode) !== countryCode) return false;
            if (!province && !city && !localArea) return true;
            if (serviceArea.scope === 'COUNTRY') return true;
            if (province && normalize(serviceArea.province) !== province) return false;
            if (!city && !localArea) return true;
            if (serviceArea.scope === 'PROVINCE') return true;
            if (city && normalize(serviceArea.city) !== city) return false;
            if (!localArea || serviceArea.scope === 'CITY') return true;
            return serviceArea.areas.some(area => {
                const normalizedArea = normalize(area);
                return normalizedArea === localArea
                    || normalizedArea.includes(localArea)
                    || localArea.includes(normalizedArea);
            });
        });
    }

    const legacyLocations = (vendor.operatingLocations ?? []).map(normalize).filter(Boolean);
    if (!legacyLocations.length) return countryCode === '' || countryCode === 'pk';
    const searchParts = [localArea, city, province].filter(Boolean);
    if (!searchParts.length) return true;
    return legacyLocations.some(legacy => searchParts.some(part => legacy.includes(part) || part.includes(legacy)));
}

export function vendorPrimaryLocation(vendor: VendorLocationSource) {
    const serviceArea = vendor.serviceAreas?.[0];
    if (serviceArea) {
        if (serviceArea.scope === 'COUNTRY') return serviceArea.countryCode === 'PK' ? 'Pakistan' : serviceArea.countryCode;
        if (serviceArea.scope === 'PROVINCE') return serviceArea.province ?? 'Pakistan';
        if (serviceArea.scope === 'AREA' && serviceArea.areas[0]) return `${serviceArea.areas[0]}, ${serviceArea.city}`;
        return serviceArea.city ?? serviceArea.province ?? 'Pakistan';
    }
    return vendor.operatingLocations?.[0] ?? 'Pakistan';
}
