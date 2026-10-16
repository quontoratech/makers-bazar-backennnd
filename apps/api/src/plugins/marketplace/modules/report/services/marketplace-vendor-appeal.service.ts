import { Injectable } from '@nestjs/common';
import {
    AssetService,
    ForbiddenError,
    isGraphQlErrorResult,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { In, IsNull } from 'typeorm';

import { MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplaceChatService } from '../../chat/services/marketplace-chat.service';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import {
    ReviewMarketplaceVendorAppealInput,
    SubmitMarketplaceVendorAppealInput,
} from '../dto/marketplace-vendor-appeal.inputs';
import { MarketplaceVendorAppealEvidence } from '../entities/marketplace-vendor-appeal-evidence.entity';
import { MarketplaceVendorAppeal } from '../entities/marketplace-vendor-appeal.entity';
import { MarketplaceVendorEnforcement } from '../entities/marketplace-vendor-enforcement.entity';
import { MarketplaceVendorEnforcementService } from './marketplace-vendor-enforcement.service';

interface AppealUploadInput {
    file: Promise<{
        filename: string;
        mimetype: string;
        createReadStream: () => NodeJS.ReadableStream;
    }>;
}

@Injectable()
export class MarketplaceVendorAppealService {
    constructor(
        private connection: TransactionalConnection,
        private assetService: AssetService,
        private marketplaceVendorEnforcementService: MarketplaceVendorEnforcementService,
        private marketplaceChatService: MarketplaceChatService,
    ) {}

    async uploadEvidence(ctx: RequestContext, inputs: AppealUploadInput[]) {
        const vendor = await this.vendorForSession(ctx);
        const uploadedByUserId = this.requireUser(ctx);
        if (!inputs.length) throw new Error('Choose at least one proof image');
        if (inputs.length > 5) throw new Error('Upload no more than 5 proof images');
        const repository = this.connection.getRepository(ctx, MarketplaceVendorAppealEvidence);
        const evidence: MarketplaceVendorAppealEvidence[] = [];
        for (const input of inputs) {
            const file = await input.file;
            if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
                throw new Error(`${file.filename} must be a JPG, PNG, or WebP image`);
            }
            const asset = await this.assetService.create(ctx, { ...input, tags: ['vendor-restriction-appeal'] } as any);
            if (isGraphQlErrorResult(asset)) throw new Error(asset.message);
            evidence.push(await repository.save(new MarketplaceVendorAppealEvidence({
                uploadedByUserId,
                vendorProfileId: String(vendor.id),
                assetId: String(asset.id),
                name: asset.name,
                preview: asset.preview,
                mimeType: asset.mimeType,
            })));
        }
        return evidence;
    }

    async submit(ctx: RequestContext, input: SubmitMarketplaceVendorAppealInput) {
        const vendor = await this.vendorForSession(ctx);
        const submittedByUserId = this.requireUser(ctx);
        const enforcement = await this.connection.getRepository(ctx, MarketplaceVendorEnforcement).findOne({
            where: {
                id: input.enforcementId,
                vendorProfileId: String(vendor.id),
                type: 'RESTRICTION',
                status: 'ACTIVE',
            },
        });
        if (!enforcement) throw new Error('Only an active restriction can be appealed');
        const appealRepository = this.connection.getRepository(ctx, MarketplaceVendorAppeal);
        if (await appealRepository.findOne({ where: { enforcementId: String(enforcement.id) } })) {
            throw new Error('An appeal has already been submitted for this restriction');
        }
        const statement = this.requiredText(input.statement, 5000, 'Appeal statement');
        if (statement.length < 20) throw new Error('Appeal statement must contain at least 20 characters');
        const evidenceIds = [...new Set(input.evidenceIds ?? [])];
        if (!evidenceIds.length) throw new Error('Attach at least one proof image');
        if (evidenceIds.length > 5) throw new Error('Attach no more than 5 proof images');
        const evidenceRepository = this.connection.getRepository(ctx, MarketplaceVendorAppealEvidence);
        const evidence = await evidenceRepository.find({
            where: {
                id: In(evidenceIds),
                uploadedByUserId: submittedByUserId,
                vendorProfileId: String(vendor.id),
                appealId: IsNull(),
            },
        });
        if (evidence.length !== evidenceIds.length) throw new Error('One or more proof images are invalid');

        const appeal = await appealRepository.save(new MarketplaceVendorAppeal({
            vendorProfileId: String(vendor.id),
            enforcementId: String(enforcement.id),
            reportCode: enforcement.reportCode,
            vendorName: vendor.shopName,
            statement,
            status: 'SUBMITTED',
            submittedByUserId,
        }));
        for (const item of evidence) item.appealId = String(appeal.id);
        await evidenceRepository.save(evidence, { reload: false });
        return this.toResult(appeal, evidence);
    }

    async findMine(ctx: RequestContext) {
        const vendor = await this.vendorForSession(ctx);
        const appeals = await this.connection.getRepository(ctx, MarketplaceVendorAppeal).find({
            where: { vendorProfileId: String(vendor.id) },
            order: { createdAt: 'DESC' },
        });
        return this.attachEvidence(ctx, appeals);
    }

    async findAll(ctx: RequestContext, options?: MarketplaceListOptions, status?: string) {
        const { skip, take } = normalizeListOptions(options);
        const [appeals, totalItems] = await this.connection.getRepository(ctx, MarketplaceVendorAppeal).findAndCount({
            where: status ? { status: status as MarketplaceVendorAppeal['status'] } : {},
            order: { createdAt: 'DESC' },
            skip,
            take,
        });
        return { items: await this.attachEvidence(ctx, appeals), totalItems };
    }

    async review(ctx: RequestContext, input: ReviewMarketplaceVendorAppealInput) {
        if (!['APPROVED', 'REJECTED'].includes(input.decision)) throw new Error('Choose a valid appeal decision');
        const repository = this.connection.getRepository(ctx, MarketplaceVendorAppeal);
        const appeal = await repository.findOne({ where: { id: input.id } });
        if (!appeal) throw new Error('Restriction appeal was not found');
        if (!['SUBMITTED', 'UNDER_REVIEW'].includes(appeal.status)) {
            throw new Error('This restriction appeal already has a final decision');
        }
        appeal.status = input.decision;
        appeal.adminNote = this.optionalText(input.adminNote, 3000);
        appeal.reviewedByUserId = this.requireUser(ctx);
        appeal.reviewedAt = new Date();
        if (input.decision === 'APPROVED') {
            await this.marketplaceVendorEnforcementService.liftRestriction(ctx, appeal.enforcementId);
        }
        await repository.save(appeal, { reload: false });
        const evidence = await this.connection.getRepository(ctx, MarketplaceVendorAppealEvidence).find({
            where: { appealId: String(appeal.id) },
            order: { createdAt: 'ASC' },
        });
        if (appeal.status === 'APPROVED') {
            const conversation = await this.marketplaceChatService.ensureForApprovedVendorAppeal(ctx, appeal, evidence);
            if (conversation) {
                appeal.supportConversationId = String(conversation.id);
                await repository.save(appeal, { reload: false });
            }
        }
        return this.toResult(appeal, evidence);
    }

    private async attachEvidence(ctx: RequestContext, appeals: MarketplaceVendorAppeal[]) {
        const ids = appeals.map(item => String(item.id));
        const evidence = ids.length ? await this.connection.getRepository(ctx, MarketplaceVendorAppealEvidence).find({
            where: { appealId: In(ids) },
            order: { createdAt: 'ASC' },
        }) : [];
        const byAppeal = new Map<string, MarketplaceVendorAppealEvidence[]>();
        for (const item of evidence) byAppeal.set(String(item.appealId), [...(byAppeal.get(String(item.appealId)) ?? []), item]);
        return appeals.map(item => this.toResult(item, byAppeal.get(String(item.id)) ?? []));
    }

    private toResult(appeal: MarketplaceVendorAppeal, evidence: MarketplaceVendorAppealEvidence[]) {
        return { ...appeal, evidence };
    }

    private async vendorForSession(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new Error('This account is not connected to an approved vendor shop');
        return vendor;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }

    private requiredText(value: unknown, maxLength: number, label: string) {
        const text = this.optionalText(value, maxLength);
        if (!text) throw new Error(`${label} is required`);
        return text;
    }

    private optionalText(value: unknown, maxLength: number) {
        return typeof value === 'string' ? value.trim().slice(0, maxLength) || undefined : undefined;
    }
}
