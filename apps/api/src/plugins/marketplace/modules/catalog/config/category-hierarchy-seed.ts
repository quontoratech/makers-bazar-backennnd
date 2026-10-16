import { MarketplaceDynamicFieldDefinition } from '../entities/marketplace-form-template.entity';

export interface MarketplaceCategorySeedNode {
    name: string;
    description?: string;
    templateKey?: string;
    chatEnabled?: boolean;
    legacyCode?: string;
    children?: MarketplaceCategorySeedNode[];
}

const n = (
    name: string,
    children: MarketplaceCategorySeedNode[] = [],
    templateKey?: string,
    description?: string,
    chatEnabled = false,
    legacyCode?: string,
): MarketplaceCategorySeedNode => ({ name, children, templateKey, description, chatEnabled, legacyCode });

const leaves = (...names: string[]) => names.map(name => n(name));
const eventInquiryLeaf = (name: string) => n(
    name,
    [],
    'service',
    'Customized event planning and decoration. Customers share requirements, chat with the vendor, and receive a personalized quotation.',
    true,
);
const digitalProjectLeaf = (name: string, legacyCode?: string) => n(
    name,
    [],
    'custom_digital_project',
    'Made-to-order digital design. Customers submit a creative brief, discuss progress, and pay through a personalized quotation.',
    true,
    legacyCode,
);

