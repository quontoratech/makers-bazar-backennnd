import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import {
    categories as onboardingCategories,
    categoryAccessFields,
    sanitizeCategoryAccessAnswers,
    validateCategoryAccessAnswers,
} from '@marketplace/contracts/onboarding';
import {
    AssetService,
    ForbiddenError,
    isGraphQlErrorResult,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import {
    ReviewMarketplaceVendorCategoryRequestInput,
    SubmitMarketplaceVendorCategoryRequestInput,
} from '../dto/marketplace-vendor-category-request.inputs';
import { MarketplaceListingType } from '../entities/marketplace-form-template.entity';
import { MarketplaceVendorCategoryRequestDocument } from '../entities/marketplace-vendor-category-request-document.entity';
import { MarketplaceVendorCategoryRequest } from '../entities/marketplace-vendor-category-request.entity';
import { canonicalVendorCategory, vendorAllowedListingTypes } from '../vendor-category-access';
import { MarketplaceCategoryService } from './marketplace-category.service';

const documentMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'video/mp4']);
const documentTypes = new Set([
    'BUSINESS_REGISTRATION',
    'FOOD_LICENSE',
    'SAFETY_CERTIFICATE',
    'TAX_DOCUMENT',
    'SUPPLIER_PROOF',
    'OTHER',
]);
const coreListingTypes = new Set<MarketplaceListingType>([
    'PHYSICAL_PRODUCT',
    'ARTISAN_PRODUCT',
    'FOOD_PRODUCT',
    'DIGITAL_PRODUCT',
    'SERVICE',
    'WORKSHOP_EXPERIENCE',
    'EVENT',
]);

@Injectable()
export class MarketplaceVendorCategoryRequestService {
    constructor(
        private connection: TransactionalConnection,
        private assetService: AssetService,
        private categoryService: MarketplaceCategoryService,
    ) {}

    async uploadDocuments(
        ctx: RequestContext,
        inputs: Array<{ file: Promise<{ filename: string; mimetype: string; createReadStream: () => NodeJS.ReadableStream }> }>,
    ) {
        const uploadedByUserId = this.requireUser(ctx);
        await this.vendorWorkspace(ctx);
        if (!inputs.length) throw new Error('Choose at least one supporting document');
        if (inputs.length > 8) throw new Error('Upload no more than 8 supporting documents');
        const repository = this.connection.getRepository(ctx, MarketplaceVendorCategoryRequestDocument);
        const documents: MarketplaceVendorCategoryRequestDocument[] = [];
        for (const input of inputs) {
            const file = await input.file;
            if (!documentMimeTypes.has(file.mimetype)) {
                throw new Error(`${file.filename} must be a PDF, JPG, PNG, WebP, or MP4 file`);
            }
            const asset = await this.assetService.create(ctx, { ...input, tags: ['vendor-category-access-document'] } as any);
            if (isGraphQlErrorResult(asset)) throw new Error(asset.message);
            documents.push(await repository.save(new MarketplaceVendorCategoryRequestDocument({
                uploadedByUserId,
                assetId: String(asset.id),
                name: asset.name,
                preview: asset.preview,
                source: asset.source || asset.preview,
                mimeType: asset.mimeType,
            })));
        }
        return documents;
    }

    async removeUnsubmittedDocument(ctx: RequestContext, id: string) {
        const uploadedByUserId = this.requireUser(ctx);
        await this.vendorWorkspace(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceVendorCategoryRequestDocument);
        const document = await repository.findOne({
            where: { id: String(id), uploadedByUserId, requestId: IsNull() },
        });
        if (!document) throw new Error('The unsubmitted category document was not found');
        await repository.remove(document);
        await this.assetService.delete(ctx, [document.assetId], true);
        return { success: true, message: 'Category document removed' };
    }

