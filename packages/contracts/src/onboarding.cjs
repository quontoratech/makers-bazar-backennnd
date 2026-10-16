'use strict';

const steps = [
    'Account',
    'Business profile',
    'Categories',
    'Category information',
    'Verification',
    'Payout',
    'Fulfillment',
    'Review',
];
const categories = [
    {
        id: 'physical',
        label: 'Physical products',
        vendorLabel: 'Physical products',
        listingType: 'PHYSICAL_PRODUCT',
    },
    {
        id: 'artisan',
        label: 'Artisan and handmade',
        vendorLabel: 'Artisan products',
        listingType: 'ARTISAN_PRODUCT',
    },
    { id: 'food', label: 'Food and bakery', vendorLabel: 'Food & bakery', listingType: 'FOOD_PRODUCT' },
    { id: 'service', label: 'Services', vendorLabel: 'Services', listingType: 'SERVICE' },
    {
        id: 'digital',
        label: 'Digital products',
        vendorLabel: 'Digital products',
        listingType: 'DIGITAL_PRODUCT',
    },
    {
        id: 'workshop',
        label: 'Workshops and experiences',
        vendorLabel: 'Workshops',
        listingType: 'WORKSHOP_EXPERIENCE',
    },
    { id: 'event', label: 'Events', vendorLabel: 'Events & tickets', listingType: 'EVENT' },
];
const fields = [];
function add(step, key, label, type = 'text', extra = {}) {
    fields.push({ step, key, label, type, ...extra });
}
const req = { required: true };
add(0, 'firstName', 'First name', 'text', req);
add(0, 'lastName', 'Last name', 'text', req);
add(0, 'email', 'Email Address', 'email', req);
add(0, 'phone', 'Mobile Number', 'tel', req);
add(0, 'whatsapp', 'WhatsApp Number', 'tel');
add(0, 'country', 'Country', 'select', { ...req, options: ['Pakistan'] });
add(0, 'city', 'City', 'text', req);
add(0, 'area', 'Area / Locality');
add(0, 'language', 'Preferred Language', 'select', { options: ['English', 'Urdu'] });
add(0, 'howHeard', 'How did you hear about The Makers Bazar?');
add(0, 'referral', 'Referral Code');
add(0, 'terms', 'Agree to Terms & Conditions', 'checkbox', req);
add(0, 'vendorAgreement', 'Agree to Vendor Policy', 'checkbox', req);
add(0, 'privacy', 'Privacy Policy Consent', 'checkbox', req);
add(1, 'storeName', 'Business / Brand Name', 'text', req);
add(1, 'displayName', 'Display Name', 'text', req);
add(1, 'businessPhone', 'Business Phone', 'tel');
add(1, 'businessWhatsApp', 'WhatsApp Business', 'tel');
add(1, 'businessCity', 'City');
add(1, 'businessType', 'Business type', 'select', {
    ...req,
    options: ['Individual', 'Partnership', 'Company', 'NGO', 'Other'],
});
add(1, 'establishedYear', 'Year established', 'number', { min: 1900, max: 2100 });
add(1, 'registrationNumber', 'Company registration number', 'text', {
    ...req,
    when: ['businessType', 'Company'],
});
add(1, 'logo', 'Store logo', 'file', { accept: 'image/jpeg,image/png,image/webp' });
add(1, 'banner', 'Store banner', 'file', { accept: 'image/jpeg,image/png,image/webp' });
add(1, 'tagline', 'Tagline');
add(1, 'description', 'Business description', 'textarea', req);
add(1, 'founderPhoto', 'Founder Photo', 'file', { accept: 'image/jpeg,image/png,image/webp' });
add(1, 'story', 'Founder Story', 'textarea');
add(1, 'whyStarted', 'Why did you start the business?', 'textarea');
add(1, 'brandDifference', 'What makes your brand different?', 'textarea');
add(1, 'brandValues', 'What does your brand stand for?', 'textarea');
add(1, 'founder', 'Founder name');
add(1, 'yearsExperience', 'Years of Experience', 'number', { min: 0, max: 100 });
add(1, 'employees', 'Number of Employees', 'number', { min: 1, max: 100000 });
add(1, 'address', 'Business address', 'textarea', req);
add(1, 'province', 'Province', 'text', req);
add(1, 'postalCode', 'Postal code');
add(1, 'contactEmail', 'Business contact email', 'email', req);
add(1, 'website', 'Website', 'url');
add(1, 'socialLinks', 'Social media URLs (one per line)', 'textarea');
add(1, 'attributes', 'Business attributes', 'multi', {
    options: ['Made in Pakistan', 'Women-led', 'Local', 'Handmade', 'Sustainable', 'Customizable'],
});
add(2, 'categories', 'Selling categories', 'multi', { ...req, options: categories.map(c => c.id) });
function profile(category, definitions) {
    for (const [key, label, type, extra] of definitions)
        add(3, `${category}_${key}`, label, type, { categories: [category], ...extra });
}
function categorySection(category, section, definitions) {
    for (const [key, label, type, extra] of definitions)
        add(3, `${category}_${key}`, label, type, { categories: [category], section, ...extra });
}
categorySection('artisan', 'Artisan Profile', [
    ['brandName', 'Brand Name', 'text', req],
    ['craft', 'Craft Category', 'text', req],
    ['craftType', 'Craft Type', 'text', req],
    ['experience', 'Years of Crafting Experience', 'number', { ...req, min: 0, max: 100 }],
    ['location', 'Location', 'text', req],
    ['artisanCount', 'Number of Artisans', 'number', { min: 1 }],
    ['studio', 'Workshop / Studio Location'],
    ['community', 'Community / Craft Group'],
    ['traditional', 'Traditional Craft?', 'checkbox'],
    ['familyTradition', 'Family Tradition?', 'checkbox'],
]);
categorySection('artisan', 'Craft Story', [
    ['story', 'How did you learn this craft?', 'textarea', req],
    ['teacher', 'Who taught you?'],
    ['familyHistory', 'How long has your family practiced it?'],
    ['craftStory', 'Story behind your craft', 'textarea', req],
    ['inspiration', 'Inspiration', 'textarea'],
    ['culturalSignificance', 'Cultural significance', 'textarea'],
    ['materials', 'Materials traditionally used', 'textarea'],
    ['origin', 'Region of origin'],
    ['unique', 'What makes your craft unique?', 'textarea'],
]);
categorySection('artisan', 'Craft Verification', [
    ['workshopImages', 'Workshop Images', 'file', { multiple: true, accept: 'image/jpeg,image/png,image/webp' }],
    ['processImages', 'Making Process Images', 'file', { multiple: true, accept: 'image/jpeg,image/png,image/webp' }],
    ['processVideo', 'Making Process Video', 'file', { accept: 'video/mp4' }],
    ['photos', 'Artisan Photos', 'file', { multiple: true, accept: 'image/jpeg,image/png,image/webp' }],
    ['craftProof', 'Proof of Craftsmanship', 'file', { multiple: true, accept: 'application/pdf,image/jpeg,image/png,image/webp' }],
    ['certificate', 'Certificate / Craft Association, if applicable', 'file', { accept: 'application/pdf,image/jpeg,image/png,image/webp' }],
]);
categorySection('physical', 'Product Business Information', [
    ['brandName', 'Brand / Business Name', 'text', req],
    ['productCategory', 'Product Category', 'text', req],
    ['productTypes', 'Products You Plan to Sell', 'textarea', req],
    ['sourcingModel', 'Sourcing Model', 'select', {
        ...req,
        options: ['Own manufacturing', 'Local manufacturer', 'Authorized distributor', 'Importer', 'Mixed sourcing'],
    }],
    ['manufacturingLocation', 'Manufacturing / Sourcing Location', 'text', req],
    ['materials', 'Materials and Product Composition', 'textarea'],
]);
categorySection('physical', 'Quality & Compliance', [
    ['qualityControl', 'Quality Control Process', 'textarea', req],
    ['warrantyReturns', 'Warranty and Returns Process', 'textarea', req],
    ['supplierProof', 'Supplier / Manufacturing Proof', 'file', {
        accept: 'application/pdf,image/jpeg,image/png,image/webp',
    }],
    ['complianceDocuments', 'Product Compliance Documents', 'file', {
        multiple: true,
        accept: 'application/pdf,image/jpeg,image/png,image/webp',
    }],
]);
categorySection('food', 'Food Business Information', [
    ['businessName', 'Business Name', 'text', req],
    [
        'type',
        'Food Business Type',
        'select',
        {
            ...req,
            options: [
                'Home-Based', 'Bakery', 'Restaurant', 'Cloud Kitchen', 'Caterer',
                'Food Manufacturer', 'Specialty Food Brand', 'Beverage Brand',
            ],
            legacyOptions: ['Home kitchen', 'Catering', 'Packaged food'],
        },
    ],
    ['category', 'Food Category', 'text', req],
    ['cuisine', 'Cuisine'],
    ['kitchenAddress', 'Kitchen Address', 'textarea', req],
    ['kitchen', 'Preparation Location', 'textarea', req],
    [
        'days',
        'Operating Days',
        'multi',
        { ...req, options: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] },
    ],
    ['hours', 'Operating Hours', 'text', req],
]);
categorySection('food', 'Compliance & Safety', [
    ['license', 'Business Registration', 'file', { accept: 'application/pdf,image/jpeg,image/png,image/webp' }],
    ['safety', 'Food Compliance & Safety Protocols', 'textarea'],
]);
categorySection('service', 'Service Provider Profile', [
    ['providerName', 'Provider / Business Name', 'text', req],
    ['type', 'Provider Type', 'select', { ...req, options: ['Individual', 'Agency', 'Team'] }],
    ['specialty', 'Service Category', 'text', req],
    ['subcategory', 'Subcategory', 'text', req],
    ['experience', 'Years of Experience', 'number', { min: 0 }],
    ['qualifications', 'Qualifications', 'textarea'],
    [
        'certificates',
        'Certifications',
        'file',
        { multiple: true, accept: 'application/pdf,image/jpeg,image/png,image/webp' },
    ],
    ['license', 'Professional License', 'file', { accept: 'application/pdf,image/jpeg,image/png,image/webp' }],
    ['areas', 'Areas Served', 'textarea'],
    ['location', 'Service Location'],
    ['home', 'Home Service Available', 'checkbox'],
    ['online', 'Online Service Available', 'checkbox'],
]);
categorySection('service', 'Availability & Bookings', [
    ['availability', 'Available days and hours', 'textarea', req],
    ['maxBookings', 'Maximum daily bookings', 'number', { min: 1 }],
    ['notice', 'Minimum notice (hours)', 'number', { min: 0 }],
]);
categorySection('digital', 'Creator Information', [
    ['brandName', 'Creator / Brand Name', 'text', req],
    [
        'type',
        'Creator Type',
        'select',
        { options: ['Designer', 'Author', 'Educator', 'Developer', 'Studio', 'Other'] },
    ],
    ['expertise', 'Expertise', 'textarea'],
    ['bio', 'Bio', 'textarea'],
    ['portfolio', 'Portfolio', 'url'],
    ['website', 'Website', 'url'],
    ['socialLinks', 'Social Links (one URL per line)', 'textarea'],
]);
categorySection('workshop', 'Host Profile', [
    ['instructor', 'Host / Instructor Name', 'text', req],
    ['businessName', 'Business Name'],
    ['photo', 'Profile Photo', 'file', { ...req, accept: 'image/jpeg,image/png,image/webp' }],
    ['bio', 'Bio', 'textarea', req],
    ['expertise', 'Expertise', 'textarea', req],
    ['experience', 'Years of Experience', 'number', { min: 0 }],
    [
        'certificates',
        'Certifications',
        'file',
        { multiple: true, accept: 'application/pdf,image/jpeg,image/png,image/webp' },
    ],
    ['socialLinks', 'Social Links (one URL per line)', 'textarea'],
    ['location', 'Host Location'],
]);
categorySection('event', 'Organizer Information', [
    ['organizerName', 'Organizer Name', 'text', req],
    ['organizationName', 'Organization Name'],
    ['type', 'Organizer Type', 'select', { options: ['Individual', 'Company', 'Community', 'NGO'] }],
    ['bio', 'Organizer Bio', 'textarea'],
    ['contact', 'Contact Person', 'text', req],
    ['phone', 'Phone', 'tel', req],
    ['email', 'Email', 'email', req],
    ['website', 'Website', 'url'],
    ['socialMedia', 'Social Media (one URL per line)', 'textarea'],
]);
add(4, 'idNumber', 'CNIC / identification number', 'text', req);
add(4, 'idFront', 'Identity document - front', 'file', {
    ...req,
    accept: 'application/pdf,image/jpeg,image/png,image/webp',
});
add(4, 'idBack', 'Identity document - back', 'file', {
    ...req,
    accept: 'application/pdf,image/jpeg,image/png,image/webp',
});
add(4, 'selfie', 'Identity selfie', 'file', { accept: 'image/jpeg,image/png,image/webp' });
add(4, 'registrationFile', 'Company registration certificate', 'file', {
    ...req,
    when: ['businessType', 'Company'],
    accept: 'application/pdf,image/jpeg,image/png',
});
add(4, 'ntn', 'NTN / tax number');
add(4, 'addressProof', 'Address proof', 'file', { accept: 'application/pdf,image/jpeg,image/png' });
add(5, 'payoutMethod', 'Payout method', 'select', {
    ...req,
    options: ['BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH'],
});
add(5, 'holderName', 'Account holder name', 'text', req);
add(5, 'bankName', 'Bank name', 'text', { ...req, when: ['payoutMethod', 'BANK_TRANSFER'] });
add(5, 'iban', 'Pakistan IBAN', 'text', { ...req, when: ['payoutMethod', 'BANK_TRANSFER'] });
add(5, 'walletNumber', 'Easypaisa mobile number', 'tel', { ...req, when: ['payoutMethod', 'EASYPAISA'] });
add(5, 'jazzcashNumber', 'JazzCash mobile number', 'tel', { ...req, when: ['payoutMethod', 'JAZZCASH'] });
add(5, 'invoice', 'I can issue invoices', 'checkbox');
add(6, 'supportEmail', 'Customer support email', 'email', req);
add(6, 'supportHours', 'Support hours', 'text', req);
add(6, 'responseHours', 'Response time (hours)', 'number', { ...req, min: 1, max: 168 });
add(6, 'bookingPolicy', 'Booking and cancellation policy', 'textarea', {
    ...req,
    categories: ['service', 'workshop', 'event'],
});
add(6, 'digitalAuto', 'Automatic digital delivery', 'checkbox', { categories: ['digital'] });
add(6, 'downloadLimit', 'Download limit per purchase', 'number', {
    ...req,
    categories: ['digital'],
    min: 1,
    max: 100,
});
add(6, 'downloadExpiry', 'Download expiry (days)', 'number', {
    ...req,
    categories: ['digital'],
    min: 1,
    max: 3650,
});
add(7, 'declaration', 'I confirm that the information and documents are accurate', 'checkbox', req);

