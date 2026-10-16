import {
    MarketplaceDynamicFieldDefinition,
    MarketplaceDynamicFieldType,
    MarketplaceListingType,
} from '../entities/marketplace-form-template.entity';

export interface MarketplaceFormTemplateSeed {
    key: string;
    name: string;
    listingType: MarketplaceListingType;
    schema: MarketplaceDynamicFieldDefinition[];
    revision?: number;
}

const field = (
    key: string,
    label: string,
    type: MarketplaceDynamicFieldType,
    required = false,
    config: Partial<MarketplaceDynamicFieldDefinition> = {},
): MarketplaceDynamicFieldDefinition => ({ key, label, type, required, section: 'Details', ...config });

const source = (value: string, extra: Record<string, unknown> = {}) => ({ source: value, ...extra });

const categoryField = (label = 'Category') => field('category', label, 'SELECT', true, {
    section: 'Category',
    ui: source('category'),
});

const titleField = (label: string) => field('product_name', label, 'TEXT', true, {
    section: 'Basic information',
    validation: { minLength: 3, maxLength: 160 },
    ui: source('name'),
});

const descriptionField = (label = 'Description') => field('description', label, 'RICH_TEXT', true, {
    section: 'Basic information',
    validation: { minLength: 20, maxLength: 20_000 },
    ui: source('description'),
});

const priceField = (label = 'Price') => field('price', label, 'CURRENCY', true, {
    section: 'Pricing and inventory',
    validation: { min: 1 },
    ui: source('price'),
});

const salePriceField = field('sale_price', 'Sale Price', 'CURRENCY', false, {
    section: 'Pricing and inventory',
    validation: { min: 1, lessThanField: 'price' },
    ui: source('salePrice'),
});

const skuField = field('sku', 'SKU', 'TEXT', false, {
    section: 'Pricing and inventory',
    ui: source('sku'),
});