    async vendorDashboard(ctx: RequestContext) {
        const vendor = await this.vendorWorkspace(ctx);
        const requests = await this.requestsForVendor(ctx, String(vendor.id));
        const categories = await this.categoryService.flatCategories(ctx, false);
        const templates = await this.categoryService.listTemplates(ctx, false);
        const allowedTypes = vendorAllowedListingTypes(vendor.categories);
        const pendingTypes = new Set(requests
            .filter(request => request.status === 'PENDING')
            .flatMap(request => this.requestListingTypes(request)));
        const categoryCounts = new Map<MarketplaceListingType, number>();
        for (const category of categories) {
            const listingType = (category.effectiveFormTemplate as { listingType?: MarketplaceListingType } | null | undefined)?.listingType;
            if (listingType) categoryCounts.set(listingType, (categoryCounts.get(listingType) ?? 0) + 1);
        }
        const templateByType = new Map<MarketplaceListingType, typeof templates[number]>();
        for (const template of templates) {
            if (coreListingTypes.has(template.listingType) && !templateByType.has(template.listingType)) {
                templateByType.set(template.listingType, template);
            }
        }
        const options = [...templateByType.values()].map(template => {
            const currentlyApproved = !allowedTypes || allowedTypes.has(template.listingType);
            return {
                listingType: template.listingType,
                formName: template.name,
                formKey: template.key,
                categoryCount: categoryCounts.get(template.listingType) ?? 0,
                currentlyApproved,
                requestPending: pendingTypes.has(template.listingType),
                requestable: !currentlyApproved && !pendingTypes.has(template.listingType),
                documentsRequired: true,
            };
        }).sort((left, right) => left.formName.localeCompare(right.formName));
        return {
            vendorId: String(vendor.id),
            vendorName: vendor.shopName,
            approvedCategories: vendor.categories ?? [],
            options,
            requests,
        };
    }

