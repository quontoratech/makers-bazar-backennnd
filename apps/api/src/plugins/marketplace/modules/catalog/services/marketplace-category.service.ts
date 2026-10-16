import { normalizeString } from '@vendure/common/lib/normalize-string';
import { Injectable } from '@nestjs/common';
import { Product, RequestContext, TransactionalConnection } from '@vendure/core';

import {
    legacyMarketplaceCategoryAliases,
    marketplaceCategoryAttributeSeeds,
    marketplaceCategoryHierarchy,
    MarketplaceCategorySeedNode,
    marketplaceCategorySlug,
} from '../config/category-hierarchy-seed';
import { marketplaceBehaviorProductType, marketplaceFormTemplateSeeds } from '../config/form-template-seeds';
import {
    CreateMarketplaceCategoryInput,
    CreateMarketplaceFormTemplateInput,
    CreateMarketplaceProductInput,
    UpdateMarketplaceCategoryInput,
    UpdateMarketplaceFormTemplateInput,
    UpsertMarketplaceCategoryFieldInput,
} from '../dto/marketplace-product.inputs';
import { MarketplaceCategoryField } from '../entities/marketplace-category-field.entity';
import { MarketplaceCategory } from '../entities/marketplace-category.entity';
import {
    MarketplaceDynamicFieldDefinition,
    MarketplaceDynamicFieldType,
    MarketplaceFormTemplate,
    MarketplaceListingType,
} from '../entities/marketplace-form-template.entity';
import { MarketplaceListingCategory } from '../entities/marketplace-listing-category.entity';

const fieldTypes = new Set<MarketplaceDynamicFieldType>([
    'TEXT', 'TEXTAREA', 'NUMBER', 'DECIMAL', 'CURRENCY', 'SELECT', 'MULTI_SELECT', 'CHECKBOX', 'RADIO',
    'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'IMAGE', 'MULTIPLE_IMAGES', 'FILE', 'MULTIPLE_FILES', 'VIDEO',
    'RICH_TEXT', 'ADDRESS', 'COORDINATES', 'REPEATER', 'VARIANT_BUILDER',
]);
const listingTypes = new Set([
    'PHYSICAL_PRODUCT', 'ARTISAN_PRODUCT', 'FOOD_PRODUCT', 'DIGITAL_PRODUCT', 'SERVICE', 'WORKSHOP_EXPERIENCE', 'EVENT',
]);
const mandatoryTemplateFieldKeys: Record<MarketplaceListingType, string[]> = {
    PHYSICAL_PRODUCT: ['product_name', 'description', 'category', 'condition', 'quantity_available', 'price', 'product_images'],
    ARTISAN_PRODUCT: ['product_name', 'description', 'category', 'materials', 'dimensions', 'price', 'product_images'],
    FOOD_PRODUCT: ['product_name', 'description', 'category', 'ingredients', 'allergen_information', 'shelf_life', 'storage_instructions', 'price', 'product_images', 'product_video'],
    SERVICE: ['product_name', 'description', 'category', 'included', 'service_duration', 'starting_price', 'pricing_model'],
    DIGITAL_PRODUCT: ['product_name', 'category', 'description', 'included', 'file_type', 'license_type', 'main_file', 'preview_images', 'thumbnail', 'rights_confirmed', 'price'],
    WORKSHOP_EXPERIENCE: ['product_name', 'category', 'description', 'participants_learn', 'age_group', 'duration', 'date', 'start_time', 'end_time', 'sessions', 'price_per_person', 'cancellation_policy', 'refund_policy'],
    EVENT: ['product_name', 'category', 'description', 'event_type', 'event_banner', 'event_date', 'start_time', 'end_time', 'venue_name', 'address', 'city', 'map_coordinates', 'ticket_types', 'cancellation_policy', 'refund_policy'],
};

export interface MarketplaceResolvedFormSchema {
    category: MarketplaceCategory & { breadcrumb: string[]; level: number };
    formTemplate: MarketplaceFormTemplate;
    fields: MarketplaceDynamicFieldDefinition[];
}

@Injectable()
export class MarketplaceCategoryService {
    constructor(private connection: TransactionalConnection) {}

