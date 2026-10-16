export interface MarketplaceProductOptionGroupInput {
    id?: string;
    name: string;
    values: string[];
}

export interface MarketplaceProductVariantInput {
    id?: string;
    sku: string;
    price: number;
    compareAtPrice?: number;
    imageAssetId?: string;
    stockOnHand: number;
    optionValues?: Record<string, string>;
    barcode?: string;
    weightGrams?: number;
    lowStockThreshold?: number;
    allowBackorders?: boolean;
    backorderLimit?: number;
    maxOrderQuantity?: number;
    availabilityEndsAt?: string;
}

export interface MarketplaceInventoryUpdateInput {
    variantId: string;
    stockOnHand: number;
    lowStockThreshold: number;
    allowBackorders: boolean;
    backorderLimit: number;
    maxOrderQuantity: number;
}

export interface MarketplaceServicePackageInput {
    kind?: 'PACKAGE' | 'ADD_ON';
    name: string;
    description?: string;
    inclusions?: string[];
    price: number;
    durationMinutes?: number;
}

export interface MarketplaceAvailabilitySessionInput {
    id?: string;
    startsAt: string;
    endsAt: string;
    name?: string;
    scheduleType?: 'ONE_TIME' | 'SUBSCRIPTION_CLASS';
    daysOfWeek?: string[];
    startTime?: string;
    endTime?: string;
    price?: number;
    oneDayPrice?: number;
    earlyBirdPrice?: number;
    earlyBirdEndsAt?: string;
    gracePeriodDays?: number;
    isActive?: boolean;
    capacity: number;
    bookingDeadline?: string;
    recurrenceGroupId?: string;
}

export interface MarketplaceEventTicketTypeInput {
    name: string;
    price: number;
    quantity: number;
    saleStartsAt?: string;
    saleEndsAt?: string;
    rules?: Record<string, unknown>;
}

export interface MarketplaceEventScheduleItemInput {
    name: string;
    startsAt: string;
    endsAt: string;
    personName?: string;
    location?: string;
    description?: string;
}

export interface MarketplaceDigitalFileInput {
    kind?: 'MAIN' | 'PREVIEW' | 'LICENSE_DOCUMENT';
    fileName: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    checksum?: string;
    isPrivate?: boolean;
    downloadLimit?: number;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
}

export interface CreateMarketplaceProductInput {
    name: string;
    slug?: string;
    description: string;
    categoryId?: string;
    categoryCode?: string;
    secondaryCategoryIds?: string[];
    brand?: string;
    tags?: string[];
    attributes?: Record<string, unknown>;
    stylingVideoUrl?: string;
    deliveryInformation?: string;
    shippingProfileId?: string;
    returnPolicy?: string;
    disclaimer?: string;
    seoTitle?: string;
    seoDescription?: string;
    assetIds?: string[];
    featuredAssetId?: string;
    optionGroups?: MarketplaceProductOptionGroupInput[];
    variants: MarketplaceProductVariantInput[];
    servicePackages?: MarketplaceServicePackageInput[];
    serviceAddOns?: MarketplaceServicePackageInput[];
    availabilitySessions?: MarketplaceAvailabilitySessionInput[];
    eventTicketTypes?: MarketplaceEventTicketTypeInput[];
    eventScheduleItems?: MarketplaceEventScheduleItemInput[];
    digitalFiles?: MarketplaceDigitalFileInput[];
}

export interface UpdateMarketplaceProductInput extends CreateMarketplaceProductInput {
    id: string;
}

export interface CreateMarketplaceCategoryInput {
    name: string;
    slug?: string;
    parentId?: string;
    description?: string;
    icon?: string;
    imageAssetId?: string;
    sortOrder?: number;
    isActive?: boolean;
    chatEnabled?: boolean;
    formTemplateId?: string;
}

export interface UpdateMarketplaceCategoryInput extends Partial<CreateMarketplaceCategoryInput> {
    id: string;
    inheritFormTemplate?: boolean;
}

export interface UpsertMarketplaceCategoryFieldInput {
    id?: string;
    categoryId: string;
    fieldKey: string;
    label: string;
    inputType: string;
    required?: boolean;
    section?: string;
    helpText?: string;
    placeholder?: string;
    unit?: string;
    options?: string[];
    validation?: Record<string, unknown>;
    ui?: Record<string, unknown>;
    condition?: Record<string, unknown>;
    sortOrder?: number;
    isActive?: boolean;
    overrideMode?: 'REPLACE' | 'HIDE';
}

export interface UpdateMarketplaceFormTemplateInput {
    id: string;
    name?: string;
    isActive?: boolean;
    schema?: Array<Record<string, unknown>>;
}

export interface CreateMarketplaceFormTemplateInput {
    key: string;
    name: string;
    listingType: 'PHYSICAL_PRODUCT' | 'ARTISAN_PRODUCT' | 'FOOD_PRODUCT' | 'DIGITAL_PRODUCT' | 'SERVICE' | 'WORKSHOP_EXPERIENCE' | 'EVENT';
    schema: Array<Record<string, unknown>>;
    isActive?: boolean;
}
