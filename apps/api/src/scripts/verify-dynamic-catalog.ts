import assert from 'node:assert/strict';

import {
    marketplaceCategoryHierarchy,
    marketplaceCategorySlug,
    MarketplaceCategorySeedNode,
} from '../plugins/marketplace/modules/catalog/config/category-hierarchy-seed';
import { marketplaceFormTemplateSeeds } from '../plugins/marketplace/modules/catalog/config/form-template-seeds';

interface FlatSeedCategory {
    path: string[];
    code: string;
    templateKey?: string;
    effectiveTemplateKey?: string;
    chatEnabled: boolean;
}

const supportedFieldTypes = new Set([
    'TEXT', 'TEXTAREA', 'NUMBER', 'DECIMAL', 'CURRENCY', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'RADIO',
    'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'IMAGE', 'MULTIPLE_IMAGES', 'FILE', 'MULTIPLE_FILES', 'VIDEO',
    'RICH_TEXT', 'ADDRESS', 'COORDINATES', 'REPEATER', 'VARIANT_BUILDER',
]);
const expectedTemplates = new Set([
    'physical_product', 'artisan_product', 'food', 'service', 'digital_product', 'workshop_experience', 'event',
    'custom_digital_project',
]);

function flatten(nodes: MarketplaceCategorySeedNode[], parentPath: string[] = [], inheritedTemplate?: string): FlatSeedCategory[] {
    return nodes.flatMap(node => {
        const path = [...parentPath, node.name];
        const effectiveTemplateKey = node.templateKey ?? inheritedTemplate;
        return [{
            path,
            code: path.map(marketplaceCategorySlug).join('/'),
            templateKey: node.templateKey,
            effectiveTemplateKey,
            chatEnabled: node.chatEnabled === true,
        }, ...flatten(node.children ?? [], path, effectiveTemplateKey)];
    });
}

function category(categories: FlatSeedCategory[], path: string[]) {
    const code = path.map(marketplaceCategorySlug).join('/');
    const result = categories.find(item => item.code === code);
    assert(result, `Missing category path: ${path.join(' > ')}`);
    return result;
}

const categories = flatten(marketplaceCategoryHierarchy);
assert.equal(marketplaceCategoryHierarchy.length, 23, 'The marketplace must have exactly 23 root categories');
assert.equal(categories.length, 451, 'The seeded hierarchy must contain exactly 451 categories');
assert.equal(new Set(categories.map(item => item.code)).size, categories.length, 'Every category path must be unique');
assert(categories.every(item => item.effectiveTemplateKey), 'Every seeded category must resolve an inherited form template');

const eventInquiryCodes = new Set([
    'wedding-and-party/wedding-decor',
    'wedding-and-party/party-decorations',
    'wedding-and-party/birthday-decorations',
    'wedding-and-party/baby-shower',
    'wedding-and-party/bridal-shower',
    'wedding-and-party/engagement',
    'wedding-and-party/anniversary',
    'wedding-and-party/graduation',
]);
const customDigitalProjectCodes = new Set([
    'digital-products/custom-digital-products',
    'digital-products/custom-digital-products/custom-canva-templates',
    'digital-products/custom-digital-products/custom-social-media-templates',
    'digital-products/custom-digital-products/custom-business-templates',
    'digital-products/custom-digital-products/custom-resume-templates',
    'digital-products/custom-digital-products/custom-invitations',
    'digital-products/custom-digital-products/logo-and-brand-identity',
    'digital-products/custom-digital-products/social-media-design',
    'digital-products/custom-digital-products/invitations-and-stationery',
    'digital-products/custom-digital-products/presentation-design',
    'digital-products/custom-digital-products/illustration-and-digital-art',
    'digital-products/custom-digital-products/ui-and-ux-design',
    'digital-products/custom-digital-products/packaging-design',
    'digital-products/custom-digital-products/marketing-design',
    'digital-products/custom-digital-products/other-custom-design',
]);
assert.deepEqual(
    new Set(categories.filter(item => item.chatEnabled).map(item => item.code)),
    new Set([...eventInquiryCodes, ...customDigitalProjectCodes]),
    'Only custom event and custom digital project categories should enable vendor chat by default',
);
for (const code of eventInquiryCodes) {
    assert.equal(categories.find(item => item.code === code)?.effectiveTemplateKey, 'service', `${code} must use the service form`);
}
for (const code of customDigitalProjectCodes) {
    assert.equal(categories.find(item => item.code === code)?.effectiveTemplateKey, 'custom_digital_project', `${code} must use the custom digital project form`);
}

