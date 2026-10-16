export type MarketplaceWishlistVisibility = 'PUBLIC' | 'PRIVATE';
export type MarketplaceWishlistItemType = 'PRODUCT' | 'SERVICE' | 'WORKSHOP' | 'VENDOR';

export interface CreateMarketplaceWishlistInput {
    name: string;
    description?: string | null;
}

export interface UpdateMarketplaceWishlistInput {
    id: string;
    name?: string;
    description?: string | null;
}

export interface AddMarketplaceWishlistItemInput {
    wishlistId: string;
    itemType: MarketplaceWishlistItemType;
    referenceId: string;
}