const imagesField = (label = 'Product Images') => field('product_images', label, 'MULTIPLE_IMAGES', true, {
    section: 'Media',
    validation: { minItems: 1, maxItems: 8, allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'], maxFileSizeMb: 10 },
    ui: source('images'),
});

const videoField = (required = false, label = 'Product Video') => field('product_video', label, 'VIDEO', required, {
    section: 'Media',
    ui: source('video'),
});

const variantField = field('variations', 'Variations', 'VARIANT_BUILDER', false, {
    section: 'Pricing and inventory',
    ui: source('variants'),
});

const physicalCore = (title = 'Product Name', description = 'Product Description') => [
    titleField(title),
    descriptionField(description),
    categoryField(),
];

const physicalCommerce = [
    field('quantity_available', 'Quantity Available', 'NUMBER', true, {
        section: 'Pricing and inventory', validation: { integer: true, min: 0 }, ui: source('stock'),
    }),
    field('stock_status', 'Stock Status', 'SELECT', false, {
        section: 'Pricing and inventory', options: ['In Stock', 'Out of Stock', 'Made to Order'], ui: source('stockStatus'),
    }),
    priceField(), salePriceField, skuField, imagesField(), videoField(),
];

const physicalSchema: MarketplaceDynamicFieldDefinition[] = [
    ...physicalCore(),
    field('brand', 'Brand', 'TEXT', false, { section: 'Product details', ui: source('brand') }),
    field('condition', 'Condition', 'SELECT', true, {
        section: 'Product details', options: ['New', 'Used', 'Refurbished', 'Other'], ui: { defaultValue: 'New' },
    }),
    field('materials', 'Materials', 'MULTI_SELECT', false, { section: 'Product details', ui: { allowCustomOptions: true } }),
    field('dimensions', 'Dimensions', 'TEXT', false, { section: 'Product details', placeholder: 'Length x width x height' }),
    field('dimension_unit', 'Dimension Unit', 'RADIO', false, { section: 'Product details', options: ['cm', 'inches'] }),
    field('weight', 'Weight', 'DECIMAL', false, { section: 'Product details', validation: { min: 0 } }),
    field('weight_unit', 'Weight Unit', 'SELECT', false, { section: 'Product details', options: ['g', 'kg', 'oz', 'lb'] }),
    field('color', 'Color', 'MULTI_SELECT', false, { section: 'Product details', ui: { allowCustomOptions: true } }),
    field('size', 'Size', 'MULTI_SELECT', false, { section: 'Product details', ui: { allowCustomOptions: true } }),
    variantField,
    ...physicalCommerce,
    field('packaging_details', 'Packaging Details', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
    field('care_instructions', 'Care Instructions', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
    field('warranty_information', 'Warranty Information', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
    field('safety_information', 'Safety Information', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
];

const artisanSchema: MarketplaceDynamicFieldDefinition[] = [
    ...physicalCore(),
    field('materials', 'Materials', 'MULTI_SELECT', true, { section: 'Product details', ui: { allowCustomOptions: true } }),
    field('dimensions', 'Dimensions', 'TEXT', true, { section: 'Product details', placeholder: 'Length x width x height and unit' }),
    field('weight', 'Weight', 'DECIMAL', false, { section: 'Product details', validation: { min: 0 } }),
    field('weight_unit', 'Weight Unit', 'SELECT', false, { section: 'Product details', options: ['g', 'kg', 'oz', 'lb'] }),
    field('color', 'Color', 'MULTI_SELECT', false, { section: 'Product details', ui: { allowCustomOptions: true } }),
    field('size', 'Size', 'MULTI_SELECT', false, { section: 'Product details', ui: { allowCustomOptions: true } }),
    variantField,
    field('handmade_status', 'Handmade / Hand-finished', 'SELECT', false, {
        section: 'Craft and production', options: ['Handmade', 'Hand-finished', 'Designed by vendor', 'Other'],
    }),
    field('production_time', 'Production Time', 'NUMBER', false, {
        section: 'Craft and production', unit: 'days', validation: { integer: true, min: 0 },
    }),
    field('customization_available', 'Customization Available', 'BOOLEAN', false, { section: 'Craft and production' }),
    field('personalization_options', 'Personalization Options', 'TEXTAREA', false, {
        section: 'Craft and production', condition: { field: 'customization_available', equals: true },
    }),
    field('quantity_available', 'Quantity Available', 'NUMBER', false, {
        section: 'Pricing and inventory', validation: { integer: true, min: 0 }, ui: source('stock'),
    }),
    priceField(), salePriceField, skuField, imagesField(), videoField(),
    field('packaging_details', 'Packaging Details', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
    field('care_instructions', 'Care Instructions', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
    field('safety_information', 'Safety Information', 'TEXTAREA', false, { section: 'Fulfilment and safety' }),
];

const foodSchema: MarketplaceDynamicFieldDefinition[] = [
    ...physicalCore(),
    field('ingredients', 'Ingredients', 'REPEATER', true, { section: 'Food details', ui: { repeaterKind: 'STRING_LIST' } }),
    field('allergen_information', 'Allergen Information', 'MULTI_SELECT', true, {
        section: 'Food details', options: ['Gluten', 'Dairy', 'Eggs', 'Peanuts', 'Tree nuts', 'Soy', 'Fish', 'Shellfish', 'Sesame', 'Other'],
    }),
    field('dietary_information', 'Dietary Information', 'MULTI_SELECT', false, {
        section: 'Food details', options: ['Vegetarian', 'Vegan', 'Gluten-Free', 'Dairy-Free', 'Nut-Free', 'Halal', 'Keto'],
    }),
    field('serving_size', 'Serving Size', 'TEXT', false, { section: 'Food details' }),
    field('quantity', 'Package Quantity', 'NUMBER', false, { section: 'Food details', validation: { integer: true, min: 0 } }),
    field('weight', 'Weight', 'DECIMAL', false, { section: 'Food details', validation: { min: 0 } }),
    field('weight_unit', 'Weight Unit', 'SELECT', false, { section: 'Food details', options: ['g', 'kg', 'ml', 'l'] }),
    field('preparation_time', 'Preparation Time', 'NUMBER', false, { section: 'Food details', unit: 'minutes', validation: { integer: true, min: 0 } }),
    field('shelf_life', 'Shelf Life', 'NUMBER', true, { section: 'Food safety', unit: 'days', validation: { integer: true, min: 1 } }),
    field('preparation_date', 'Manufacturing / Preparation Date', 'DATE', false, { section: 'Food safety' }),
    field('best_before_date', 'Best Before Date', 'DATE', false, {
        section: 'Food safety', validation: { notBeforeField: 'preparation_date' },
    }),
    field('storage_instructions', 'Storage Instructions', 'TEXTAREA', true, { section: 'Food safety' }),
    field('reheating_instructions', 'Reheating Instructions', 'TEXTAREA', false, { section: 'Food safety' }),
    field('packaging_type', 'Packaging Type', 'TEXT', false, { section: 'Packaging' }),
    field('packaging_size', 'Packaging Size', 'TEXT', false, { section: 'Packaging' }),
    priceField(), salePriceField, skuField, imagesField(), videoField(true),
];

const serviceSchema: MarketplaceDynamicFieldDefinition[] = [
    titleField('Service Name'), descriptionField('Service Description'), categoryField(),
    field('included', "What's Included", 'REPEATER', true, { section: 'Scope', ui: { repeaterKind: 'STRING_LIST' } }),
    field('not_included', "What's Not Included", 'REPEATER', false, { section: 'Scope', ui: { repeaterKind: 'STRING_LIST' } }),
    field('service_duration', 'Service Duration', 'NUMBER', true, { section: 'Booking', unit: 'minutes', validation: { integer: true, min: 1 } }),
    field('starting_price', 'Starting Price', 'CURRENCY', true, { section: 'Pricing', validation: { min: 1 }, ui: source('price') }),
    field('pricing_model', 'Pricing Model', 'SELECT', true, { section: 'Pricing', options: ['Fixed', 'Hourly', 'Package', 'Custom Quote'] }),
    field('packages', 'Packages', 'REPEATER', false, { section: 'Pricing', ui: source('servicePackages', { repeaterKind: 'SERVICE_PACKAGE' }) }),
    field('add_ons', 'Add-ons', 'REPEATER', false, { section: 'Pricing', ui: source('serviceAddOns', { repeaterKind: 'SERVICE_ADD_ON' }) }),
    field('customization_available', 'Customization Available', 'BOOLEAN', false, { section: 'Booking' }),
    field('minimum_booking', 'Minimum Booking', 'NUMBER', false, { section: 'Booking', validation: { min: 0 } }),
    field('maximum_booking', 'Maximum Booking', 'NUMBER', false, { section: 'Booking', validation: { min: 0, notLessThanField: 'minimum_booking' } }),
    field('advance_notice', 'Advance Notice Required', 'NUMBER', false, { section: 'Booking', unit: 'hours', validation: { integer: true, min: 0 } }),
    imagesField('Service Images'), videoField(), skuField,
];

const digitalSchema: MarketplaceDynamicFieldDefinition[] = [
    titleField('Product Name'), categoryField('Digital Product Category'), descriptionField(),
    field('included', "What's Included", 'REPEATER', true, { section: 'Product information', ui: { repeaterKind: 'STRING_LIST' } }),
    field('file_type', 'File Type', 'SELECT', true, { section: 'Product information', options: ['PDF', 'ZIP', 'SVG', 'PNG', 'JPG', 'DOCX', 'XLSX', 'PPTX', 'MP4', 'MP3', 'Other'] }),
    field('file_size', 'File Size', 'TEXT', false, { section: 'Product information', ui: { readOnly: true, derived: true } }),
    field('number_of_files', 'Number of Files', 'NUMBER', false, { section: 'Product information', validation: { integer: true, min: 1 }, ui: { derived: true } }),
    field('number_of_pages', 'Number of Pages', 'NUMBER', false, { section: 'Product information', validation: { integer: true, min: 1 } }),
    field('software_required', 'Software Required', 'TEXT', false, { section: 'Compatibility' }),
    field('compatibility', 'Compatibility', 'MULTI_SELECT', false, { section: 'Compatibility', ui: { allowCustomOptions: true } }),
    field('version', 'Version', 'TEXT', false, { section: 'Compatibility' }),
    field('language', 'Language', 'TEXT', false, { section: 'Compatibility' }),
    field('editable', 'Editable?', 'BOOLEAN', false, { section: 'License' }),
    field('printable', 'Printable?', 'BOOLEAN', false, { section: 'License' }),
    field('commercial_use', 'Commercial Use?', 'BOOLEAN', false, { section: 'License' }),
    field('personal_use', 'Personal Use?', 'BOOLEAN', false, { section: 'License' }),
    field('license_type', 'License Type', 'SELECT', true, { section: 'License', options: ['Personal', 'Commercial', 'Extended Commercial', 'Editorial', 'Custom'] }),
    field('users_allowed', 'Number of Users Allowed', 'NUMBER', false, { section: 'License', validation: { integer: true, min: 1 } }),
    field('main_file', 'Upload Main File', 'FILE', true, {
        section: 'Digital files', validation: { maxFileSizeMb: 500 }, ui: source('digitalFiles', { private: true }),
    }),
    field('preview_images', 'Preview Images', 'MULTIPLE_IMAGES', true, { section: 'Digital files', validation: { minItems: 1 }, ui: source('images') }),
    field('preview_pdf', 'Preview PDF', 'FILE', false, { section: 'Digital files', validation: { allowedExtensions: ['pdf'] }, ui: source('digitalFiles') }),
    field('demo_video', 'Demo Video', 'VIDEO', false, { section: 'Digital files', ui: source('video') }),
    field('thumbnail', 'Thumbnail', 'IMAGE', true, { section: 'Digital files', ui: source('images') }),
    field('file_version', 'File Version', 'TEXT', false, { section: 'Digital files' }),
    field('automatic_delivery', 'Email Download After Vendor Delivery', 'BOOLEAN', false, { section: 'Delivery', ui: { defaultValue: true } }),
    field('download_limit', 'Download Limit', 'NUMBER', false, { section: 'Delivery', validation: { integer: true, min: 1 } }),
    field('download_expiry', 'Download Expiry', 'NUMBER', false, { section: 'Delivery', unit: 'days', validation: { integer: true, min: 1 } }),
    field('customer_account_required', 'Customer Account Required', 'BOOLEAN', false, { section: 'Delivery', ui: { defaultValue: true } }),
    field('watermark', 'Watermark', 'BOOLEAN', false, { section: 'Delivery' }),
    field('personalized_download', 'Personalized Download', 'BOOLEAN', false, { section: 'Delivery' }),
    field('rights_confirmed', 'I own the rights to this product', 'CHECKBOX', true, { section: 'Intellectual property', validation: { mustBeTrue: true } }),
    field('licensed_assets', 'Product contains licensed assets', 'BOOLEAN', false, { section: 'Intellectual property' }),
    field('license_documentation', 'License Documentation', 'FILE', false, {
        section: 'Intellectual property', condition: { field: 'licensed_assets', equals: true },
        validation: { requiredWhen: { field: 'licensed_assets', equals: true } },
        ui: source('digitalFiles'),
    }),
    field('copyright_information', 'Copyright Information', 'TEXTAREA', false, { section: 'Intellectual property' }),
    field('third_party_assets', 'Third-party Assets Declaration', 'TEXTAREA', false, { section: 'Intellectual property' }),
    priceField(), salePriceField, skuField,
];

const digitalProjectSchema: MarketplaceDynamicFieldDefinition[] = [
    titleField('Design Service Name'), categoryField('Digital Design Category'), descriptionField('Service Description'),
    field('included', 'Standard Deliverables', 'REPEATER', true, {
        section: 'Scope and deliverables',
        helpText: 'List the files, designs, and handover items included in the starting service.',
        ui: { repeaterKind: 'STRING_LIST' },
    }),
    field('project_types', 'Projects You Accept', 'MULTI_SELECT', true, {
        section: 'Scope and deliverables',
        options: ['Logo and brand identity', 'Social media design', 'Invitation and stationery', 'Presentation', 'Illustration', 'UI/UX design', 'Packaging', 'Marketing design', 'Other'],
        ui: { allowCustomOptions: true },
    }),
    field('concepts_included', 'Initial Concepts Included', 'NUMBER', true, {
        section: 'Creative process',
        helpText: 'The customer may request up to five initial concepts in their brief.',
        validation: { integer: true, min: 1, max: 5 },
        ui: { defaultValue: 5 },
    }),
    field('revision_rounds', 'Revision Rounds Included', 'NUMBER', true, {
        section: 'Creative process', validation: { integer: true, min: 0, max: 20 }, ui: { defaultValue: 2 },
    }),
    field('creative_process', 'Creative Process', 'TEXTAREA', false, {
        section: 'Creative process', placeholder: 'Brief review, concepts, feedback, revisions, and final handover',
    }),
    field('service_duration', 'Standard Turnaround', 'NUMBER', true, {
        section: 'Timeline', unit: 'days', validation: { integer: true, min: 1, max: 365 },
    }),
    field('rush_delivery_available', 'Rush Delivery Available', 'BOOLEAN', false, { section: 'Timeline' }),
    field('starting_price', 'Starting Price', 'CURRENCY', true, {
        section: 'Pricing', validation: { min: 1 }, ui: source('price'),
    }),
    field('pricing_model', 'Pricing Model', 'SELECT', true, {
        section: 'Pricing', options: ['Custom Quote'], ui: { defaultValue: 'Custom Quote' },
    }),
    field('packages', 'Optional Packages', 'REPEATER', false, {
        section: 'Pricing', ui: source('servicePackages', { repeaterKind: 'SERVICE_PACKAGE' }),
    }),
    field('add_ons', 'Optional Add-ons', 'REPEATER', false, {
        section: 'Pricing', ui: source('serviceAddOns', { repeaterKind: 'SERVICE_ADD_ON' }),
    }),
    field('delivery_formats', 'Available File Formats', 'MULTI_SELECT', true, {
        section: 'Final delivery',
        options: ['AI', 'EPS', 'SVG', 'PSD', 'FIG', 'PDF', 'PPTX', 'PNG', 'JPG', 'WEBP', 'MP4', 'ZIP', 'Other'],
        ui: { allowCustomOptions: true },
    }),
    field('source_files_included', 'Editable Source Files Included', 'BOOLEAN', false, { section: 'Final delivery' }),
    field('print_ready_files', 'Print-ready Files Available', 'BOOLEAN', false, { section: 'Final delivery' }),
    field('handover_method', 'Handover Method', 'SELECT', true, {
        section: 'Final delivery', options: ['Secure order chat', 'Secure download link'], ui: { defaultValue: 'Secure order chat' },
    }),
    field('commercial_use', 'Commercial Use Included', 'BOOLEAN', false, { section: 'Rights and licensing' }),
    field('ownership_transfer', 'Final Design Ownership Transfers After Payment', 'BOOLEAN', true, {
        section: 'Rights and licensing', validation: { mustBeTrue: true },
    }),
    field('licensed_assets', 'May Use Licensed Third-party Assets', 'BOOLEAN', false, { section: 'Rights and licensing' }),
    field('license_terms', 'Third-party License Terms', 'TEXTAREA', false, {
        section: 'Rights and licensing', condition: { field: 'licensed_assets', equals: true },
        validation: { requiredWhen: { field: 'licensed_assets', equals: true } },
        placeholder: 'Identify stock photos, fonts, templates, or other licensed assets and any usage limits.',
    }),
    field('nda_available', 'NDA / Confidential Project Available', 'BOOLEAN', false, { section: 'Rights and licensing' }),
    imagesField('Portfolio and Sample Work'), videoField(false, 'Portfolio Video'), skuField,
];

const workshopSchema: MarketplaceDynamicFieldDefinition[] = [
    titleField('Workshop / Experience Name'), categoryField(), descriptionField(),
    field('participants_learn', 'What Participants Will Learn', 'REPEATER', true, { section: 'Experience information', ui: { repeaterKind: 'STRING_LIST' } }),
    field('experience_level', 'Experience Level', 'SELECT', false, { section: 'Experience information', options: ['Beginner', 'Intermediate', 'Advanced', 'All Levels'] }),
    field('age_group', 'Age Group', 'TEXT', true, { section: 'Experience information' }),
    field('minimum_age', 'Minimum Age', 'NUMBER', false, { section: 'Experience information', validation: { integer: true, min: 0 } }),
    field('maximum_age', 'Maximum Age', 'NUMBER', false, { section: 'Experience information', validation: { integer: true, min: 0, notLessThanField: 'minimum_age' } }),
    field('duration', 'Duration', 'NUMBER', true, { section: 'Experience information', unit: 'minutes', validation: { integer: true, min: 1 } }),
    field('language', 'Language', 'MULTI_SELECT', false, { section: 'Experience information', ui: { allowCustomOptions: true } }),
    field('materials_included', 'Materials Included', 'BOOLEAN', false, { section: 'Inclusions' }),
    field('materials_details', 'Materials Details', 'TEXTAREA', false, { section: 'Inclusions', condition: { field: 'materials_included', equals: true } }),
    field('equipment_included', 'Equipment Included', 'BOOLEAN', false, { section: 'Inclusions' }),
    field('equipment_details', 'Equipment Details', 'TEXTAREA', false, { section: 'Inclusions', condition: { field: 'equipment_included', equals: true } }),
    field('food_drinks_included', 'Food / Drinks Included', 'BOOLEAN', false, { section: 'Inclusions' }),
    field('food_drinks_details', 'Food / Drinks Details', 'TEXTAREA', false, { section: 'Inclusions', condition: { field: 'food_drinks_included', equals: true } }),
    field('take_home_product', 'Take-Home Product', 'BOOLEAN', false, { section: 'Inclusions' }),
    field('take_home_product_details', 'Take-Home Product Details', 'TEXTAREA', false, { section: 'Inclusions', condition: { field: 'take_home_product', equals: true } }),
    field('certificate', 'Certificate', 'BOOLEAN', false, { section: 'Inclusions' }),
    field('certificate_details', 'Certificate Details', 'TEXTAREA', false, { section: 'Inclusions', condition: { field: 'certificate', equals: true } }),
    field('billing_model', 'Billing Model', 'SELECT', true, {
        section: 'Pricing and access',
        options: ['One-time workshop', 'Monthly subscription'],
        ui: { defaultValue: 'One-time workshop' },
        helpText: 'Choose whether customers pay for a dated session or a fixed monthly class pass.',
    }),
    field('subscription_period_days', 'Access Period', 'NUMBER', true, {
        section: 'Pricing and access', unit: 'days', condition: { field: 'billing_model', equals: 'Monthly subscription' },
        validation: { integer: true, min: 1, max: 365 }, ui: { defaultValue: 30 },
    }),
    field('subscription_start_date', 'Subscription Start Date', 'DATE', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'Monthly subscription' },
    }),
    field('class_frequency', 'Class Frequency', 'SELECT', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'Monthly subscription' },
        options: ['Every day', 'Weekdays', 'Selected days'], ui: { defaultValue: 'Every day' },
        helpText: 'The detailed days and times are set for each class below.',
    }),
    field('class_days', 'Class Days', 'MULTI_SELECT', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'Monthly subscription' },
        ui: source('availabilitySessions', { derived: true }),
    }),
    field('daily_start_time', 'Daily Start Time', 'TIME', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'Monthly subscription' },
        ui: source('availabilitySessions', { derived: true }),
    }),
    field('daily_end_time', 'Daily End Time', 'TIME', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'Monthly subscription' },
        ui: source('availabilitySessions', { derived: true }),
    }),
    field('subscription_capacity', 'Subscription Capacity', 'NUMBER', true, {
        section: 'Capacity', condition: { field: 'billing_model', equals: 'Monthly subscription' },
        ui: source('availabilitySessions', { derived: true }),
    }),
    field('date', 'Date', 'DATE', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'One-time workshop' },
        ui: source('availabilitySessions', { compositePart: 'date' }),
    }),
    field('start_time', 'Start Time', 'TIME', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'One-time workshop' },
        ui: source('availabilitySessions', { compositePart: 'startTime' }),
    }),
    field('end_time', 'End Time', 'TIME', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'One-time workshop' },
        validation: { afterField: 'start_time' }, ui: source('availabilitySessions', { compositePart: 'endTime' }),
    }),
    field('sessions', 'Dates and Sessions', 'REPEATER', true, {
        section: 'Schedule and availability', condition: { field: 'billing_model', equals: 'One-time workshop' },
        ui: source('availabilitySessions', { repeaterKind: 'AVAILABILITY_SESSION' }),
    }),
    field('venue_name', 'Venue Name', 'TEXT', false, { section: 'Location' }),
    field('full_address', 'Full Address', 'ADDRESS', false, { section: 'Location' }),
    field('city', 'City', 'TEXT', false, { section: 'Location' }),
    field('map_location', 'Google Maps Location', 'COORDINATES', false, { section: 'Location' }),
    field('parking_available', 'Parking Available', 'BOOLEAN', false, { section: 'Location' }),
    field('venue_setting', 'Indoor / Outdoor', 'SELECT', false, { section: 'Location', options: ['Indoor', 'Outdoor', 'Both'] }),
    field('venue_images', 'Venue Images', 'MULTIPLE_IMAGES', false, { section: 'Location', ui: source('images') }),
    field('price_per_person', 'Price', 'CURRENCY', true, { section: 'Pricing and access', validation: { min: 1 }, ui: source('price') }),
    field('cancellation_policy', 'Cancellation Policy', 'TEXTAREA', true, { section: 'Policies' }),
    field('refund_policy', 'Refund Policy', 'TEXTAREA', true, { section: 'Policies' }),
    field('rescheduling_policy', 'Rescheduling Policy', 'TEXTAREA', false, { section: 'Policies' }),
    field('weather_cancellation', 'Weather Cancellation', 'TEXTAREA', false, { section: 'Policies' }),
    field('no_show_policy', 'No-Show Policy', 'TEXTAREA', false, { section: 'Policies' }),
    imagesField('Workshop / Experience Images'), videoField(), skuField,
];