add(6, 'serviceDeposit', 'Deposit required', 'checkbox', { categories: ['service'] });
add(6, 'depositAmount', 'Deposit (PKR)', 'number', {
    ...req,
    categories: ['service'],
    when: ['serviceDeposit', true],
    min: 1,
});
add(6, 'reschedulingPolicy', 'Rescheduling policy', 'textarea', {
    ...req,
    categories: ['service', 'workshop', 'event'],
});
add(6, 'supportPhone', 'Support / WhatsApp number', 'tel');
function visibleFields(answers, step) {
    const selected = Array.isArray(answers.categories) ? answers.categories : [];
    return fields.filter(
        f =>
            (step === undefined || f.step === step) &&
            (!f.categories || f.categories.some(c => selected.includes(c))) &&
            (!f.when || answers[f.when[0]] === f.when[1]) &&
            (!f.unless ||
                !(Array.isArray(f.unless[1]) ? f.unless[1] : [f.unless[1]]).includes(answers[f.unless[0]])),
    );
}
function preferredWhatsApp(answers) {
    const business = typeof answers.businessWhatsApp === 'string' ? answers.businessWhatsApp.trim() : '';
    const personal = typeof answers.whatsapp === 'string' ? answers.whatsapp.trim() : '';
    return business || personal;
}
function syncSupportPhone(answers, previous) {
    const preferred = preferredWhatsApp(answers);
    const current = typeof answers.supportPhone === 'string' ? answers.supportPhone.trim() : '';
    if (!previous)
        return preferred && !current ? { ...answers, supportPhone: preferred } : answers;
    const oldPreferred = preferredWhatsApp(previous);
    const oldSupport = typeof previous.supportPhone === 'string' ? previous.supportPhone.trim() : '';
    if (oldSupport && oldSupport !== oldPreferred) return answers;
    if (preferred) return { ...answers, supportPhone: preferred };
    if (oldSupport && oldSupport === oldPreferred) {
        const result = { ...answers };
        delete result.supportPhone;
        return result;
    }
    return answers;
}
const integerKeys = new Set([
    'establishedYear',
    'employees',
    'artisan_experience',
    'artisan_artisanCount',
    'service_experience',
    'service_maxBookings',
    'workshop_experience',
    'responseHours',
    'downloadLimit',
    'downloadExpiry',
    'quantity',
]);
function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function validIban(value) {
    const normalized = String(value).replace(/\s/g, '').toUpperCase();
    if (!/^PK\d{2}[A-Z]{4}\d{16}$/.test(normalized)) return false;
    const digits = (normalized.slice(4) + normalized.slice(0, 4)).replace(/[A-Z]/g, c =>
        String(c.charCodeAt(0) - 55),
    );
    let remainder = 0;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
    return remainder === 1;
}
function sanitizeAnswers(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new Error('Invalid application data');
    if (JSON.stringify(input).length > 90000) throw new Error('Application data is too large');
    const result = {};
    for (const f of fields) {
        const v = input[f.key];
        if (v === undefined || v === null || v === '') continue;
        if (f.type === 'repeater') {
            if (!Array.isArray(v) || v.length > 20) throw new Error(`Invalid ${f.label}`);
            result[f.key] = v.map(row => {
                if (!row || typeof row !== 'object' || Array.isArray(row))
                    throw new Error(`Invalid ${f.label}`);
                const values = {};
                for (const c of f.children) {
                    if (row[c.key] === undefined || row[c.key] === '') continue;
                    if (
                        c.type === 'number'
                            ? typeof row[c.key] !== 'number' || !Number.isFinite(row[c.key])
                            : typeof row[c.key] !== 'string' || row[c.key].length > 3000
                    )
                        throw new Error(`Invalid ${c.label}`);
                    values[c.key] = typeof row[c.key] === 'string' ? row[c.key].trim() : row[c.key];
                }
                return values;
            });
        } else if (f.type === 'checkbox') {
            if (typeof v !== 'boolean') throw new Error(`Invalid ${f.label}`);
            result[f.key] = v;
        } else if (f.type === 'multi' || (f.type === 'file' && f.multiple)) {
            if (
                !Array.isArray(v) ||
                v.length > (f.type === 'file' ? 8 : 20) ||
                v.some(x => typeof x !== 'string' || x.length > 100)
            )
                throw new Error(`Invalid ${f.label}`);
            result[f.key] = [...new Set(v)];
        } else if (f.type === 'number') {
            if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Invalid ${f.label}`);
            result[f.key] = v;
        } else {
            if (typeof v !== 'string' || v.length > (f.type === 'textarea' ? 3000 : 250))
                throw new Error(`Invalid ${f.label}`);
            result[f.key] = v.trim();
        }
    }
    // Hidden conditional answers must not survive a category or payout-method change.
    const allowed = new Set(visibleFields(result).map(f => f.key));
    return Object.fromEntries(Object.entries(result).filter(([key]) => allowed.has(key)));
}
function validate(answers, step) {
    const errors = {};
    for (const f of visibleFields(answers, step)) {
        const v = answers[f.key];
        const empty = v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);
        if (f.required && (empty || (f.type === 'checkbox' && v !== true))) {
            errors[f.key] = `${f.label} is required`;
            continue;
        }
        if (empty) continue;
        if (f.type === 'repeater') {
            if (!Array.isArray(v)) {
                errors[f.key] = 'Add valid entries';
                continue;
            }
            for (const row of v) {
                for (const c of f.children) {
                    const value = row[c.key];
                    if (c.required && (value === undefined || value === ''))
                        errors[f.key] = `${c.label} is required in every entry`;
                    if (
                        value !== undefined &&
                        c.type === 'number' &&
                        (typeof value !== 'number' ||
                            !Number.isFinite(value) ||
                            value < (c.min ?? 0) ||
                            value > 10000000 ||
                            (integerKeys.has(c.key) && !Number.isInteger(value)))
                    )
                        errors[f.key] = `Invalid ${c.label}`;
                    if (value && c.type === 'date' && !validDate(value)) errors[f.key] = `Invalid ${c.label}`;
                    if (value && c.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value))
                        errors[f.key] = `Invalid ${c.label}`;
                }
                if (row.start && row.end && row.end <= row.start)
                    errors[f.key] = 'End time must follow start time';
                if (row.salesStart && row.salesEnd && row.salesEnd < row.salesStart)
                    errors[f.key] = 'Ticket sales end must follow sales start';
            }
        }
        if (f.options && (Array.isArray(v) ? v : [v]).some(x => !f.options.includes(x) && !f.legacyOptions?.includes(x)))
            errors[f.key] = 'Choose a valid option';
        if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
            errors[f.key] = 'Enter a valid email';
        if (f.type === 'url') {
            try {
                if (!['http:', 'https:'].includes(new URL(v).protocol)) throw new Error();
            } catch {
                errors[f.key] = 'Enter an HTTP or HTTPS URL';
            }
        }
        if (f.type === 'tel' && (!/^\+?[\d ()-]{7,22}$/.test(v) || String(v).replace(/\D/g, '').length < 7))
            errors[f.key] = 'Enter a valid mobile number';
        if (
            f.type === 'number' &&
            (typeof v !== 'number' ||
                !Number.isFinite(v) ||
                v < (f.min ?? 0) ||
                v > (f.max ?? 10000000) ||
                (integerKeys.has(f.key) && !Number.isInteger(v)))
        )
            errors[f.key] = 'Enter a number within the allowed range';
        if (f.type === 'date' && !validDate(v)) errors[f.key] = 'Enter a valid date';
        if (f.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) errors[f.key] = 'Enter a valid time';
        if (f.type === 'file' && (Array.isArray(v) ? v : [v]).some(x => !/^[a-zA-Z0-9-]{1,64}$/.test(x)))
            errors[f.key] = 'Upload a valid file';
    }
    if (
        (step === undefined || step === 5) &&
        answers.payoutMethod === 'BANK_TRANSFER' &&
        answers.iban &&
        !validIban(answers.iban)
    )
        errors.iban = 'Enter a valid 24-character Pakistan IBAN';
    for (const [key, fieldStep] of [
        ['socialLinks', 1],
        ['digital_socialLinks', 3],
        ['workshop_socialLinks', 3],
        ['event_socialMedia', 3],
    ]) {
        if (
            (step === undefined || step === fieldStep) &&
            answers[key] &&
            String(answers[key])
                .split(/\n/)
                .map(link => link.trim())
                .filter(Boolean)
                .some(link => {
                    try {
                        return !['http:', 'https:'].includes(new URL(link).protocol);
                    } catch {
                        return true;
                    }
                })
        )
            errors[key] = 'Use HTTP or HTTPS social URLs, one per line';
    }
    return errors;
}
function completeness(answers) {
    const visible = visibleFields(answers);
    const required = visible.filter(f => f.required);
    const errors = validate(answers);
    const invalidOptional = visible.filter(f => !f.required && errors[f.key]).length;
    const complete = required.filter(f => !errors[f.key]).length;
    const total = required.length + invalidOptional;
    const percent = total ? Math.round((complete / total) * 100) : 100;
    return { complete, total, percent: Object.keys(errors).length ? Math.min(percent, 99) : percent };
}
function categoryAccessFields(answers) {
    const visible = new Set(visibleFields(answers).map(field => field.key));
    return fields.filter(field => {
        if (!visible.has(field.key)) return false;
        if (field.key === 'businessType' || field.key === 'registrationNumber') return true;
        if (field.step === 3 || field.step === 4) return true;
        return field.step === 6 && Array.isArray(field.categories) && field.categories.length > 0;
    });
}
function sanitizeCategoryAccessAnswers(input, categoryIds) {
    const selected = [...new Set((Array.isArray(categoryIds) ? categoryIds : []).map(String))];
    if (!selected.length || selected.some(id => !categories.some(category => category.id === id))) {
        throw new Error('Choose valid core marketplace categories');
    }
    const sanitized = sanitizeAnswers({ ...(input && typeof input === 'object' ? input : {}), categories: selected });
    const allowed = new Set(categoryAccessFields(sanitized).map(field => field.key));
    return Object.fromEntries([
        ['categories', selected],
        ...Object.entries(sanitized).filter(([key]) => allowed.has(key)),
    ]);
}
function validateCategoryAccessAnswers(answers) {
    const errors = validate(answers);
    const allowed = new Set(categoryAccessFields(answers).map(field => field.key));
    return Object.fromEntries(Object.entries(errors).filter(([key]) => allowed.has(key)));
}
module.exports = {
    steps,
    categories,
    fields,
    visibleFields,
    syncSupportPhone,
    sanitizeAnswers,
    validate,
    completeness,
    categoryAccessFields,
    sanitizeCategoryAccessAnswers,
    validateCategoryAccessAnswers,
};