    async ensureSeeded(ctx: RequestContext) {
        const templateRepository = this.connection.getRepository(ctx, MarketplaceFormTemplate);
        const templateByKey = new Map<string, MarketplaceFormTemplate>();
        for (const seed of marketplaceFormTemplateSeeds) {
            let template = await templateRepository.findOne({ where: { key: seed.key } });
            if (!template) {
                const created = new MarketplaceFormTemplate();
                Object.assign(created, {
                    key: seed.key,
                    name: seed.name,
                    listingType: seed.listingType,
                    version: seed.revision ?? 1,
                    isActive: true,
                    schema: seed.schema,
                });
                template = await templateRepository.save(created);
            } else if (template.version < (seed.revision ?? 1)) {
                template.name = seed.name;
                template.listingType = seed.listingType;
                template.schema = seed.schema;
                template.version = seed.revision ?? 1;
                template = await templateRepository.save(template);
            }
            templateByKey.set(seed.key, template);
        }

        const categoryRepository = this.connection.getRepository(ctx, MarketplaceCategory);
        const ensureNodes = async (
            nodes: MarketplaceCategorySeedNode[],
            parent: MarketplaceCategory | undefined,
            parentCode: string,
        ) => {
            for (const [index, seed] of nodes.entries()) {
                const slug = marketplaceCategorySlug(seed.name);
                const code = parentCode ? `${parentCode}/${slug}` : slug;
                let category = await categoryRepository.findOne({ where: { code } });
                let migratedLegacyCategory = false;
                if (!category && seed.legacyCode) {
                    category = await categoryRepository.findOne({ where: { code: seed.legacyCode } });
                    if (category) {
                        category.code = code;
                        category.slug = slug;
                        category.name = seed.name;
                        category.parentId = parent ? String(parent.id) : undefined;
                        category.description = seed.description ?? category.description;
                        category.sortOrder = index;
                        category.chatEnabled = seed.chatEnabled === true;
                        category.formTemplateId = seed.templateKey
                            ? String(templateByKey.get(seed.templateKey)?.id ?? '') || undefined
                            : category.formTemplateId;
                        migratedLegacyCategory = true;
                    }
                }
                if (!category) {
                    category = await categoryRepository.save(new MarketplaceCategory({
                        code,
                        slug,
                        name: seed.name,
                        parentId: parent ? String(parent.id) : undefined,
                        description: seed.description ?? '',
                        sortOrder: index,
                        isActive: true,
                        chatEnabled: seed.chatEnabled === true,
                        formTemplateId: seed.templateKey ? String(templateByKey.get(seed.templateKey)?.id ?? '') || undefined : undefined,
                    }));
                } else if (migratedLegacyCategory) {
                    category = await categoryRepository.save(category);
                } else if (seed.chatEnabled === true && !category.formTemplateId) {
                    category.chatEnabled = true;
                    category.description = seed.description ?? category.description;
                    category.formTemplateId = seed.templateKey
                        ? String(templateByKey.get(seed.templateKey)?.id ?? '') || undefined
                        : category.formTemplateId;
                    category = await categoryRepository.save(category);
                }
                await ensureNodes(seed.children ?? [], category, code);
            }
        };
        await ensureNodes(marketplaceCategoryHierarchy, undefined, '');

        const categoryFieldRepository = this.connection.getRepository(ctx, MarketplaceCategoryField);
        for (const [code, fields] of Object.entries(marketplaceCategoryAttributeSeeds)) {
            const category = await categoryRepository.findOne({ where: { code } });
            if (!category) continue;
            for (const [index, definition] of fields.entries()) {
                const exists = await categoryFieldRepository.findOne({
                    where: { categoryId: String(category.id), fieldKey: definition.key },
                });
                if (exists) continue;
                const created = new MarketplaceCategoryField();
                Object.assign(created, {
                    categoryId: String(category.id),
                    fieldKey: definition.key,
                    label: definition.label,
                    inputType: definition.type,
                    required: definition.required ?? false,
                    section: definition.section ?? 'Category attributes',
                    helpText: definition.helpText,
                    placeholder: definition.placeholder,
                    unit: definition.unit,
                    options: definition.options,
                    validation: definition.validation,
                    ui: definition.ui,
                    condition: definition.condition,
                    sortOrder: definition.sortOrder ?? index,
                    isActive: true,
                    overrideMode: 'REPLACE',
                });
                await categoryFieldRepository.save(created);
            }
        }
    }

    async listTemplates(ctx: RequestContext, includeInactive = false) {
        const templates = await this.connection.getRepository(ctx, MarketplaceFormTemplate).find({
            order: { name: 'ASC' },
        });
        return includeInactive ? templates : templates.filter(template => template.isActive);
    }

    async categoryTree(ctx: RequestContext, includeInactive = false) {
        const categories = await this.connection.getRepository(ctx, MarketplaceCategory).find({
            order: { sortOrder: 'ASC', name: 'ASC' },
        });
        const templates = await this.listTemplates(ctx, true);
        const templateById = new Map(templates.map(template => [String(template.id), template]));
        const included = categories.filter(category => includeInactive || category.isActive);
        const byId = new Map(included.map(category => [String(category.id), category]));
        const childrenByParent = new Map<string, MarketplaceCategory[]>();
        for (const category of included) {
            const parentId = category.parentId ? String(category.parentId) : '';
            const children = childrenByParent.get(parentId) ?? [];
            children.push(category);
            childrenByParent.set(parentId, children);
        }
        const mapNode = (
            category: MarketplaceCategory,
            breadcrumb: string[],
            inheritedTemplate: MarketplaceFormTemplate | null = null,
        ): Record<string, unknown> => {
            const nextBreadcrumb = [...breadcrumb, category.name];
            const assignedFormTemplate = category.formTemplateId
                ? templateById.get(String(category.formTemplateId)) ?? null
                : null;
            const effectiveFormTemplate = assignedFormTemplate ?? inheritedTemplate;
            return {
                ...category,
                id: String(category.id),
                parentId: category.parentId ? String(category.parentId) : null,
                formTemplateId: category.formTemplateId ? String(category.formTemplateId) : null,
                assignedFormTemplate,
                effectiveFormTemplate,
                breadcrumb: nextBreadcrumb,
                level: breadcrumb.length,
                children: (childrenByParent.get(String(category.id)) ?? []).map(child => mapNode(child, nextBreadcrumb, effectiveFormTemplate)),
            };
        };
        return (childrenByParent.get('') ?? [])
            .filter(category => !category.parentId || byId.has(String(category.parentId)))
            .map(category => mapNode(category, []));
    }

    async flatCategories(ctx: RequestContext, includeInactive = false) {
        const tree = await this.categoryTree(ctx, includeInactive);
        const result: Array<Record<string, unknown>> = [];
        const visit = (nodes: Array<Record<string, unknown>>) => {
            for (const node of nodes) {
                result.push(node);
                visit((node.children as Array<Record<string, unknown>> | undefined) ?? []);
            }
        };
        visit(tree);
        return result;
    }

    async resolveCategory(ctx: RequestContext, categoryId?: string, categoryCode?: string, requireActive = true) {
        const repository = this.connection.getRepository(ctx, MarketplaceCategory);
        let category = categoryId ? await repository.findOne({ where: { id: categoryId } }) : null;
        if (!category && categoryCode) {
            const code = legacyMarketplaceCategoryAliases[categoryCode] ?? categoryCode;
            category = await repository.findOne({ where: { code } });
        }
        if (!category) throw new Error('Choose a valid marketplace category');
        if (requireActive && !category.isActive) throw new Error('The selected category is not active');
        const chain = await this.categoryChain(ctx, category);
        if (requireActive && chain.some(item => !item.isActive)) {
            throw new Error('The selected category is unavailable because a parent category is inactive');
        }
        return category;
    }