const eventSchema: MarketplaceDynamicFieldDefinition[] = [
    titleField('Event Name'), categoryField(), descriptionField('Event Description'),
    field('event_type', 'Event Type', 'SELECT', true, {
        section: 'Event information', options: ['Festival', 'Market', 'Exhibition', 'Concert', 'Kids Event', 'Community Event', 'Networking', 'Corporate', 'Fashion', 'Food', 'Wellness', 'Launch Event'],
    }),
    field('event_story', 'Event Story', 'RICH_TEXT', false, { section: 'Event information' }),
    field('highlights', 'Highlights', 'REPEATER', false, { section: 'Event information', ui: { repeaterKind: 'STRING_LIST' } }),
    field('event_banner', 'Event Banner', 'IMAGE', true, { section: 'Media', ui: source('images') }),
    field('event_gallery', 'Event Gallery', 'MULTIPLE_IMAGES', false, { section: 'Media', ui: source('images') }),
    field('promotional_video', 'Promotional Video', 'VIDEO', false, { section: 'Media', ui: source('video') }),
    field('event_date', 'Event Date', 'DATE', true, { section: 'Date and time' }),
    field('start_time', 'Start Time', 'TIME', true, { section: 'Date and time' }),
    field('end_time', 'End Time', 'TIME', true, { section: 'Date and time', validation: { afterField: 'start_time' } }),
    field('doors_open_time', 'Doors Open Time', 'TIME', false, { section: 'Date and time' }),
    field('schedule', 'Event Schedule', 'REPEATER', false, { section: 'Date and time', ui: source('eventScheduleItems', { repeaterKind: 'EVENT_SCHEDULE' }) }),
    field('venue_name', 'Venue Name', 'TEXT', true, { section: 'Venue' }),
    field('address', 'Address', 'ADDRESS', true, { section: 'Venue' }),
    field('city', 'City', 'TEXT', true, { section: 'Venue' }),
    field('map_coordinates', 'Google Maps Coordinates', 'COORDINATES', true, { section: 'Venue' }),
    field('venue_setting', 'Indoor / Outdoor', 'SELECT', false, { section: 'Venue', options: ['Indoor', 'Outdoor', 'Both'] }),
    field('parking', 'Parking', 'TEXTAREA', false, { section: 'Venue' }),
    field('venue_rules', 'Venue Rules', 'TEXTAREA', false, { section: 'Venue' }),
    field('ticket_types', 'Ticket Types', 'REPEATER', true, { section: 'Ticketing', ui: source('eventTicketTypes', { repeaterKind: 'EVENT_TICKET' }) }),
    field('cancellation_policy', 'Cancellation Policy', 'TEXTAREA', true, { section: 'Policies' }),
    field('refund_policy', 'Refund Policy', 'TEXTAREA', true, { section: 'Policies' }),
    field('rescheduling_policy', 'Rescheduling Policy', 'TEXTAREA', false, { section: 'Policies' }),
    field('age_restrictions', 'Age Restrictions', 'TEXT', false, { section: 'Policies' }),
    field('photography_consent', 'Photography Consent', 'TEXTAREA', false, { section: 'Policies' }),
    field('terms_conditions', 'Terms & Conditions', 'RICH_TEXT', false, { section: 'Policies' }),
    field('safety_rules', 'Safety Rules', 'RICH_TEXT', false, { section: 'Policies' }),
    field('entry_requirements', 'Entry Requirements', 'RICH_TEXT', false, { section: 'Policies' }),
    skuField,
];

