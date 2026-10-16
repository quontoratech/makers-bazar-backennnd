export interface MarketplaceListOptions {
    skip?: number;
    take?: number;
}

export interface MarketplaceList<T> {
    items: T[];
    totalItems: number;
}

export function normalizeListOptions(options?: MarketplaceListOptions) {
    return {
        skip: Math.max(0, options?.skip ?? 0),
        take: Math.min(100, Math.max(1, options?.take ?? 20)),
    };
}
