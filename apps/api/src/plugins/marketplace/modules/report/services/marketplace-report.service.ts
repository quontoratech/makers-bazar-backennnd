import { Injectable } from '@nestjs/common';
import {
    AssetService,
    ForbiddenError,
    isGraphQlErrorResult,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, IsNull } from 'typeorm';

import { MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplaceCatalogService } from '../../catalog/services/marketplace-catalog.service';
import { MarketplaceReview } from '../../review/entities/marketplace-review.entity';
import { MarketplaceReviewService } from '../../review/services/marketplace-review.service';
import { VendorService } from '../../vendor/services/vendor.service';
import { MarketplaceChatService } from '../../chat/services/marketplace-chat.service';
import { ReviewMarketplaceReportInput, SubmitMarketplaceReportInput } from '../dto/marketplace-report.inputs';
import { MarketplaceReportEvidence } from '../entities/marketplace-report-evidence.entity';
import { MarketplaceReport } from '../entities/marketplace-report.entity';
import { MarketplaceVendorEnforcementService } from './marketplace-vendor-enforcement.service';

const REPORT_CATEGORIES = new Set([
    'ABUSE',
    'SUSPICIOUS_ACTIVITY',
    'MISLEADING',
    'UNSAFE',
    'PROHIBITED',
    'INAPPROPRIATE',
    'HARASSMENT',
    'FRAUD',
    'COUNTERFEIT',
    'OTHER',
]);

const REPORT_TARGET_TYPES = new Set(['SHOP', 'LISTING', 'USER', 'SUSPICIOUS_ACTIVITY', 'REVIEW']);

const REPORT_STATUSES = new Set([
    'UNDER_REVIEW',
    'APPROVED',
    'ACTION_REQUIRED',
    'ACTION_TAKEN',
    'RESOLVED',
    'DISMISSED',
]);

@Injectable()
export class MarketplaceReportService {
    constructor(
        private connection: TransactionalConnection,
        private assetService: AssetService,
        private vendorService: VendorService,
        private catalogService: MarketplaceCatalogService,
        private marketplaceReviewService: MarketplaceReviewService,
        private marketplaceVendorEnforcementService: MarketplaceVendorEnforcementService,
        private marketplaceChatService: MarketplaceChatService,
    ) {}