assert.deepEqual(new Set(marketplaceFormTemplateSeeds.map(template => template.key)), expectedTemplates, 'All eight reusable form templates are required');
for (const template of marketplaceFormTemplateSeeds) {
    assert(template.schema.length > 0, `${template.name} must define fields`);
    assert.equal(new Set(template.schema.map(field => field.key)).size, template.schema.length, `${template.name} field keys must be unique`);
    for (const field of template.schema) {
        assert(supportedFieldTypes.has(field.type), `${template.name}.${field.key} uses unsupported type ${field.type}`);
        assert(/^[a-z][a-z0-9_]{1,63}$/.test(field.key), `${template.name}.${field.key} is not a stable field key`);
    }
}

const requiredFields: Record<string, string[]> = {
    physical_product: ['product_name', 'description', 'category', 'condition', 'quantity_available', 'price', 'product_images'],
    artisan_product: ['product_name', 'description', 'category', 'materials', 'dimensions', 'price', 'product_images'],
    food: ['product_name', 'description', 'category', 'ingredients', 'allergen_information', 'shelf_life', 'storage_instructions', 'price', 'product_images', 'product_video'],
    service: ['product_name', 'description', 'category', 'included', 'service_duration', 'starting_price', 'pricing_model'],
    digital_product: ['product_name', 'category', 'description', 'included', 'file_type', 'license_type', 'main_file', 'preview_images', 'thumbnail', 'rights_confirmed', 'price'],
    workshop_experience: ['product_name', 'category', 'description', 'participants_learn', 'age_group', 'duration', 'billing_model', 'sessions', 'subscription_period_days', 'subscription_start_date', 'class_frequency', 'daily_start_time', 'daily_end_time', 'price_per_person', 'cancellation_policy', 'refund_policy'],
    event: ['product_name', 'category', 'description', 'event_type', 'event_banner', 'event_date', 'start_time', 'end_time', 'venue_name', 'address', 'city', 'map_coordinates', 'ticket_types', 'cancellation_policy', 'refund_policy'],
};
for (const [templateKey, keys] of Object.entries(requiredFields)) {
    const template = marketplaceFormTemplateSeeds.find(item => item.key === templateKey);
    assert(template, `Missing template ${templateKey}`);
    const required = new Set(template.schema.filter(field => field.required).map(field => field.key));
    for (const key of keys) assert(required.has(key), `${templateKey}.${key} must be backend-required`);
}

