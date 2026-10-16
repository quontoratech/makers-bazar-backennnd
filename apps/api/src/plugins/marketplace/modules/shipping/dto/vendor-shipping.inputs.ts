import { MarketplaceShippingMode } from '../shipping.constants';

export interface MarketplaceShippingZoneInput {
    id?: string;
    name: string;
    cities?: string[];
    provinces?: string[];
    postalCodes?: string[];
    rate: number;
    minDeliveryDays: number;
    maxDeliveryDays: number;
    enabled?: boolean;
}

export interface MarketplaceDeliveryProfileInput {
    id?: string;
    name: string;
    description?: string;
    enabled?: boolean;
    mode: MarketplaceShippingMode;
    flatRate: number;
    fallbackEnabled?: boolean;
    fallbackRate: number;
    processingDays: number;
    defaultMinDeliveryDays: number;
    defaultMaxDeliveryDays: number;
    zones?: MarketplaceShippingZoneInput[];
}

export interface UpdateMarketplaceShippingProfileInput {
    defaultProfileId: string;
    deliveryProfiles: MarketplaceDeliveryProfileInput[];
}

export interface MarketplaceShippingDestinationInput {
    city: string;
    province?: string;
    postalCode?: string;
}

export interface MarketplaceShippingQuoteItemInput {
    variantId: string;
    quantity: number;
}