    async submit(ctx: RequestContext, input: SubmitMarketplaceVendorCategoryRequestInput) {
        const vendor = await this.vendorWorkspace(ctx);
        const submittedByUserId = this.requireUser(ctx);
        const requestedTypes = [...new Set((input.listingTypes ?? [])
            .map(value => String(value).trim().toUpperCase()))] as MarketplaceListingType[];
        if (!requestedTypes.length) throw new Error('Choose at least one core category');
        if (requestedTypes.length > coreListingTypes.size || requestedTypes.some(type => !coreListingTypes.has(type))) {
            throw new Error('Choose valid core marketplace categories');
        }
        const templates = await this.categoryService.listTemplates(ctx, false);
        const templateByType = new Map(templates.map(template => [template.listingType, template]));
        if (requestedTypes.some(type => !templateByType.has(type))) {
            throw new Error('One or more selected core categories are not active');
        }

        const allowedTypes = vendorAllowedListingTypes(vendor.categories);
        if (!allowedTypes || requestedTypes.some(type => allowedTypes.has(type))) {
            throw new Error('Your vendor account is already approved for one or more selected core categories');
        }
        const requestRepository = this.connection.getRepository(ctx, MarketplaceVendorCategoryRequest);
        const pendingRequests = await requestRepository.find({
            where: { vendorProfileId: String(vendor.id), status: 'PENDING' },
        });
        const pendingTypes = new Set(pendingRequests.flatMap(request => this.requestListingTypes(request)));
        if (requestedTypes.some(type => pendingTypes.has(type))) {
            throw new Error('A request for one or more selected core categories is already pending');
        }

        const categoryIds = requestedTypes.map(type => {
            const category = onboardingCategories.find(item => item.listingType === type);
            if (!category) throw new Error(`The ${type} onboarding form is not configured`);
            return category.id;
        });
        const answers = sanitizeCategoryAccessAnswers(
            { ...(input.categoryData ?? {}), ...(input.kycData ?? {}) },
            categoryIds,
        );
        const readinessErrors = validateCategoryAccessAnswers(answers);
        const firstReadinessError = Object.values(readinessErrors)[0];
        if (firstReadinessError) throw new Error(`Complete the category and KYC form: ${firstReadinessError}`);

        const readinessFields = categoryAccessFields(answers);
        const categoryKeys = new Set(readinessFields
            .filter(field => field.step === 3 || field.step === 6)
            .map(field => field.key));
        const categoryData = Object.fromEntries(Object.entries(answers)
            .filter(([key]) => key === 'categories' || categoryKeys.has(key)));
        const kycData = Object.fromEntries(Object.entries(answers)
            .filter(([key]) => key !== 'categories' && !categoryKeys.has(key)));

        const documentInputs = input.documents ?? [];
        if (documentInputs.length > 40) throw new Error('Attach no more than 40 category and KYC files');
        if (!input.complianceConfirmed) throw new Error('Confirm the category compliance declaration before submitting');
        for (const documentInput of documentInputs) {
            const type = String(documentInput.documentType ?? '').trim().toUpperCase();
            if (!documentTypes.has(type)) throw new Error('Choose a valid document type for every attachment');
            if (!/^[a-zA-Z][a-zA-Z0-9_]{0,99}$/.test(String(documentInput.fieldKey ?? ''))) {
                throw new Error('Every attachment must be linked to a valid form field');
            }
            this.optionalFutureDate(documentInput.expiresAt);
        }
        const documentIds = [...new Set(documentInputs.map(item => String(item.id)))];
        if (documentIds.length !== documentInputs.length) throw new Error('The same file cannot be attached more than once');
        const referencedFiles = new Map<string, string>();
        for (const field of readinessFields.filter(item => item.type === 'file')) {
            const value = answers[field.key];
            for (const id of (Array.isArray(value) ? value : value ? [value] : [])) {
                referencedFiles.set(String(id), field.key);
            }
        }
        if (
            referencedFiles.size !== documentIds.length ||
            documentInputs.some(document => referencedFiles.get(String(document.id)) !== document.fieldKey)
        ) {
            throw new Error('Every uploaded file must be attached to its matching category or KYC field');
        }
        const documentRepository = this.connection.getRepository(ctx, MarketplaceVendorCategoryRequestDocument);
        const documents = documentIds.length ? await documentRepository.find({
            where: { id: In(documentIds), uploadedByUserId: submittedByUserId, requestId: IsNull() },
        }) : [];
        if (documents.length !== documentIds.length) throw new Error('One or more supporting documents are invalid');

        const requestedNames = requestedTypes.map(type => templateByType.get(type)?.name ?? canonicalVendorCategory(type));
        const request = await requestRepository.save(new MarketplaceVendorCategoryRequest({
            code: `CAT-${randomBytes(5).toString('hex').toUpperCase()}`,
            vendorProfileId: String(vendor.id),
            vendorName: vendor.shopName,
            requestedCategoryId: `core:${requestedTypes.join('+')}`,
            requestedCategoryCode: requestedTypes.join(','),
            requestedCategoryName: requestedNames.join(', '),
            requestedCategoryBreadcrumb: requestedNames,
            listingType: requestedTypes[0],
            listingTypes: requestedTypes,
            businessReason: this.requiredText(input.businessReason, 30, 3000, 'Business reason'),
            experience: this.requiredText(input.experience, 20, 3000, 'Experience'),
            fulfilmentPlan: this.requiredText(input.fulfilmentPlan, 30, 3000, 'Fulfilment plan'),
            categoryData,
            kycData,
            complianceConfirmed: Boolean(input.complianceConfirmed),
            status: 'PENDING',
            submittedByUserId,
            submittedAt: new Date(),
        }));
        const inputById = new Map(documentInputs.map(item => [String(item.id), item]));
        for (const document of documents) {
            const documentInput = inputById.get(String(document.id));
            const type = String(documentInput?.documentType ?? '').trim().toUpperCase();
            if (!documentTypes.has(type)) throw new Error('Choose a valid document type for every attachment');
            document.documentType = type;
            document.fieldKey = String(documentInput?.fieldKey);
            document.expiresAt = this.optionalFutureDate(documentInput?.expiresAt);
            document.requestId = String(request.id);
        }
        if (documents.length) await documentRepository.save(documents, { reload: false });
        return this.toResult(request, documents);
    }

    async findAll(ctx: RequestContext, status?: string | null) {
        const normalizedStatus = String(status ?? '').trim().toUpperCase();
        if (normalizedStatus && !['PENDING', 'APPROVED', 'REJECTED'].includes(normalizedStatus)) {
            throw new Error('Choose a valid category request status');
        }
        const requests = await this.connection.getRepository(ctx, MarketplaceVendorCategoryRequest).find({
            where: normalizedStatus ? { status: normalizedStatus as MarketplaceVendorCategoryRequest['status'] } : {},
            order: { createdAt: 'DESC' },
        });
        return this.attachDocuments(ctx, requests);
    }