    async resolvedForm(ctx: RequestContext, categoryId: string, requireActive = true): Promise<MarketplaceResolvedFormSchema> {
        const category = await this.resolveCategory(ctx, categoryId, undefined, requireActive);
        const chainLeafToRoot = await this.categoryChain(ctx, category);
        const assigned = chainLeafToRoot.find(item => item.formTemplateId);
        if (!assigned?.formTemplateId) throw new Error('This category does not resolve to a form template');
        const formTemplate = await this.connection.getRepository(ctx, MarketplaceFormTemplate).findOne({
            where: { id: assigned.formTemplateId },
        });
        if (!formTemplate || (requireActive && !formTemplate.isActive)) {
            throw new Error('The form template assigned to this category is unavailable');
        }

        const chain = [...chainLeafToRoot].reverse();
        const categoryIds = chain.map(item => String(item.id));
        const categoryFields = await this.connection.getRepository(ctx, MarketplaceCategoryField)
            .createQueryBuilder('field')
            .where('field.categoryId IN (:...categoryIds)', { categoryIds })
            .orderBy('field.sortOrder', 'ASC')
            .addOrderBy('field.id', 'ASC')
            .getMany();
        const fields = new Map(formTemplate.schema.map(definition => [definition.key, { ...definition }]));
        for (const ancestor of chain) {
            const overrides = categoryFields.filter(item => String(item.categoryId) === String(ancestor.id));
            for (const override of overrides) {
                if (!override.isActive) continue;
                if (override.overrideMode === 'HIDE') {
                    fields.delete(override.fieldKey);
                    continue;
                }
                const existing = fields.get(override.fieldKey);
                fields.set(override.fieldKey, {
                    ...existing,
                    key: override.fieldKey,
                    label: override.label,
                    type: override.inputType,
                    required: override.required,
                    section: override.section,
                    helpText: override.helpText,
                    placeholder: override.placeholder,
                    unit: override.unit,
                    options: override.options ?? existing?.options,
                    validation: override.validation == null
                        ? existing?.validation
                        : { ...existing?.validation, ...override.validation },
                    ui: override.ui == null ? existing?.ui : { ...existing?.ui, ...override.ui },
                    condition: override.condition == null
                        ? existing?.condition
                        : { ...existing?.condition, ...override.condition },
                    sortOrder: override.sortOrder,
                });
            }
        }
        const sectionOrder = new Map<string, number>();
        for (const definition of [...formTemplate.schema, ...fields.values()]) {
            const section = definition.section ?? 'Details';
            if (!sectionOrder.has(section)) sectionOrder.set(section, sectionOrder.size);
        }
        const orderedFields = [...fields.values()].sort((left, right) => (
            (sectionOrder.get(left.section ?? 'Details') ?? 999) - (sectionOrder.get(right.section ?? 'Details') ?? 999)
            || (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
            || left.label.localeCompare(right.label)
        ));
        return {
            category: Object.assign(category, {
                breadcrumb: chain.map(item => item.name),
                level: chain.length - 1,
                children: [],
                assignedFormTemplate: category.formTemplateId
                    ? await this.connection.getRepository(ctx, MarketplaceFormTemplate).findOne({ where: { id: category.formTemplateId } })
                    : null,
                effectiveFormTemplate: formTemplate,
            }),
            formTemplate,
            fields: orderedFields,
        };
    }

    async resolveAndValidateListing(ctx: RequestContext, input: CreateMarketplaceProductInput) {
        const category = await this.resolveCategory(ctx, input.categoryId, input.categoryCode, true);
        const schema = await this.resolvedForm(ctx, String(category.id), true);
        const values = this.listingValues(input);
        const errors: string[] = [];
        for (const definition of schema.fields) {
            if (!this.conditionMatches(definition.condition, values)) continue;
            const value = this.valueForDefinition(definition, input, values);
            const required = definition.required || this.requiredWhenMatches(definition.validation, values);
            if (required && this.isEmpty(value)) {
                errors.push(`${definition.label} is required`);
                continue;
            }
            if (!this.isEmpty(value)) this.validateFieldValue(definition, value, values, errors);
        }
        this.validateStructuredListing(schema.formTemplate.listingType, input, values, errors);
        if (errors.length) throw new Error(errors.slice(0, 8).join('. '));
        return { category: schema.category, schema, fieldValues: this.normalizedFieldValues(schema.fields, values) };
    }

    async createCategory(ctx: RequestContext, input: CreateMarketplaceCategoryInput) {
        const name = input.name?.trim();
        if (!name || name.length < 2) throw new Error('Category name must contain at least 2 characters');
        const parent = input.parentId ? await this.resolveCategory(ctx, input.parentId, undefined, false) : undefined;
        const slug = normalizeString(input.slug?.trim() || name, '-');
        if (!slug) throw new Error('Category slug is invalid');
        const repository = this.connection.getRepository(ctx, MarketplaceCategory);
        const conflict = await repository.findOne({ where: { parentId: parent ? String(parent.id) : undefined, slug } });
        if (conflict) throw new Error('A category with this slug already exists under the selected parent');
        if (input.formTemplateId) await this.requireTemplate(ctx, input.formTemplateId);
        if (!parent && input.isActive !== false && !input.formTemplateId) {
            throw new Error('An active root category must have a form template');
        }
        const codeBase = parent ? `${parent.code}/${slug}` : slug;
        let code = codeBase;
        let suffix = 2;
        while (await repository.findOne({ where: { code } })) code = `${codeBase}-${suffix++}`;
        const category = await repository.save(new MarketplaceCategory({
            code,
            slug,
            name,
            parentId: parent ? String(parent.id) : undefined,
            description: input.description?.trim() ?? '',
            icon: input.icon?.trim() || undefined,
            imageAssetId: input.imageAssetId || undefined,
            sortOrder: this.nonNegativeInteger(input.sortOrder, 0),
            isActive: input.isActive !== false,
            chatEnabled: input.chatEnabled === true,
            formTemplateId: input.formTemplateId || undefined,
        }));
        return this.resolvedCategoryNode(ctx, category);
    }

    async updateCategory(ctx: RequestContext, input: UpdateMarketplaceCategoryInput) {
        const category = await this.resolveCategory(ctx, input.id, undefined, false);
        if (input.parentId !== undefined) {
            if (String(input.parentId) === String(category.id)) throw new Error('A category cannot be its own parent');
            if (input.parentId) {
                const parent = await this.resolveCategory(ctx, input.parentId, undefined, false);
                const parentChain = await this.categoryChain(ctx, parent);
                if (parentChain.some(item => String(item.id) === String(category.id))) {
                    throw new Error('A category cannot be moved beneath one of its descendants');
                }
                category.parentId = String(parent.id);
            } else {
                category.parentId = undefined;
            }
        }
        if (input.name !== undefined) {
            if (input.name.trim().length < 2) throw new Error('Category name must contain at least 2 characters');
            category.name = input.name.trim();
        }
        if (input.slug !== undefined) {
            const slug = normalizeString(input.slug.trim(), '-');
            if (!slug) throw new Error('Category slug is invalid');
            category.slug = slug;
        }
        if (input.formTemplateId) {
            await this.requireTemplate(ctx, input.formTemplateId);
            category.formTemplateId = input.formTemplateId;
        } else if (input.inheritFormTemplate || input.formTemplateId === '') {
            category.formTemplateId = undefined;
        }
        if (input.description !== undefined) category.description = input.description.trim();
        if (input.icon !== undefined) category.icon = input.icon.trim() || undefined;
        if (input.imageAssetId !== undefined) category.imageAssetId = input.imageAssetId || undefined;
        if (input.sortOrder !== undefined) category.sortOrder = this.nonNegativeInteger(input.sortOrder, 0);
        if (input.isActive !== undefined) category.isActive = input.isActive;
        if (input.chatEnabled !== undefined) category.chatEnabled = input.chatEnabled;
        await this.connection.getRepository(ctx, MarketplaceCategory).save(category, { reload: false });
        const resolved = await this.resolvedCategoryNode(ctx, category);
        if (category.isActive && !resolved.effectiveFormTemplate) {
            throw new Error('An active category must inherit or assign a form template');
        }
        return resolved;
    }

    async reorderCategories(ctx: RequestContext, parentId: string | undefined, categoryIds: string[]) {
        if (new Set(categoryIds.map(String)).size !== categoryIds.length) throw new Error('Each category can appear only once');
        const repository = this.connection.getRepository(ctx, MarketplaceCategory);
        const siblings = await repository.find({ where: { parentId: parentId || undefined } });
        const siblingIds = new Set(siblings.map(item => String(item.id)));
        if (categoryIds.some(id => !siblingIds.has(String(id)))) throw new Error('All reordered categories must share the same parent');
        for (let index = 0; index < categoryIds.length; index++) {
            const category = siblings.find(item => String(item.id) === String(categoryIds[index]));
            if (category) {
                category.sortOrder = index;
                await repository.save(category, { reload: false });
            }
        }
        return this.categoryTree(ctx, true);
    }

    async deleteCategory(ctx: RequestContext, id: string) {
        const category = await this.resolveCategory(ctx, id, undefined, false);
        const repository = this.connection.getRepository(ctx, MarketplaceCategory);
        const child = await repository.findOne({ where: { parentId: String(category.id) } });
        if (child) throw new Error('Move or deactivate child categories before deleting this category');
        const listing = await this.connection.getRepository(ctx, MarketplaceListingCategory).findOne({
            where: { categoryId: String(category.id) },
        });
        if (listing) throw new Error('This category is used by listings. Deactivate it to preserve historical records');
        const legacyListing = (await this.connection.getRepository(ctx, Product).find()).find(product => {
            const rawMetadata = (product.customFields as Record<string, unknown> | undefined)?.marketplaceMetadata;
            if (typeof rawMetadata !== 'string') return false;
            try {
                const metadata = JSON.parse(rawMetadata) as { categoryId?: string; categoryCode?: string };
                const categoryCode = metadata.categoryCode
                    ? legacyMarketplaceCategoryAliases[metadata.categoryCode] ?? metadata.categoryCode
                    : undefined;
                return String(metadata.categoryId ?? '') === String(category.id) || categoryCode === category.code;
            } catch {
                return false;
            }
        });
        if (legacyListing) throw new Error('This category is used by a legacy listing. Deactivate it to preserve historical records');
        await this.connection.getRepository(ctx, MarketplaceCategoryField).delete({ categoryId: String(category.id) });
        await repository.remove(category);
        return { success: true, message: `${category.name} was deleted` };
    }

    async categoryFields(ctx: RequestContext, categoryId: string) {
        await this.resolveCategory(ctx, categoryId, undefined, false);
        return this.connection.getRepository(ctx, MarketplaceCategoryField).find({
            where: { categoryId },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
    }

    async upsertCategoryField(ctx: RequestContext, input: UpsertMarketplaceCategoryFieldInput) {
        await this.resolveCategory(ctx, input.categoryId, undefined, false);
        const schema = await this.resolvedForm(ctx, input.categoryId, false);
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(input.fieldKey)) {
            throw new Error('Field key must use 2-64 lowercase letters, numbers, or underscores and start with a letter');
        }
        const inputType = input.inputType.toUpperCase() as MarketplaceDynamicFieldType;
        if (!fieldTypes.has(inputType)) throw new Error('Choose a supported field input type');
        if (['SELECT', 'MULTI_SELECT', 'RADIO'].includes(inputType) && !(input.options?.length)) {
            throw new Error('Select and radio fields need at least one option');
        }
        const mandatory = mandatoryTemplateFieldKeys[schema.formTemplate.listingType].includes(input.fieldKey);
        if (mandatory && (input.overrideMode === 'HIDE' || input.required !== true)) {
            throw new Error(`${input.fieldKey} is mandatory for ${schema.formTemplate.name} listings and cannot be hidden or optional`);
        }
        const canonical = this.canonicalMandatoryField(schema.formTemplate.listingType, input.fieldKey);
        if (mandatory && canonical && canonical.type !== inputType) {
            throw new Error(`${input.fieldKey} must remain a ${canonical.type} field`);
        }
        const canonicalSource = canonical?.ui?.source;
        if (mandatory && typeof canonicalSource === 'string' && input.ui?.source != null && input.ui.source !== canonicalSource) {
            throw new Error(`${input.fieldKey} must remain connected to its ${canonicalSource} listing value`);
        }
        const repository = this.connection.getRepository(ctx, MarketplaceCategoryField);
        let entity = input.id ? await repository.findOne({ where: { id: input.id } }) : null;
        entity = entity ?? await repository.findOne({ where: { categoryId: input.categoryId, fieldKey: input.fieldKey } });
        if (entity && String(entity.categoryId) !== String(input.categoryId)) throw new Error('Category field does not belong to this category');
        entity = entity ?? new MarketplaceCategoryField({ categoryId: input.categoryId, fieldKey: input.fieldKey });
        Object.assign(entity, {
            fieldKey: input.fieldKey,
            label: input.label.trim(),
            inputType,
            required: input.required === true,
            section: input.section?.trim() || 'Details',
            helpText: input.helpText?.trim() || undefined,
            placeholder: input.placeholder?.trim() || undefined,
            unit: input.unit?.trim() || undefined,
            options: input.options?.map(option => option.trim()).filter(Boolean),
            validation: input.validation,
            ui: input.ui,
            condition: input.condition,
            sortOrder: this.nonNegativeInteger(input.sortOrder, 0),
            isActive: input.isActive !== false,
            overrideMode: input.overrideMode ?? 'REPLACE',
        });
        if (!entity.label) throw new Error('Field label is required');
        return repository.save(entity);
    }

    async deleteCategoryField(ctx: RequestContext, id: string) {
        const repository = this.connection.getRepository(ctx, MarketplaceCategoryField);
        const field = await repository.findOne({ where: { id } });
        if (!field) throw new Error('Category field not found');
        await repository.remove(field);
        return { success: true, message: `${field.label} was deleted` };
    }

    async updateTemplate(ctx: RequestContext, input: UpdateMarketplaceFormTemplateInput) {
        const template = await this.requireTemplate(ctx, input.id);
        if (input.name !== undefined) {
            if (input.name.trim().length < 2) throw new Error('Template name must contain at least 2 characters');
            template.name = input.name.trim();
        }
        if (input.isActive !== undefined) template.isActive = input.isActive;
        if (input.schema !== undefined) {
            const schema = input.schema.map((raw, index) => this.validateTemplateField(raw, index));
            this.validateMandatoryTemplateFields(template.listingType, schema);
            template.schema = schema;
            template.version += 1;
        }
        return this.connection.getRepository(ctx, MarketplaceFormTemplate).save(template);
    }

    async createTemplate(ctx: RequestContext, input: CreateMarketplaceFormTemplateInput) {
        const name = input.name?.trim();
        const key = normalizeString(input.key?.trim() || name || '', '_');
        if (!name || name.length < 2) throw new Error('Template name must contain at least 2 characters');
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(key)) throw new Error('Template key must use lowercase letters, numbers, and underscores');
        if (!listingTypes.has(input.listingType)) throw new Error('Choose one of the seven supported listing types');
        if (!Array.isArray(input.schema) || !input.schema.length) throw new Error('A form template needs at least one field');
        const repository = this.connection.getRepository(ctx, MarketplaceFormTemplate);
        if (await repository.findOne({ where: { key } })) throw new Error('A form template with this key already exists');
        const template = new MarketplaceFormTemplate();
        template.key = key;
        template.name = name;
        template.listingType = input.listingType;
        template.version = 1;
        template.isActive = input.isActive !== false;
        template.schema = input.schema.map((raw, index) => this.validateTemplateField(raw, index));
        this.validateMandatoryTemplateFields(template.listingType, template.schema);
        return repository.save(template);
    }

    normalizedFieldValues(fields: MarketplaceDynamicFieldDefinition[], values: Record<string, unknown>) {
        const allowed = new Set(fields.filter(field => !field.ui?.source).map(field => field.key));
        return Object.fromEntries(Object.entries(values).filter(([key, value]) => allowed.has(key) && !this.isEmpty(value)));
    }

    behaviorProductType(template: MarketplaceFormTemplate) {
        return marketplaceBehaviorProductType(template.listingType);
    }

    private async categoryChain(ctx: RequestContext, leaf: MarketplaceCategory) {
        const repository = this.connection.getRepository(ctx, MarketplaceCategory);
        const result = [leaf];
        const visited = new Set([String(leaf.id)]);
        let current = leaf;
        while (current.parentId) {
            const parent = await repository.findOne({ where: { id: current.parentId } });
            if (!parent) throw new Error(`Category ${current.name} has a missing parent`);
            if (visited.has(String(parent.id))) throw new Error('The category hierarchy contains a cycle');
            visited.add(String(parent.id));
            result.push(parent);
            current = parent;
        }
        return result;
    }

    private async resolvedCategoryNode(ctx: RequestContext, category: MarketplaceCategory) {
        const chain = [...await this.categoryChain(ctx, category)].reverse();
        let effectiveFormTemplate: MarketplaceFormTemplate | null = null;
        for (let index = chain.length - 1; index >= 0; index--) {
            const node = chain[index];
            if (node?.formTemplateId) {
                effectiveFormTemplate = await this.connection.getRepository(ctx, MarketplaceFormTemplate).findOne({
                    where: { id: node.formTemplateId },
                });
                break;
            }
        }
        return {
            ...category,
            id: String(category.id),
            parentId: category.parentId ? String(category.parentId) : null,
            formTemplateId: category.formTemplateId ? String(category.formTemplateId) : null,
            breadcrumb: chain.map(item => item.name),
            level: chain.length - 1,
            effectiveFormTemplate,
        };
    }

    private async requireTemplate(ctx: RequestContext, id: string) {
        const template = await this.connection.getRepository(ctx, MarketplaceFormTemplate).findOne({ where: { id } });
        if (!template) throw new Error('Form template not found');
        return template;
    }

    private listingValues(input: CreateMarketplaceProductInput) {
        return { ...(input.attributes ?? {}) };
    }

    private valueForDefinition(
        definition: MarketplaceDynamicFieldDefinition,
        input: CreateMarketplaceProductInput,
        values: Record<string, unknown>,
    ) {
        const sourceName = typeof definition.ui?.source === 'string' ? definition.ui.source : undefined;
        if (!sourceName) return values[definition.key];
        if (sourceName === 'category') return input.categoryId ?? input.categoryCode;
        if (sourceName === 'name') return input.name;
        if (sourceName === 'description') return input.description;
        if (sourceName === 'brand') return input.brand;
        if (sourceName === 'price') return input.variants?.[0]?.compareAtPrice ?? input.variants?.[0]?.price;
        if (sourceName === 'salePrice') return input.variants?.[0]?.compareAtPrice ? input.variants[0].price : undefined;
        if (sourceName === 'sku') return input.variants?.[0]?.sku;
        if (sourceName === 'stock') return input.variants?.reduce((total, item) => total + item.stockOnHand, 0);
        if (sourceName === 'images') return input.assetIds;
        if (sourceName === 'video') return input.stylingVideoUrl;
        if (sourceName === 'variants') return input.variants;
        if (sourceName === 'servicePackages') return input.servicePackages;
        if (sourceName === 'serviceAddOns') return input.serviceAddOns;
        if (sourceName === 'availabilitySessions') {
            const sessions = input.availabilitySessions ?? [];
            if (definition.key === 'class_days') return [...new Set(sessions.flatMap(session => session.daysOfWeek ?? []))];
            if (definition.key === 'daily_start_time') return sessions[0]?.startTime;
            if (definition.key === 'daily_end_time') return sessions[0]?.endTime;
            if (definition.key === 'subscription_capacity') return sessions[0]?.capacity;
            return sessions;
        }
        if (sourceName === 'eventTicketTypes') return input.eventTicketTypes;
        if (sourceName === 'eventScheduleItems') return input.eventScheduleItems;
        if (sourceName === 'digitalFiles') {
            if (definition.key === 'main_file') return input.digitalFiles?.filter(file => (file.kind ?? 'MAIN') === 'MAIN');
            if (definition.key === 'preview_pdf') return input.digitalFiles?.filter(file => file.kind === 'PREVIEW' && file.fileName.toLowerCase().endsWith('.pdf'));
            if (definition.key === 'license_documentation') return input.digitalFiles?.filter(file => file.kind === 'LICENSE_DOCUMENT');
            return input.digitalFiles;
        }
        return values[definition.key];
    }

    private conditionMatches(condition: Record<string, unknown> | undefined, values: Record<string, unknown>) {
        if (!condition || typeof condition.field !== 'string') return true;
        const actual = values[condition.field];
        if ('equals' in condition) return actual === condition.equals;
        if (Array.isArray(condition.in)) return condition.in.includes(actual);
        if ('notEquals' in condition) return actual !== condition.notEquals;
        return true;
    }

    private requiredWhenMatches(validation: Record<string, unknown> | undefined, values: Record<string, unknown>) {
        const rule = validation?.requiredWhen;
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
        const object = rule as Record<string, unknown>;
        return typeof object.field === 'string' && values[object.field] === object.equals;
    }

    private validateFieldValue(
        definition: MarketplaceDynamicFieldDefinition,
        value: unknown,
        values: Record<string, unknown>,
        errors: string[],
    ) {
        const rules = definition.validation ?? {};
        const arrayTypes = ['MULTI_SELECT', 'MULTIPLE_IMAGES', 'MULTIPLE_FILES', 'REPEATER', 'VARIANT_BUILDER'];
        const numericTypes = ['NUMBER', 'DECIMAL', 'CURRENCY'];
        if (arrayTypes.includes(definition.type) && !Array.isArray(value)) {
            errors.push(`${definition.label} must contain a list of values`);
            return;
        }
        if (numericTypes.includes(definition.type) && (typeof value !== 'number' || !Number.isFinite(value))) {
            errors.push(`${definition.label} must be a valid number`);
            return;
        }
        if (definition.type === 'NUMBER' && typeof value === 'number' && rules.integer === true && !Number.isInteger(value)) {
            errors.push(`${definition.label} must be a whole number`);
        }
        if (['BOOLEAN', 'CHECKBOX'].includes(definition.type) && typeof value !== 'boolean') {
            errors.push(`${definition.label} must be yes or no`);
            return;
        }
        if (typeof value === 'number') {
            if (typeof rules.min === 'number' && value < rules.min) errors.push(`${definition.label} must be at least ${rules.min}`);
            if (typeof rules.max === 'number' && value > rules.max) errors.push(`${definition.label} must be no more than ${rules.max}`);
        }
        if (typeof value === 'string') {
            if (/<script\b|javascript:|\son\w+\s*=/i.test(value)) errors.push(`${definition.label} contains unsafe markup`);
            if (typeof rules.minLength === 'number' && value.trim().length < rules.minLength) errors.push(`${definition.label} is too short`);
            if (typeof rules.maxLength === 'number' && value.length > rules.maxLength) errors.push(`${definition.label} is too long`);
            if (typeof rules.pattern === 'string' && rules.pattern.length <= 200) {
                try {
                    if (!new RegExp(rules.pattern).test(value)) errors.push(`${definition.label} has an invalid format`);
                } catch {
                    errors.push(`${definition.label} has an invalid configured validation pattern`);
                }
            }
            if (definition.type === 'DATE' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) errors.push(`${definition.label} must be a valid date`);
            if (definition.type === 'TIME' && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) errors.push(`${definition.label} must be a valid time`);
            if (definition.type === 'DATETIME' && !Number.isFinite(new Date(value).getTime())) errors.push(`${definition.label} must be a valid date and time`);
            if (definition.type === 'COORDINATES') {
                const coordinates = value.split(',').map(item => Number(item.trim()));
                if (coordinates.length !== 2 || !coordinates.every(Number.isFinite)
                    || coordinates[0]! < -90 || coordinates[0]! > 90
                    || coordinates[1]! < -180 || coordinates[1]! > 180) {
                    errors.push(`${definition.label} must contain valid latitude and longitude`);
                }
            }
        }
        if (Array.isArray(value)) {
            if (typeof rules.minItems === 'number' && value.length < rules.minItems) errors.push(`${definition.label} needs at least ${rules.minItems} item(s)`);
            if (typeof rules.maxItems === 'number' && value.length > rules.maxItems) errors.push(`${definition.label} allows at most ${rules.maxItems} item(s)`);
        }
        if (rules.mustBeTrue === true && value !== true) errors.push(`${definition.label} must be accepted`);
        if (definition.options?.length) {
            const selected = Array.isArray(value) ? value : [value];
            const invalid = selected.find(item => !definition.options?.includes(String(item)));
            if (invalid !== undefined) errors.push(`${definition.label} contains an unsupported option`);
        }
        if (definition.type === 'FILE' || definition.type === 'MULTIPLE_FILES') {
            const files = Array.isArray(value) ? value : [value];
            for (const file of files) this.validatePrivateFileValue(definition, file, errors);
        }
        if (typeof rules.lessThanField === 'string') {
            const other = values[rules.lessThanField];
            if (typeof value === 'number' && typeof other === 'number' && value >= other) errors.push(`${definition.label} must be lower than ${rules.lessThanField}`);
        }
        if (typeof rules.notBeforeField === 'string') {
            const other = values[rules.notBeforeField];
            if (typeof value === 'string' && typeof other === 'string' && new Date(value) < new Date(other)) {
                errors.push(`${definition.label} cannot be before ${rules.notBeforeField}`);
            }
        }
        if (typeof rules.notLessThanField === 'string') {
            const other = values[rules.notLessThanField];
            if (typeof value === 'number' && typeof other === 'number' && value < other) {
                errors.push(`${definition.label} cannot be lower than ${rules.notLessThanField}`);
            }
        }
        if (typeof rules.afterField === 'string') {
            const other = values[rules.afterField];
            if (typeof value === 'string' && typeof other === 'string') {
                const timeOnly = /^\d{2}:\d{2}(?::\d{2})?$/;
                const valid = timeOnly.test(value) && timeOnly.test(other)
                    ? value > other
                    : new Date(value).getTime() > new Date(other).getTime();
                if (!valid) errors.push(`${definition.label} must be after ${rules.afterField}`);
            }
        }
    }

    private validateStructuredListing(
        listingType: MarketplaceFormTemplate['listingType'],
        input: CreateMarketplaceProductInput,
        values: Record<string, unknown>,
        errors: string[],
    ) {
        if (listingType === 'SERVICE') {
            for (const item of [...(input.servicePackages ?? []), ...(input.serviceAddOns ?? [])]) {
                if (!item.name?.trim()) errors.push('Every service package and add-on needs a name');
                if (!Number.isInteger(item.price) || item.price < 0) errors.push('Service package prices must be zero or more');
                if (item.durationMinutes != null && (!Number.isInteger(item.durationMinutes) || item.durationMinutes < 1)) {
                    errors.push('Service package duration must be a whole number of minutes');
                }
            }
        }
        if (listingType === 'WORKSHOP_EXPERIENCE') {
            const monthlySubscription = values.billing_model === 'Monthly subscription';
            if (!(input.availabilitySessions?.length)) errors.push(monthlySubscription
                ? 'Add at least one recurring class time'
                : 'Add at least one workshop or experience session');
            for (const session of input.availabilitySessions ?? []) {
                const start = new Date(session.startsAt);
                const end = new Date(session.endsAt);
                if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) errors.push('Every session must end after it starts');
                if (!Number.isInteger(session.capacity) || session.capacity < 1) errors.push('Every session needs a capacity of at least 1');
                if (!session.name?.trim()) errors.push(monthlySubscription ? 'Every class time needs a name' : 'Every workshop session needs a name');
                if (!Number.isInteger(session.price) || Number(session.price) < 100) errors.push('Every class or session price must be at least PKR 1');
                if (session.oneDayPrice != null && (!Number.isInteger(session.oneDayPrice) || session.oneDayPrice < 100)) {
                    errors.push('One-day pass prices must be at least PKR 1');
                }
                if (session.earlyBirdPrice != null && (!Number.isInteger(session.earlyBirdPrice) || session.earlyBirdPrice < 100)) {
                    errors.push('Early bird prices must be at least PKR 1');
                }
                if (session.earlyBirdPrice != null && !session.earlyBirdEndsAt) errors.push('Choose when each early bird price ends');
                if (session.earlyBirdEndsAt && !Number.isFinite(new Date(session.earlyBirdEndsAt).getTime())) errors.push('Choose a valid early bird end date');
                if (monthlySubscription) {
                    if (session.scheduleType !== 'SUBSCRIPTION_CLASS') errors.push('Monthly subscriptions require recurring class times');
                    if (!(session.daysOfWeek?.length)) errors.push('Choose at least one class day for every subscription time');
                    if (!/^\d{2}:\d{2}$/.test(session.startTime ?? '') || !/^\d{2}:\d{2}$/.test(session.endTime ?? '') || String(session.endTime) <= String(session.startTime)) {
                        errors.push('Every recurring class must end after it starts');
                    }
                    if (!Number.isInteger(session.gracePeriodDays) || Number(session.gracePeriodDays) < 0 || Number(session.gracePeriodDays) > 30) {
                        errors.push('Renewal grace periods must be between 0 and 30 days');
                    }
                } else if (session.scheduleType === 'SUBSCRIPTION_CLASS') {
                    errors.push('One-time workshops cannot use recurring class times');
                }
                if (session.bookingDeadline) {
                    const deadline = new Date(session.bookingDeadline);
                    if (!Number.isFinite(deadline.getTime()) || deadline >= start) errors.push('A session booking deadline must be before its start');
                }
            }
        }
        if (listingType === 'EVENT') {
            if (!(input.eventTicketTypes?.length)) errors.push('Add at least one event ticket type');
            for (const ticket of input.eventTicketTypes ?? []) {
                if (!ticket.name?.trim()) errors.push('Every ticket type needs a name');
                if (!Number.isInteger(ticket.price) || ticket.price < 0) errors.push('Ticket prices must be zero or more');
                if (!Number.isInteger(ticket.quantity) || ticket.quantity < 1) errors.push('Every ticket type needs a quantity of at least 1');
                if (ticket.saleStartsAt && ticket.saleEndsAt && new Date(ticket.saleStartsAt) >= new Date(ticket.saleEndsAt)) {
                    errors.push('Ticket sales must end after they start');
                }
                const saleLimit = Number(ticket.rules?.ticketSaleLimit ?? 0);
                if (saleLimit && (!Number.isInteger(saleLimit) || saleLimit < 1)) errors.push('Ticket sale limits must be whole numbers greater than zero');
                if (ticket.rules?.status && !['ACTIVE', 'PAUSED', 'SOLD_OUT'].includes(String(ticket.rules.status))) {
                    errors.push('Ticket status is invalid');
                }
                const eventDate = typeof values.event_date === 'string' ? values.event_date : undefined;
                const eventTime = typeof values.start_time === 'string' ? values.start_time : '23:59';
                const eventStartsAt = eventDate ? new Date(`${eventDate}T${eventTime}`) : undefined;
                if (ticket.saleEndsAt && eventStartsAt && Number.isFinite(eventStartsAt.getTime())
                    && new Date(ticket.saleEndsAt) > eventStartsAt) {
                    errors.push('Ticket sales must end before the event starts');
                }
            }
            for (const item of input.eventScheduleItems ?? []) {
                if (!item.name?.trim() || new Date(item.startsAt) >= new Date(item.endsAt)) errors.push('Every event schedule item needs a name and a valid time range');
            }
        }
        if (listingType === 'DIGITAL_PRODUCT') {
            if (!(input.digitalFiles?.some(file => (file.kind ?? 'MAIN') === 'MAIN'))) errors.push('Add a private main digital file');
            const checksums = new Set<string>();
            for (const file of input.digitalFiles ?? []) {
                if (!file.isPrivate) errors.push('Paid digital source files must use private storage');
                if (!file.fileName?.trim() || !file.storageKey?.trim() || !file.mimeType?.trim()) errors.push('Every digital file needs verified storage metadata');
                if (!Number.isInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > 500 * 1024 * 1024) errors.push('Digital files must be between 1 byte and 500 MB');
                if (!['MAIN', 'PREVIEW', 'LICENSE_DOCUMENT'].includes(file.kind ?? 'MAIN')) errors.push('Digital file purpose is invalid');
                if (file.downloadLimit != null && (!Number.isInteger(file.downloadLimit) || file.downloadLimit < 1)) errors.push('Download limits must be whole numbers greater than zero');
                if (file.expiresAt && !Number.isFinite(new Date(file.expiresAt).getTime())) errors.push('Download expiry must be a valid date and time');
                if (file.checksum) {
                    if (checksums.has(file.checksum)) errors.push('The same digital file cannot be attached more than once');
                    checksums.add(file.checksum);
                }
            }
        }
    }