    async uploadEvidence(ctx: RequestContext, inputs: Array<{ file: Promise<{ filename: string; mimetype: string; createReadStream: () => NodeJS.ReadableStream }> }>) {
        const uploadedByUserId = this.requireUser(ctx);
        if (!inputs.length) throw new Error('Choose at least one evidence image');
        if (inputs.length > 5) throw new Error('Upload no more than 5 evidence images');
        const repository = this.connection.getRepository(ctx, MarketplaceReportEvidence);
        const evidence: MarketplaceReportEvidence[] = [];
        for (const input of inputs) {
            const file = await input.file;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
                throw new Error(`${file.filename} must be a JPG, PNG, or WebP image`);
            }
            const asset = await this.assetService.create(ctx, { ...input, tags: ['marketplace-report-evidence'] } as any);
            if (isGraphQlErrorResult(asset)) throw new Error(asset.message);
            evidence.push(await repository.save(new MarketplaceReportEvidence({
                uploadedByUserId,
                assetId: String(asset.id),
                name: asset.name,
                preview: asset.preview,
                mimeType: asset.mimeType,
            })));
        }
        return evidence;
    }

    async submit(ctx: RequestContext, input: SubmitMarketplaceReportInput) {
        const reportedByUserId = this.requireUser(ctx);
        const targetType = this.cleanTargetType(input.targetType);
        const category = input.category?.trim().toUpperCase();
        if (!REPORT_CATEGORIES.has(category)) throw new Error('Choose a valid reason for the report');

        let vendorProfileId = this.cleanOptional(input.vendorProfileId, 120);
        let vendorName = targetType === 'SHOP' || targetType === 'LISTING'
            ? this.cleanRequired(input.vendorName, 160, 'Vendor name')
            : this.cleanOptional(input.vendorName, 160) ?? 'Not vendor-related';
        let reviewId = this.cleanOptional(input.reviewId, 120);
        if ((targetType === 'SHOP' || targetType === 'LISTING') && vendorProfileId) {
            const vendor = await this.vendorService.findPublicById(ctx, vendorProfileId);
            if (!vendor) throw new Error('The selected vendor shop is not available');
            vendorProfileId = String(vendor.id);
            vendorName = vendor.shopName;
        }

        let productId = this.cleanOptional(input.productId, 120);
        let listingName = this.cleanOptional(input.listingName, 200);
        let reportedUserId = this.cleanOptional(input.reportedUserId, 120);
        let reportedUserName = this.cleanOptional(input.reportedUserName, 160);
        let reportedUserEmail = this.cleanEmailOptional(input.reportedUserEmail);
        let orderCode = this.cleanOptional(input.orderCode, 120);
        let orderDetails = this.cleanOptional(input.orderDetails, 2000);
        if (targetType === 'LISTING' && productId) {
            const product = await this.catalogService.findPublicProductById(ctx, productId);
            if (!product) throw new Error('The selected listing is not available');
            productId = String(product.id);
            listingName = product.name;
            vendorProfileId = product.vendorProfileId;
            vendorName = product.vendorName;
        }
        if (targetType === 'LISTING' && !listingName) throw new Error('Enter the listing name');
        if (targetType !== 'LISTING') {
            productId = undefined;
            listingName = undefined;
        }
        if (targetType !== 'SHOP' && targetType !== 'LISTING') {
            vendorProfileId = undefined;
        }

        if (targetType === 'REVIEW') {
            if (!reviewId) throw new Error('Choose the review you are reporting');
            const review = await this.connection.getRepository(ctx, MarketplaceReview).findOne({ where: { id: reviewId } });
            if (!review || review.status !== 'PUBLISHED') throw new Error('The selected review is not available');
            if (review.vendorProfileId) {
                const vendor = await this.vendorService.findPublicById(ctx, review.vendorProfileId);
                vendorProfileId = vendor ? String(vendor.id) : review.vendorProfileId;
                vendorName = vendor?.shopName ?? review.vendorName ?? 'Linked vendor';
            }
            productId = review.productId;
            listingName = review.productName ?? `${review.targetType.toLowerCase()} review`;
            reportedUserId = review.customerUserId;
            reportedUserName = review.customerName;
            reportedUserEmail = undefined;
            orderCode = review.orderCode;
            orderDetails = [
                `Review ID: ${review.id}`,
                `Review type: ${review.targetType}`,
                review.productName ? `Listing: ${review.productName}` : undefined,
                `Customer: ${review.customerName}`,
                `Rating: ${review.rating}`,
                review.title ? `Title: ${review.title}` : undefined,
                review.body ? `Review: ${review.body}` : undefined,
            ].filter(Boolean).join('\n');
        } else {
            reviewId = undefined;
        }

        if (targetType === 'USER' && !reportedUserName && !reportedUserEmail) {
            throw new Error('Enter the reported user name or email');
        }

        const evidenceIds = [...new Set(input.evidenceIds ?? [])];
        if (evidenceIds.length > 5) throw new Error('Attach no more than 5 evidence images');
        const evidenceRepository = this.connection.getRepository(ctx, MarketplaceReportEvidence);
        const evidence = evidenceIds.length ? await evidenceRepository.find({
            where: { id: In(evidenceIds), uploadedByUserId: reportedByUserId, reportId: IsNull() },
        }) : [];
        if (evidence.length !== evidenceIds.length) throw new Error('One or more evidence images are invalid');

        const report = await this.connection.getRepository(ctx, MarketplaceReport).save(new MarketplaceReport({
            code: `REPORT-${randomBytes(5).toString('hex').toUpperCase()}`,
            reportedByUserId,
            reporterName: this.cleanRequired(input.reporterName, 160, 'Your name'),
            reporterEmail: this.cleanEmail(input.reporterEmail),
            reporterPhone: this.cleanRequired(input.reporterPhone, 60, 'Contact number'),
            targetType,
            reportedUserId,
            reportedUserName,
            reportedUserEmail,
            vendorProfileId,
            vendorName,
            productId,
            reviewId,
            listingName,
            reportedUrl: this.cleanUrl(input.reportedUrl),
            orderCode,
            orderDetails,
            category,
            subject: this.cleanRequired(input.subject, 200, 'Report subject'),
            description: this.cleanRequired(input.description, 5000, 'Incident details'),
            status: 'SUBMITTED',
        }));
        for (const item of evidence) item.reportId = String(report.id);
        if (evidence.length) await evidenceRepository.save(evidence, { reload: false });
        return this.toResult(report, evidence);
    }

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        filter?: { status?: string; category?: string; term?: string },
    ) {
        const { skip, take } = normalizeListOptions(options);
        const query = this.connection.getRepository(ctx, MarketplaceReport).createQueryBuilder('report');
        if (filter?.status) query.andWhere('report.status = :status', { status: filter.status });
        if (filter?.category) query.andWhere('report.category = :category', { category: filter.category });
        if (filter?.term?.trim()) {
            query.andWhere('(LOWER(report.code) LIKE :term OR LOWER(report.vendorName) LIKE :term OR LOWER(report.listingName) LIKE :term OR LOWER(report.reporterEmail) LIKE :term OR LOWER(report.orderCode) LIKE :term OR LOWER(report.reportedUserName) LIKE :term OR LOWER(report.reportedUserEmail) LIKE :term)', {
                term: `%${filter.term.trim().toLowerCase()}%`,
            });
        }
        const [reports, totalItems] = await query.orderBy('report.createdAt', 'DESC').skip(skip).take(take).getManyAndCount();
        return { items: await this.attachEvidence(ctx, reports), totalItems };
    }

    async review(ctx: RequestContext, input: ReviewMarketplaceReportInput) {
        if (!REPORT_STATUSES.has(input.status)) throw new Error('Choose a valid report status');
        const repository = this.connection.getRepository(ctx, MarketplaceReport);
        const report = await repository.findOne({ where: { id: input.id } });
        if (!report) throw new Error('Report was not found');
        report.status = input.status;
        report.adminNote = this.cleanOptional(input.adminNote, 3000);
        report.actionTaken = this.cleanOptional(input.actionTaken, 3000);
        if (input.enforcement) {
            if (!report.vendorProfileId) {
                throw new Error('Link this report to a marketplace vendor before applying an account action');
            }
            const enforcement = await this.marketplaceVendorEnforcementService.apply(
                ctx,
                String(report.id),
                report.code,
                report.vendorProfileId,
                input.enforcement,
            );
            report.status = 'ACTION_TAKEN';
            report.actionTaken = enforcement.message;
            report.enforcementActionId = String(enforcement.id);
            report.enforcementActionType = enforcement.type;
            report.enforcementEndsAt = enforcement.endsAt;
        }
        if (input.removeLinkedReview) {
            if (!report.reviewId) throw new Error('This report is not linked to a review');
            const result = await this.marketplaceReviewService.hideByAdmin(
                ctx,
                report.reviewId,
                input.adminNote ?? input.actionTaken ?? report.description,
            );
            report.status = 'ACTION_TAKEN';
            report.actionTaken = [report.actionTaken, result.message]
                .filter(Boolean)
                .join('\n');
        }
        report.reviewedByUserId = this.requireUser(ctx);
        report.reviewedAt = new Date();
        await repository.save(report, { reload: false });
        const evidence = await this.connection.getRepository(ctx, MarketplaceReportEvidence).find({
            where: { reportId: String(report.id) },
            order: { createdAt: 'ASC' },
        });
        if (report.status === 'APPROVED') {
            const conversation = await this.marketplaceChatService.ensureForApprovedReport(ctx, report, evidence);
            if (conversation) {
                report.supportConversationId = String(conversation.id);
                await repository.save(report, { reload: false });
            }
        }
        return this.toResult(report, evidence);
    }

    private async attachEvidence(ctx: RequestContext, reports: MarketplaceReport[]) {
        const reportIds = reports.map(report => String(report.id));
        const evidence = reportIds.length ? await this.connection.getRepository(ctx, MarketplaceReportEvidence).find({
            where: { reportId: In(reportIds) },
            order: { createdAt: 'ASC' },
        }) : [];
        const byReportId = new Map<string, MarketplaceReportEvidence[]>();
        for (const item of evidence) {
            const reportId = String(item.reportId);
            byReportId.set(reportId, [...(byReportId.get(reportId) ?? []), item]);
        }
        return reports.map(report => this.toResult(report, byReportId.get(String(report.id)) ?? []));
    }

    private toResult(report: MarketplaceReport, evidence: MarketplaceReportEvidence[]) {
        return { ...report, evidence };
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }

    private cleanRequired(value: unknown, maxLength: number, label: string) {
        const clean = typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
        if (!clean) throw new Error(`${label} is required`);
        return clean;
    }

    private cleanOptional(value: unknown, maxLength: number) {
        return typeof value === 'string' ? value.trim().slice(0, maxLength) || undefined : undefined;
    }

    private cleanEmail(value: unknown) {
        const email = this.cleanRequired(value, 255, 'Email address').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address');
        return email;
    }

    private cleanEmailOptional(value: unknown) {
        const email = this.cleanOptional(value, 255)?.toLowerCase();
        if (!email) return undefined;
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid reported user email address');
        return email;
    }

    private cleanTargetType(value: unknown): SubmitMarketplaceReportInput['targetType'] {
        const targetType = String(value ?? '').trim().toUpperCase();
        if (!REPORT_TARGET_TYPES.has(targetType)) throw new Error('Choose what you are reporting');
        return targetType as SubmitMarketplaceReportInput['targetType'];
    }

    private cleanUrl(value: unknown) {
        const url = this.cleanOptional(value, 2048);
        if (!url) return undefined;
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
            return parsed.toString();
        } catch {
            throw new Error('Enter a valid shop or listing URL');
        }
    }
}