    async review(ctx: RequestContext, input: ReviewMarketplaceVendorCategoryRequestInput) {
        const status = String(input.status ?? '').trim().toUpperCase();
        if (!['APPROVED', 'REJECTED'].includes(status)) throw new Error('Choose approve or reject');
        const repository = this.connection.getRepository(ctx, MarketplaceVendorCategoryRequest);
        const request = await repository.findOne({ where: { id: String(input.id) } });
        if (!request) throw new Error('Category access request was not found');
        if (request.status !== 'PENDING') throw new Error('This category access request has already been reviewed');
        const adminNote = this.requiredText(input.adminNote, status === 'REJECTED' ? 10 : 3, 3000, 'Review note');

        if (status === 'APPROVED') {
            const vendorRepository = this.connection.getRepository(ctx, VendorProfile);
            const vendor = await vendorRepository.findOne({ where: { id: request.vendorProfileId, status: 'APPROVED' } });
            if (!vendor) throw new Error('The linked approved vendor account was not found');
            const categories = new Set(vendor.categories ?? []);
            for (const listingType of this.requestListingTypes(request)) {
                categories.add(canonicalVendorCategory(listingType));
            }
            vendor.categories = [...categories];
            await vendorRepository.save(vendor, { reload: false });
        }

        request.status = status as 'APPROVED' | 'REJECTED';
        request.adminNote = adminNote;
        request.reviewedByUserId = this.requireUser(ctx);
        request.reviewedAt = new Date();
        await repository.save(request, { reload: false });
        return this.toResult(request, await this.documentsFor(ctx, String(request.id)));
    }

    private async requestsForVendor(ctx: RequestContext, vendorProfileId: string) {
        const requests = await this.connection.getRepository(ctx, MarketplaceVendorCategoryRequest).find({
            where: { vendorProfileId },
            order: { createdAt: 'DESC' },
        });
        return this.attachDocuments(ctx, requests);
    }

    private async attachDocuments(ctx: RequestContext, requests: MarketplaceVendorCategoryRequest[]) {
        if (!requests.length) return [];
        const documents = await this.connection.getRepository(ctx, MarketplaceVendorCategoryRequestDocument).find({
            where: { requestId: In(requests.map(request => String(request.id))) },
            order: { createdAt: 'ASC' },
        });
        const byRequest = new Map<string, MarketplaceVendorCategoryRequestDocument[]>();
        for (const document of documents) {
            const items = byRequest.get(String(document.requestId)) ?? [];
            items.push(document);
            byRequest.set(String(document.requestId), items);
        }
        return requests.map(request => this.toResult(request, byRequest.get(String(request.id)) ?? []));
    }

    private documentsFor(ctx: RequestContext, requestId: string) {
        return this.connection.getRepository(ctx, MarketplaceVendorCategoryRequestDocument).find({
            where: { requestId },
            order: { createdAt: 'ASC' },
        });
    }

    private toResult(request: MarketplaceVendorCategoryRequest, documents: MarketplaceVendorCategoryRequestDocument[]) {
        return {
            ...request,
            id: String(request.id),
            listingTypes: this.requestListingTypes(request),
            categoryData: request.categoryData ?? {},
            kycData: request.kycData ?? {},
            documents: documents.map(document => ({
                ...document,
                id: String(document.id),
                fieldKey: document.fieldKey || 'supportingDocuments',
            })),
        };
    }

    private requestListingTypes(request: Pick<MarketplaceVendorCategoryRequest, 'listingType' | 'listingTypes'>) {
        return request.listingTypes?.length ? request.listingTypes : [request.listingType];
    }

    private async vendorWorkspace(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new ForbiddenError();
        return vendor;
    }

    private requiredText(value: unknown, minLength: number, maxLength: number, label: string) {
        const text = String(value ?? '').replace(/\s+/g, ' ').trim();
        if (text.length < minLength) throw new Error(`${label} must be at least ${minLength} characters`);
        return text.slice(0, maxLength);
    }

    private optionalFutureDate(value?: string) {
        if (!value) return undefined;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) throw new Error('Choose a valid document expiry date');
        if (date.getTime() <= Date.now()) throw new Error('Document expiry must be in the future');
        return date;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }
}