const documentedFields: Record<string, string[]> = {
    physical_product: ['product_name', 'description', 'category', 'brand', 'condition', 'materials', 'dimensions', 'dimension_unit', 'weight', 'weight_unit', 'color', 'size', 'variations', 'quantity_available', 'stock_status', 'price', 'sale_price', 'sku', 'product_images', 'product_video', 'packaging_details', 'care_instructions', 'warranty_information', 'safety_information'],
    artisan_product: ['product_name', 'description', 'category', 'materials', 'dimensions', 'weight', 'weight_unit', 'color', 'size', 'variations', 'handmade_status', 'production_time', 'customization_available', 'personalization_options', 'quantity_available', 'price', 'sale_price', 'sku', 'product_images', 'product_video', 'packaging_details', 'care_instructions', 'safety_information'],
    food: ['product_name', 'description', 'category', 'ingredients', 'allergen_information', 'dietary_information', 'serving_size', 'quantity', 'weight', 'weight_unit', 'preparation_time', 'shelf_life', 'preparation_date', 'best_before_date', 'storage_instructions', 'reheating_instructions', 'packaging_type', 'packaging_size', 'price', 'sale_price', 'sku', 'product_images', 'product_video'],
    service: ['product_name', 'description', 'category', 'included', 'not_included', 'service_duration', 'starting_price', 'pricing_model', 'packages', 'add_ons', 'customization_available', 'minimum_booking', 'maximum_booking', 'advance_notice'],
    digital_product: ['product_name', 'category', 'description', 'included', 'file_type', 'file_size', 'number_of_files', 'number_of_pages', 'software_required', 'compatibility', 'version', 'language', 'editable', 'printable', 'commercial_use', 'personal_use', 'license_type', 'users_allowed', 'main_file', 'preview_images', 'preview_pdf', 'demo_video', 'thumbnail', 'file_version', 'automatic_delivery', 'download_limit', 'download_expiry', 'customer_account_required', 'watermark', 'personalized_download', 'rights_confirmed', 'licensed_assets', 'license_documentation', 'copyright_information', 'third_party_assets', 'price', 'sale_price', 'sku'],
    workshop_experience: ['product_name', 'category', 'description', 'participants_learn', 'experience_level', 'age_group', 'minimum_age', 'maximum_age', 'duration', 'language', 'materials_included', 'materials_details', 'equipment_included', 'equipment_details', 'food_drinks_included', 'food_drinks_details', 'take_home_product', 'take_home_product_details', 'certificate', 'certificate_details', 'billing_model', 'subscription_period_days', 'subscription_start_date', 'class_frequency', 'class_days', 'daily_start_time', 'daily_end_time', 'subscription_capacity', 'date', 'start_time', 'end_time', 'sessions', 'venue_name', 'full_address', 'city', 'map_location', 'parking_available', 'venue_setting', 'venue_images', 'price_per_person', 'cancellation_policy', 'refund_policy', 'rescheduling_policy', 'weather_cancellation', 'no_show_policy'],
    event: ['product_name', 'category', 'description', 'event_type', 'event_story', 'highlights', 'event_banner', 'event_gallery', 'promotional_video', 'event_date', 'start_time', 'end_time', 'doors_open_time', 'schedule', 'venue_name', 'address', 'city', 'map_coordinates', 'venue_setting', 'parking', 'venue_rules', 'ticket_types', 'cancellation_policy', 'refund_policy', 'rescheduling_policy', 'age_restrictions', 'photography_consent', 'terms_conditions', 'safety_rules', 'entry_requirements'],
};
for (const [templateKey, keys] of Object.entries(documentedFields)) {
    const template = marketplaceFormTemplateSeeds.find(item => item.key === templateKey);
    assert(template, `Missing template ${templateKey}`);
    const actual = new Set(template.schema.map(field => field.key));
    for (const key of keys) assert(actual.has(key), `${templateKey}.${key} from the specification is missing`);
}
const workshopFields = new Set(marketplaceFormTemplateSeeds.find(template => template.key === 'workshop_experience')!.schema.map(field => field.key));
for (const key of ['group_size', 'minimum_participants', 'maximum_participants', 'capacity', 'remaining_seats']) {
    assert(!workshopFields.has(key), `Workshop capacity is set per class; ${key} must not duplicate it`);
}

const examples: Array<[string[], string]> = [
    [['Clothing & Shoes', 'Shoes', 'Women', 'Heels'], 'physical_product'],
    [['Jewelry & Accessories', 'Rings'], 'physical_product'],
    [['Food & Beverages', 'Bakery', 'Cakes'], 'food'],
    [['Digital Products', 'Canva Templates'], 'digital_product'],
    [['Services', 'Photography'], 'service'],
    [['Workshops', 'Pottery'], 'workshop_experience'],
    [['Events', 'Concerts'], 'event'],
    [['Wellness', 'Essential Oils'], 'physical_product'],
    [['Wellness', 'Yoga Classes'], 'workshop_experience'],
    [['Books, Stationery & Party Supplies', 'E-Books'], 'digital_product'],
];
for (const [path, expected] of examples) {
    assert.equal(category(categories, path).effectiveTemplateKey, expected, `${path.join(' > ')} must resolve ${expected}`);
}

console.log(JSON.stringify({
    roots: marketplaceCategoryHierarchy.length,
    categories: categories.length,
    templates: marketplaceFormTemplateSeeds.length,
    inheritanceExamples: examples.length,
    result: 'PASS',
}, null, 2));