    private validateTemplateField(raw: Record<string, unknown>, index: number): MarketplaceDynamicFieldDefinition {
        const key = typeof raw.key === 'string' ? raw.key.trim() : '';
        const label = typeof raw.label === 'string' ? raw.label.trim() : '';
        const type = typeof raw.type === 'string' ? raw.type.toUpperCase() as MarketplaceDynamicFieldType : undefined;
        if (!/^[a-z][a-z0-9_]{1,63}$/.test(key) || !label || !type || !fieldTypes.has(type)) {
            throw new Error(`Template field ${index + 1} has an invalid key, label, or type`);
        }
        return {
            key,
            label,
            type,
            required: raw.required === true,
            section: typeof raw.section === 'string' ? raw.section : 'Details',
            helpText: typeof raw.helpText === 'string' ? raw.helpText : undefined,
            placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
            unit: typeof raw.unit === 'string' ? raw.unit : undefined,
            options: Array.isArray(raw.options) ? raw.options.map(String) : undefined,
            validation: raw.validation && typeof raw.validation === 'object' && !Array.isArray(raw.validation) ? raw.validation as Record<string, unknown> : undefined,
            ui: raw.ui && typeof raw.ui === 'object' && !Array.isArray(raw.ui) ? raw.ui as Record<string, unknown> : undefined,
            condition: raw.condition && typeof raw.condition === 'object' && !Array.isArray(raw.condition) ? raw.condition as Record<string, unknown> : undefined,
            sortOrder: this.nonNegativeInteger(raw.sortOrder, index),
        };
    }

