export const MARKETPLACE_SHIPPING_CALCULATOR_CODE = 'marketplace-vendor-shipping-calculator';

export const marketplaceShippingModes = ['FREE', 'FLAT_RATE', 'ZONE_BASED'] as const;

export type MarketplaceShippingMode = typeof marketplaceShippingModes[number];

export const DEFAULT_MARKETPLACE_SHIPPING_RATE = 35_000;