export function marketplaceCategorySlug(name: string) {
    return name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export const marketplaceCategoryHierarchy: MarketplaceCategorySeedNode[] = [
    n('Jewelry & Accessories', leaves(
        'Earrings', 'Necklaces', 'Bracelets', 'Rings', 'Anklets', 'Brooches & Pins', 'Charms', 'Cufflinks',
        'Jewelry Sets', 'Bridal Jewelry', 'Customized Jewelry', 'Jewelry Storage', 'Hair Accessories', 'Hats & Caps',
        'Headbands', 'Scarves & Wraps', 'Watches', 'Sunglasses & Eyewear', 'Belts', 'Phone Accessories',
        'Gloves & Mittens', 'Keychains',
    ), 'physical_product', 'Jewelry, watches, eyewear, and wearable accessories.'),
    n('Clothing & Shoes', [
        n("Women's Fashion", leaves(
            'Eastern Wear', 'Western Wear', 'Modest Wear', 'Luxury Pret', 'Casual Wear', 'Formal Wear',
            'Evening Wear', 'Co-ord Sets', 'Abayas', 'Kaftans', 'Shawls & Dupattas', 'Sleepwear', 'Activewear', 'Maternity Wear',
        )),
        n("Men's Fashion", leaves('Eastern Wear', 'Casual Wear', 'Formal Wear', 'Smart Casual', 'Outerwear', 'Activewear', 'Sleepwear', 'Accessories')),
        n('Kids Fashion', leaves('Baby Clothing', 'Boys', 'Girls', 'Matching Family Outfits')),
        n('Shoes', [
            n('Women', leaves('Heels', 'Flats', 'Sandals', 'Sneakers', 'Boots')),
            n('Men', leaves('Sneakers', 'Loafers', 'Formal Shoes', 'Sandals', 'Boots')),
            n('Kids', leaves('Casual', 'School', 'Party Shoes')),
        ]),
    ], 'physical_product', 'Apparel, footwear, and fashion collections.'),
    n('Bags & Purses', [
        ...leaves('Handbags', 'Tote Bags', 'Crossbody Bags', 'Shoulder Bags', 'Clutches', 'Wallets', 'Laptop Bags', 'Travel Bags', 'Backpacks'),
        n('Handmade Leather Goods', [], 'artisan_product'),
        ...leaves('Cosmetic Bags', 'Coin Purses', 'Pouches', "Kids' Bags", 'Bag Accessories', 'Card Holders'),
    ], 'physical_product', 'Bags, wallets, pouches, and travel accessories.'),
    n('Home & Living', [
        n('Home Decor', leaves(
            'Decorative Items', 'Wall Art', 'Mirrors', 'Candles', 'Candle Holders', 'Vases', 'Planters',
            'Artificial Flowers', 'Lighting', 'Rugs & Carpets', 'Storage & Organization', 'Bathroom Decor',
            'Home Fragrance', 'Housewarming Gifts', 'Seasonal Decor',
        )),
        n('Furniture', leaves('Living Room', 'Bedroom', 'Office', 'Outdoor')),
        n('Kitchen & Dining', leaves('Dinnerware', 'Glassware', 'Kitchen Accessories', 'Storage')),
        n('Bedding', leaves('Bedsheets', 'Cushions', 'Throws', 'Blankets', 'Pillows')),
    ], 'physical_product', 'Decor, furniture, dining, bedding, and home organization.'),
    n('Food & Beverages', [
        ...leaves('Homemade Food', 'Organic Food'),
        n('Bakery', leaves('Cakes', 'Cupcakes', 'Cookies', 'Desserts', 'Brownies', 'Bread')),
        ...leaves('Chocolates', 'Snacks', 'Gourmet', 'Ice Cream', 'Charcuterie Boards', 'Pickles & Preserves',
            'Sauces & Condiments', 'Frozen Food', 'Healthy Food', 'Diet Food', 'Vegan', 'Gluten Free', 'Keto',
            'Beverages', 'Tea & Coffee', 'Food Gift Baskets'),
    ], 'food', 'Prepared food, bakery, beverages, frozen goods, and edible gifts.'),
    n('Wedding & Party', [
        ...leaves('Wedding Dresses', 'Bridal Accessories', 'Bridesmaid Dresses', 'Bridesmaid Gifts', 'Wedding Invitations', 'Wedding Signs'),
        eventInquiryLeaf('Wedding Décor'),
        ...leaves('Wedding Favors', 'Cake Toppers', 'Guest Books'),
        eventInquiryLeaf('Party Decorations'),
        eventInquiryLeaf('Birthday Decorations'),
        eventInquiryLeaf('Baby Shower'),
        eventInquiryLeaf('Bridal Shower'),
        eventInquiryLeaf('Engagement'),
        eventInquiryLeaf('Anniversary'),
        eventInquiryLeaf('Graduation'),
        ...leaves('Party Supplies', 'Invitations & Cards'),
    ], 'physical_product', 'Wedding, celebration, invitation, and party goods.'),
    n('Toys & Entertainment', leaves(
        'Toys', 'Dolls & Dollhouses', 'Stuffed Animals', 'Educational Toys', 'Wooden Toys', 'Puzzles', 'Games',
        'Board Games', 'Pretend Play', "Kids' Crafts", 'Activity Kits', 'Collectibles', 'Miniatures',
        'Music & Instruments', 'Party Games',
    ), 'physical_product', 'Toys, games, activities, collectibles, and entertainment.'),
    n('Art & Collectibles', [
        ...leaves('Original Paintings', 'Paintings', 'Prints', 'Photography'),
        n('Digital Art', [], 'digital_product'),
        ...leaves('Sculptures', 'Calligraphy', 'Drawings', 'Illustrations', 'Mixed Media', 'Textile Art', 'Fiber Art',
            'Ceramic Art', 'Pottery', 'Resin Art', 'Crochet', 'Macrame', 'Glass Art', 'Wood Art', 'Metal Art',
            'Folk Art', 'Memorabilia', 'Collectibles', 'Vintage Art', 'Art Objects', 'Handmade Crafts'),
    ], 'artisan_product', 'Original art, handmade crafts, and collectible objects.'),
    n('Craft Supplies & Tools', [
        ...leaves('Beads', 'Jewelry Making Supplies', 'Fabric', 'Yarn', 'Sewing Supplies', 'Embroidery Supplies',
            'Knitting Supplies', 'Crochet Supplies', 'Painting Supplies', 'Drawing Supplies', 'Scrapbooking',
            'Paper Crafts', 'Candle Making', 'Soap Making', 'Resin Supplies', 'Woodworking Supplies', 'Craft Kits', 'DIY Kits', 'Tools'),
        n('Patterns & Templates', [], 'digital_product'),
    ], 'physical_product', 'Materials, tools, kits, and patterns for making.'),
    n('Vintage', leaves(
        'Vintage Clothing', 'Vintage Jewelry', 'Vintage Home Décor', 'Vintage Furniture', 'Vintage Kitchen',
        'Vintage Accessories', 'Vintage Collectibles', 'Vintage Toys', 'Vintage Books', 'Vintage Photography',
        'Vintage Art', 'Vintage Wedding', 'Retro Items', 'Antiques',
    ), 'physical_product', 'Vintage, retro, and antique goods.'),
    n('Books, Stationery & Party Supplies', [
        n('Books'),
        n('E-Books', [], 'digital_product'),
        n('Children Books'),
        n('Art & Coffee Table Books'),
        n('Digital Guides', [], 'digital_product'),
        n('Workbooks'),
        n('Educational Resources'),
        ...leaves('Journals', 'Planners', 'Diaries', 'Notebooks', 'Sketchbooks', "Children's Activity Books", 'Magazines',
            'Art Supplies', 'Greeting Cards', 'Bookmarks', 'Reading Lights', 'Stickers', 'Gifting Stationery',
            'Letter Sets', 'Writing Sets', 'Desk Stationery', 'Office Supplies', 'Invitations', 'Wedding Stationery',
            'Wrapping Paper', 'Gift Bags', 'Calendars', 'Party Supplies'),
    ], 'physical_product', 'Books, stationery, paper goods, and party supplies.'),
    n('Beauty & Personal Care', leaves(
        'Skincare', 'Makeup', 'Haircare', 'Perfume & Fragrance', 'Bath & Body', 'Organic Beauty', 'Grooming',
        'Beauty Tools', 'Beauty Gift Sets', 'Soaps', 'Bath Bombs', 'Bath Salts', 'Body Scrubs', 'Spa & Wellness',
    ), 'physical_product', 'Beauty, grooming, body care, and wellness goods.'),
    n('Electronics & Accessories', leaves(
        'Phone Cases', 'Laptop Cases', 'Tablet Cases', 'AirPod Cases', 'Tech Accessories', 'Desk Accessories',
        'Cable Organizers', 'Keyboard Accessories', 'Computer Accessories', 'Gaming Accessories', 'Personalized Electronics',
    ), 'physical_product', 'Device cases, desk technology, and electronic accessories.'),
    n('Pet Supplies', [
        ...leaves('Dog Accessories', 'Cat Accessories', 'Pet Clothing', 'Pet Beds', 'Pet Toys', 'Collars & Leashes',
            'Pet Tags', 'Feeding Accessories', 'Pet Memorials', 'Personalized Pet Items'),
        n('Pet Food', [], 'food'),
        n('Grooming'),
    ], 'physical_product', 'Food, accessories, clothing, toys, and care for pets.'),
    n('Baby', leaves(
        'Baby Clothing', 'Baby Accessories', 'Baby Blankets', 'Nursery Decor', 'Baby Toys', 'Teething Toys',
        'Feeding Accessories', 'Milestone Cards', 'Baby Shower Gifts', 'Personalized Baby Gifts',
        'Pregnancy & Motherhood', 'Nursing Accessories',
    ), 'physical_product', 'Baby, nursery, pregnancy, and nursing products.'),
    n('Digital Products', [
        ...leaves(
            'Digital Planners', 'Templates', 'Presets', 'Printable Art', 'E-books', 'Courses', 'Downloads',
            'Digital Downloads', 'Planners', 'Notion Templates', 'Canva Templates', 'Social Media Templates',
            'Business Templates', 'Resume Templates', 'Invitations', 'Digital Stickers', 'Fonts', 'SVG Files',
            'Cricut Files', 'Sewing Patterns', 'Crochet Patterns', 'Coloring Pages', 'Online Resources', 'Workbooks', 'Children Learning',
        ),
        n('Custom Digital Products', [
            digitalProjectLeaf('Custom Canva Templates', 'digital-products/custom-canva-templates'),
            digitalProjectLeaf('Custom Social Media Templates', 'digital-products/custom-social-media-templates'),
            digitalProjectLeaf('Custom Business Templates', 'digital-products/custom-business-templates'),
            digitalProjectLeaf('Custom Resume Templates', 'digital-products/custom-resume-templates'),
            digitalProjectLeaf('Custom Invitations', 'digital-products/custom-invitations'),
            digitalProjectLeaf('Logo & Brand Identity', 'digital-products/custom-digital-design/logo-and-brand-identity'),
            digitalProjectLeaf('Social Media Design', 'digital-products/custom-digital-design/social-media-design'),
            digitalProjectLeaf('Invitations & Stationery', 'digital-products/custom-digital-design/invitations-and-stationery'),
            digitalProjectLeaf('Presentation Design', 'digital-products/custom-digital-design/presentation-design'),
            digitalProjectLeaf('Illustration & Digital Art', 'digital-products/custom-digital-design/illustration-and-digital-art'),
            digitalProjectLeaf('UI & UX Design', 'digital-products/custom-digital-design/ui-and-ux-design'),
            digitalProjectLeaf('Packaging Design', 'digital-products/custom-digital-design/packaging-design'),
            digitalProjectLeaf('Marketing Design', 'digital-products/custom-digital-design/marketing-design'),
            digitalProjectLeaf('Other Custom Design', 'digital-products/custom-digital-design/other-custom-design'),
        ], 'custom_digital_project', 'Made-to-order digital products with customer briefs, quotations, progress chat, and protected payment.', true, 'digital-products/custom-digital-design'),
    ], 'digital_product', 'Private downloadable files, templates, courses, and custom digital design services.'),
    n('Gifts & Hampers', [
        n('Personalized Gifts', [], 'artisan_product'),
        ...leaves('Gift Boxes', 'Corporate Gifts', 'Baby Gifts', 'Anniversary Gifts', 'Birthday Gifts', 'Wedding Gifts',
            'Eid Collections', "Mother's Day", "Father's Day", 'Gift Baskets'),
    ], 'physical_product', 'Personal, seasonal, corporate, and celebration gifts.'),
    n('Wellness', [
        n('Yoga Classes', [], 'workshop_experience'),
        n('Meditation Classes', [], 'workshop_experience'),
        n('Pilates Classes', [], 'workshop_experience'),
        ...leaves('Fitness Equipment', 'Supplements', 'Essential Oils', 'Aromatherapy', 'Self Care Kits'),
        n('Wellness Workshops', [], 'workshop_experience'),
    ], 'physical_product', 'Wellness products, classes, and workshops.'),
    n('Plants & Gardening', leaves('Indoor Plants', 'Outdoor Plants', 'Succulents', 'Pots', 'Gardening Tools', 'Plant Care'), 'physical_product', 'Plants, pots, tools, and plant care.'),
    n('Services', leaves(
        'Graphic Design', 'Photography', 'Videography', 'Content Creation', 'Branding', 'Decor', 'Catering',
        'Makeup Artists', 'Mehndi Artists', 'Nail Artist', 'Eyelash', 'Eyebrow', 'Entertainment', 'Marketing',
        'Consultancy', 'Legal', 'Accounting', 'Personal Shopping', 'Interior Design', 'Personal Styling',
    ), 'service', 'Creative, professional, personal, and business services.'),
    n('Workshops', leaves(
        'Art Workshops', 'Pottery', 'Cooking Classes', 'Baking', 'Business Training', 'Marketing', 'Fitness',
        'Yoga', 'Pilates', 'Kids Workshops', 'DIY Workshops', 'Photography',
    ), 'workshop_experience', 'Scheduled classes and participant workshops.'),
    n('Experiences', leaves(
        'Food Experiences', 'Farm Visits', 'Art Experiences', 'Wellness Retreats', 'Adventure', 'Cultural Tours',
        'Pop-up Experiences', 'Networking Events',
    ), 'workshop_experience', 'Tours, visits, retreats, and scheduled experiences.'),
    n('Events', [
        n('The Makers Bazar Events'),
        n('Workshops', [], 'workshop_experience'),
        ...leaves('Festivals', 'Exhibitions', 'Food Festivals', 'Concerts', 'Networking', 'Community Events'),
    ], 'event', 'Ticketed, community, cultural, and marketplace events.'),
];

const attribute = (
    key: string,
    label: string,
    type: MarketplaceDynamicFieldDefinition['type'] = 'TEXT',
    options?: string[],
    required = false,
    unit?: string,
): MarketplaceDynamicFieldDefinition => ({
    key,
    label,
    type,
    required,
    section: 'Category attributes',
    options,
    unit,
    sortOrder: 500,
    ui: options ? undefined : { allowCustomOptions: true },
});

const eventInquiryAttributes: MarketplaceDynamicFieldDefinition[] = [
    attribute('event_styles', 'Event styles', 'MULTI_SELECT'),
    attribute('service_areas', 'Service areas', 'MULTI_SELECT'),
    attribute('minimum_guests', 'Minimum guests', 'NUMBER'),
    attribute('maximum_guests', 'Maximum guests', 'NUMBER'),
    attribute('advance_booking_days', 'Minimum advance booking', 'NUMBER', undefined, false, 'days'),
    attribute('package_inclusions', 'Typical package inclusions', 'TEXTAREA'),
    attribute('setup_and_teardown', 'Setup and teardown service', 'BOOLEAN'),
    attribute('venue_requirements', 'Venue requirements', 'TEXTAREA'),
    attribute('customization_options', 'Customization options', 'TEXTAREA'),
];

const eventInquiryCategoryCodes = [
    'wedding-and-party/wedding-decor',
    'wedding-and-party/party-decorations',
    'wedding-and-party/birthday-decorations',
    'wedding-and-party/baby-shower',
    'wedding-and-party/bridal-shower',
    'wedding-and-party/engagement',
    'wedding-and-party/anniversary',
    'wedding-and-party/graduation',
];

export const marketplaceCategoryAttributeSeeds: Record<string, MarketplaceDynamicFieldDefinition[]> = {
    'jewelry-and-accessories': [
        attribute('jewelry_type', 'Jewelry Type', 'TEXT'),
        attribute('metal_material', 'Metal / Material', 'MULTI_SELECT'),
        attribute('stone_gem', 'Stone / Gem', 'MULTI_SELECT'),
        attribute('purity_karat', 'Purity / Karat'),
        attribute('ring_size', 'Ring Size', 'MULTI_SELECT'),
        attribute('chain_length', 'Chain Length'),
        attribute('jewelry_weight', 'Weight', 'DECIMAL'),
        attribute('personalization', 'Personalization', 'BOOLEAN'),
    ],
    'clothing-and-shoes/womens-fashion': [
        attribute('gender_audience', 'Gender / Audience', 'SELECT', ['Women']),
        attribute('apparel_size', 'Size', 'MULTI_SELECT'), attribute('apparel_color', 'Color', 'MULTI_SELECT'),
        attribute('fabric', 'Fabric', 'MULTI_SELECT'), attribute('fit', 'Fit'), attribute('length', 'Length'),
        attribute('season', 'Season', 'MULTI_SELECT'), attribute('category_care_instructions', 'Care Instructions', 'TEXTAREA'),
    ],
    'clothing-and-shoes/mens-fashion': [
        attribute('gender_audience', 'Gender / Audience', 'SELECT', ['Men']),
        attribute('apparel_size', 'Size', 'MULTI_SELECT'), attribute('apparel_color', 'Color', 'MULTI_SELECT'),
        attribute('fabric', 'Fabric', 'MULTI_SELECT'), attribute('fit', 'Fit'), attribute('length', 'Length'),
        attribute('season', 'Season', 'MULTI_SELECT'), attribute('category_care_instructions', 'Care Instructions', 'TEXTAREA'),
    ],
    'clothing-and-shoes/kids-fashion': [
        attribute('gender_audience', 'Gender / Audience', 'SELECT', ['Baby', 'Boys', 'Girls', 'Unisex Kids']),
        attribute('apparel_size', 'Size', 'MULTI_SELECT'), attribute('apparel_color', 'Color', 'MULTI_SELECT'),
        attribute('fabric', 'Fabric', 'MULTI_SELECT'), attribute('fit', 'Fit'), attribute('length', 'Length'),
        attribute('season', 'Season', 'MULTI_SELECT'), attribute('category_care_instructions', 'Care Instructions', 'TEXTAREA'),
    ],
    'clothing-and-shoes/shoes': [
        attribute('gender_audience', 'Gender / Audience', 'SELECT', ['Women', 'Men', 'Kids', 'Unisex']),
        attribute('shoe_size_system', 'Shoe Size System', 'SELECT', ['EU', 'UK', 'US'], true),
        attribute('shoe_size', 'Shoe Size', 'MULTI_SELECT', undefined, true), attribute('shoe_color', 'Color', 'MULTI_SELECT'),
        attribute('upper_material', 'Upper Material'), attribute('sole_material', 'Sole Material'),
        attribute('heel_height', 'Heel Height', 'DECIMAL', undefined, false, 'cm'), attribute('fit_width', 'Fit / Width'),
    ],
    'electronics-and-accessories': [
        attribute('device_brand', 'Brand'), attribute('device_model', 'Model'),
        attribute('device_compatibility', 'Compatibility', 'MULTI_SELECT'), attribute('power_voltage', 'Power / Voltage'),
        attribute('connectivity', 'Connectivity', 'MULTI_SELECT'), attribute('device_warranty', 'Warranty'),
        attribute('included_accessories', 'Included Accessories', 'MULTI_SELECT'),
    ],
    'beauty-and-personal-care': [
        attribute('net_volume_weight', 'Volume / Net Weight'), attribute('beauty_ingredients', 'Ingredients', 'TEXTAREA'),
        attribute('skin_hair_type', 'Skin / Hair Type', 'MULTI_SELECT'), attribute('usage_instructions', 'Usage Instructions', 'TEXTAREA'),
        attribute('manufacture_date', 'Manufacture Date', 'DATE'), attribute('expiry_date', 'Expiry Date', 'DATE'),
        attribute('warnings', 'Warnings', 'TEXTAREA'),
    ],
    'plants-and-gardening': [
        attribute('plant_type', 'Plant Type'), attribute('pot_size', 'Pot Size'), attribute('plant_height', 'Plant Height'),
        attribute('light_requirement', 'Light Requirement', 'SELECT', ['Low light', 'Indirect light', 'Bright light', 'Full sun']),
        attribute('watering_requirement', 'Watering Requirement'),
        attribute('plant_setting', 'Indoor / Outdoor', 'SELECT', ['Indoor', 'Outdoor', 'Both']),
        attribute('live_plant_shipping_notes', 'Live Plant Shipping Notes', 'TEXTAREA'),
    ],
    ...Object.fromEntries(eventInquiryCategoryCodes.map(code => [code, eventInquiryAttributes])),
};

export const legacyMarketplaceCategoryAliases: Record<string, string> = {
    'artisan-handmade': 'art-and-collectibles/handmade-crafts',
    fashion: 'clothing-and-shoes',
    'beauty-wellness': 'beauty-and-personal-care',
    'home-decor': 'home-and-living/home-decor',
    'food-bakery': 'food-and-beverages/bakery',
    'digital-products': 'digital-products',
    'digital-products/custom-digital-design': 'digital-products/custom-digital-products',
    'digital-products/custom-canva-templates': 'digital-products/custom-digital-products/custom-canva-templates',
    'digital-products/custom-social-media-templates': 'digital-products/custom-digital-products/custom-social-media-templates',
    'digital-products/custom-business-templates': 'digital-products/custom-digital-products/custom-business-templates',
    'digital-products/custom-resume-templates': 'digital-products/custom-digital-products/custom-resume-templates',
    'digital-products/custom-invitations': 'digital-products/custom-digital-products/custom-invitations',
    'digital-products/custom-digital-design/logo-and-brand-identity': 'digital-products/custom-digital-products/logo-and-brand-identity',
    'digital-products/custom-digital-design/social-media-design': 'digital-products/custom-digital-products/social-media-design',
    'digital-products/custom-digital-design/invitations-and-stationery': 'digital-products/custom-digital-products/invitations-and-stationery',
    'digital-products/custom-digital-design/presentation-design': 'digital-products/custom-digital-products/presentation-design',
    'digital-products/custom-digital-design/illustration-and-digital-art': 'digital-products/custom-digital-products/illustration-and-digital-art',
    'digital-products/custom-digital-design/ui-and-ux-design': 'digital-products/custom-digital-products/ui-and-ux-design',
    'digital-products/custom-digital-design/packaging-design': 'digital-products/custom-digital-products/packaging-design',
    'digital-products/custom-digital-design/marketing-design': 'digital-products/custom-digital-products/marketing-design',
    'digital-products/custom-digital-design/other-custom-design': 'digital-products/custom-digital-products/other-custom-design',
    services: 'services',
    'workshops-events': 'workshops',
};