    private validateMandatoryTemplateFields(
        listingType: MarketplaceListingType,
        schema: MarketplaceDynamicFieldDefinition[],
    ) {
        const byKey = new Map(schema.map(definition => [definition.key, definition]));
        for (const key of mandatoryTemplateFieldKeys[listingType]) {
            const definition = byKey.get(key);
            if (!definition || definition.required !== true) {
                throw new Error(`${key} is a mandatory field for ${listingType.toLowerCase().replace(/_/g, ' ')} listings`);
            }
            const canonical = this.canonicalMandatoryField(listingType, key);
            if (canonical && definition.type !== canonical.type) {
                throw new Error(`${key} must remain a ${canonical.type} field`);
            }
            const canonicalSource = canonical?.ui?.source;
            if (typeof canonicalSource === 'string' && definition.ui?.source !== canonicalSource) {
                throw new Error(`${key} must remain connected to its ${canonicalSource} listing value`);
            }
        }
    }

    private canonicalMandatoryField(listingType: MarketplaceListingType, key: string) {
        return marketplaceFormTemplateSeeds
            .find(template => template.listingType === listingType)
            ?.schema.find(definition => definition.key === key);
    }

    private validatePrivateFileValue(
        definition: MarketplaceDynamicFieldDefinition,
        value: unknown,
        errors: string[],
    ) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            errors.push(`${definition.label} contains invalid file metadata`);
            return;
        }
        const file = value as Record<string, unknown>;
        const fileName = typeof file.fileName === 'string' ? file.fileName : '';
        const mimeType = typeof file.mimeType === 'string' ? file.mimeType : '';
        const sizeBytes = typeof file.sizeBytes === 'number' ? file.sizeBytes : Number.NaN;
        if (!fileName || !mimeType || !Number.isFinite(sizeBytes) || sizeBytes < 1
            || typeof file.storageKey !== 'string' || typeof file.checksum !== 'string' || file.isPrivate !== true) {
            errors.push(`${definition.label} must use a verified private upload`);
            return;
        }
        const rules = definition.validation ?? {};
        const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
        const allowedExtensions = Array.isArray(rules.allowedExtensions)
            ? rules.allowedExtensions.map(item => String(item).toLowerCase().replace(/^\./, ''))
            : [];
        const allowedMimeTypes = Array.isArray(rules.allowedMimeTypes) ? rules.allowedMimeTypes.map(String) : [];
        if (allowedExtensions.length && !allowedExtensions.includes(extension)) {
            errors.push(`${definition.label} uses a file extension that is not allowed`);
        }
        if (allowedMimeTypes.length && !allowedMimeTypes.includes(mimeType)) {
            errors.push(`${definition.label} uses a file type that is not allowed`);
        }
        if (typeof rules.maxFileSizeMb === 'number' && sizeBytes > rules.maxFileSizeMb * 1024 * 1024) {
            errors.push(`${definition.label} exceeds the configured ${rules.maxFileSizeMb} MB limit`);
        }
    }

    private isEmpty(value: unknown) {
        return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
    }

    private nonNegativeInteger(value: unknown, fallback: number) {
        return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
    }
}