export const marketplaceFormTemplateSeeds: MarketplaceFormTemplateSeed[] = [
    { key: 'physical_product', name: 'Physical Product', listingType: 'PHYSICAL_PRODUCT', schema: physicalSchema, revision: 3 },
    { key: 'artisan_product', name: 'Artisan Product', listingType: 'ARTISAN_PRODUCT', schema: artisanSchema, revision: 3 },
    { key: 'food', name: 'Food Product', listingType: 'FOOD_PRODUCT', schema: foodSchema, revision: 3 },
    { key: 'service', name: 'Service', listingType: 'SERVICE', schema: serviceSchema, revision: 3 },
    { key: 'digital_product', name: 'Digital Product', listingType: 'DIGITAL_PRODUCT', schema: digitalSchema, revision: 3 },
    { key: 'custom_digital_project', name: 'Custom Digital Project', listingType: 'SERVICE', schema: digitalProjectSchema, revision: 1 },
    { key: 'workshop_experience', name: 'Workshop / Experience', listingType: 'WORKSHOP_EXPERIENCE', schema: workshopSchema, revision: 6 },
    { key: 'event', name: 'Event', listingType: 'EVENT', schema: eventSchema, revision: 4 },
];

export function marketplaceBehaviorProductType(listingType: MarketplaceListingType) {
    if (listingType === 'FOOD_PRODUCT') return 'PERISHABLE';
    if (listingType === 'DIGITAL_PRODUCT') return 'DIGITAL';
    if (listingType === 'SERVICE') return 'SERVICE';
    if (listingType === 'WORKSHOP_EXPERIENCE') return 'WORKSHOP';
    if (listingType === 'EVENT') return 'EVENT';
    return 'PHYSICAL';
}
