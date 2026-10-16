export type MarketplaceFieldType = 'TEXT' | 'TEXTAREA' | 'NUMBER' | 'SELECT' | 'BOOLEAN' | 'DATETIME';

export interface MarketplaceProductFieldDefinition {
    key: string;
    label: string;
    type: MarketplaceFieldType;
    required: boolean;
    placeholder?: string;
    unit?: string;
    options?: string[];
}

export interface MarketplaceProductCategoryDefinition {
    code: string;
    name: string;
    productType: string;
    description: string;
    fields: MarketplaceProductFieldDefinition[];
}

export const marketplaceProductCategories: MarketplaceProductCategoryDefinition[] = [
    {
        code: 'artisan-handmade',
        name: 'Artisan & handmade',
        productType: 'PHYSICAL',
        description: 'Handmade goods, art, stationery, gifts, and locally produced items.',
        fields: [
            { key: 'material', label: 'Primary material', type: 'TEXT', required: true, placeholder: 'Ceramic, wood, paper' },
            { key: 'dimensions', label: 'Dimensions', type: 'TEXT', required: true, placeholder: 'Height x width x depth' },
            { key: 'careInstructions', label: 'Care instructions', type: 'TEXTAREA', required: false },
            { key: 'productionTimeDays', label: 'Production time', type: 'NUMBER', required: true, unit: 'days' },
        ],
    },
    {
        code: 'fashion',
        name: 'Fashion',
        productType: 'PHYSICAL',
        description: 'Clothing, footwear, bags, jewelry, and wearable accessories.',
        fields: [
            { key: 'material', label: 'Material and composition', type: 'TEXT', required: true },
            { key: 'gender', label: 'Collection', type: 'SELECT', required: true, options: ['Women', 'Men', 'Unisex', 'Kids'] },
            { key: 'careInstructions', label: 'Care instructions', type: 'TEXTAREA', required: true },
            { key: 'madeToOrder', label: 'Made to order', type: 'BOOLEAN', required: false },
        ],
    },
    {
        code: 'beauty-wellness',
        name: 'Beauty & wellness',
        productType: 'PHYSICAL',
        description: 'Skincare, personal care, wellness, and beauty products.',
        fields: [
            { key: 'ingredients', label: 'Ingredients', type: 'TEXTAREA', required: true },
            { key: 'skinType', label: 'Suitable for', type: 'SELECT', required: true, options: ['All skin types', 'Dry', 'Oily', 'Combination', 'Sensitive'] },
            { key: 'volume', label: 'Volume or net weight', type: 'TEXT', required: true, placeholder: '100 ml' },
            { key: 'expiryMonths', label: 'Shelf life', type: 'NUMBER', required: true, unit: 'months' },
            { key: 'usageInstructions', label: 'Usage instructions', type: 'TEXTAREA', required: true },
        ],
    },
    {
        code: 'home-decor',
        name: 'Home & decor',
        productType: 'PHYSICAL',
        description: 'Furniture, homeware, planters, textiles, lighting, and decor.',
        fields: [
            { key: 'material', label: 'Primary material', type: 'TEXT', required: true },
            { key: 'dimensions', label: 'Dimensions', type: 'TEXT', required: true },
            { key: 'room', label: 'Best suited for', type: 'SELECT', required: false, options: ['Living room', 'Bedroom', 'Kitchen', 'Bathroom', 'Outdoor', 'Office'] },
            { key: 'careInstructions', label: 'Care instructions', type: 'TEXTAREA', required: false },
        ],
    },
    {
        code: 'food-bakery',
        name: 'Food & bakery',
        productType: 'PERISHABLE',
        description: 'Prepared food, baked goods, pantry products, and celebration boxes.',
        fields: [
            { key: 'ingredients', label: 'Ingredients', type: 'TEXTAREA', required: true },
            { key: 'allergens', label: 'Allergen information', type: 'TEXTAREA', required: true, placeholder: 'Contains nuts, dairy, gluten' },
            { key: 'netWeight', label: 'Net weight or serving size', type: 'TEXT', required: true, placeholder: '500 g or serves 6' },
            { key: 'shelfLifeDays', label: 'Shelf life', type: 'NUMBER', required: true, unit: 'days' },
            { key: 'storageInstructions', label: 'Storage instructions', type: 'TEXTAREA', required: true },
            { key: 'preparationTimeMinutes', label: 'Preparation lead time', type: 'NUMBER', required: true, unit: 'minutes' },
        ],
    },
    {
        code: 'digital-products',
        name: 'Digital products',
        productType: 'DIGITAL',
        description: 'Templates, files, guides, media, licenses, and downloadable products.',
        fields: [
            { key: 'fileFormat', label: 'File format', type: 'TEXT', required: true, placeholder: 'PDF, ZIP, PSD' },
            { key: 'deliveryMethod', label: 'Delivery method', type: 'SELECT', required: true, options: ['Instant download', 'Email delivery', 'Vendor fulfilled'] },
            { key: 'licenseType', label: 'License', type: 'SELECT', required: true, options: ['Personal use', 'Commercial use', 'Extended commercial'] },
            { key: 'downloadLimit', label: 'Download limit', type: 'NUMBER', required: true, unit: 'downloads' },
            { key: 'fileSize', label: 'Approximate file size', type: 'TEXT', required: false, placeholder: '25 MB' },
        ],
    },
    {
        code: 'services',
        name: 'Services',
        productType: 'SERVICE',
        description: 'Professional, creative, home, business, and personal services.',
        fields: [
            { key: 'durationMinutes', label: 'Session duration', type: 'NUMBER', required: true, unit: 'minutes' },
            { key: 'deliveryMode', label: 'Delivery mode', type: 'SELECT', required: true, options: ['Online', 'At vendor location', 'At customer location', 'Hybrid'] },
            { key: 'serviceArea', label: 'Service area', type: 'TEXT', required: true, placeholder: 'Online or city names' },
            { key: 'leadTimeDays', label: 'Booking notice', type: 'NUMBER', required: true, unit: 'days' },
            { key: 'inclusions', label: 'What is included', type: 'TEXTAREA', required: true },
        ],
    },
    {
        code: 'workshops-events',
        name: 'Workshops & events',
        productType: 'WORKSHOP',
        description: 'Scheduled workshops, classes, events, experiences, and tickets.',
        fields: [
            { key: 'startsAt', label: 'Starts at', type: 'DATETIME', required: true },
            { key: 'endsAt', label: 'Ends at', type: 'DATETIME', required: true },
            { key: 'venue', label: 'Venue or meeting link', type: 'TEXT', required: true },
            { key: 'capacity', label: 'Total capacity', type: 'NUMBER', required: true, unit: 'people' },
            { key: 'ageRestriction', label: 'Age restriction', type: 'TEXT', required: false, placeholder: 'All ages or 18+' },
            { key: 'inclusions', label: 'What is included', type: 'TEXTAREA', required: true },
        ],
    },
];

export function getMarketplaceProductCategory(code: string) {
    return marketplaceProductCategories.find(category => category.code === code);
}
