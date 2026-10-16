import {
    Answers,
    categories,
    fields,
    sanitizeAnswers,
    validate,
    visibleFields,
} from '@marketplace/contracts/onboarding';
import { Injectable } from '@nestjs/common';
import {
    AssetService,
    CustomerService,
    EventBus,
    ID,
    isGraphQlErrorResult,
    Permission,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { execFile } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { In } from 'typeorm';
import { RoleApplication } from '../../applications/entities/role-application.entity';
import { assertVendorApplicationEmailAllowed, blockedVendorApplication } from '../../applications/vendor-email-block';
import { RoleApplicationStatusEvent } from '../../applications/events/role-application.event';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { VendorService } from '../../vendor/services/vendor.service';
import { VendorOnboarding, VendorOnboardingFile } from '../entities/vendor-onboarding.entity';

const storageRoot = () => path.resolve(process.env.VENDOR_ONBOARDING_DIR || 'private/vendor-onboarding');
const uploads = new Map<string, number>();
const downloadSecret = process.env.VENDOR_ONBOARDING_DOWNLOAD_SECRET || randomBytes(32).toString('hex');

@Injectable()
export class VendorOnboardingService {
    constructor(
        private connection: TransactionalConnection,
        private customers: CustomerService,
        private vendors: VendorService,
        private events: EventBus,
        private assets: AssetService,
    ) {}

    async mine(ctx: RequestContext) {
        const customer = await this.identity(ctx);
        const repo = this.connection.getRepository(ctx, VendorOnboarding);
        let draft = await repo.findOneBy({ ownerUserId: String(ctx.activeUserId) });
        if (!draft) {
            await this.assertEmailAllowed(ctx, customer.emailAddress);
            const account: Answers = {
                firstName: customer.firstName,
                lastName: customer.lastName,
                email: customer.emailAddress,
                country: 'Pakistan',
                phone: customer.phoneNumber || '',
            };
            try {
                draft = await repo.save(
                    new VendorOnboarding({
                        ownerUserId: String(ctx.activeUserId),
                        emailAddress: customer.emailAddress,
                        sections: { '0': account },
                        currentStep: 0,
                        version: 1,
                    }),
                );
            } catch (error) {
                draft = await repo.findOneBy({ ownerUserId: String(ctx.activeUserId) });
                if (!draft) throw error;
            }
        }
        return this.view(ctx, draft);
    }

    async save(
        ctx: RequestContext,
        input: { version: number; step: number; answers: unknown; validateStep?: number },
    ) {
        await this.mine(ctx);
        const customer = await this.identity(ctx);
        await this.assertEmailAllowed(ctx, customer.emailAddress);
        const repo = this.connection.getRepository(ctx, VendorOnboarding);
        const draft = (await repo.findOneBy({ ownerUserId: String(ctx.activeUserId) }))!;
        await this.assertEditable(ctx, draft);
        if (!Number.isInteger(input.step) || input.step < 0 || input.step > 7)
            throw new Error('Invalid application step');
        const a = sanitizeAnswers(input.answers);
        a.email = customer.emailAddress;
        a.firstName = customer.firstName;
        a.lastName = customer.lastName;
        if (!Number.isInteger(input.version) || input.version < 1) throw new Error('Invalid draft version');
        if (input.validateStep !== undefined && input.validateStep !== null) {
            if (!Number.isInteger(input.validateStep) || input.validateStep < 0 || input.validateStep > 7)
                throw new Error('Invalid validation step');
            const errors = validate(a, input.validateStep);
            if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
        }
        const fileIds = visibleFields(a)
            .filter(f => f.type === 'file')
            .flatMap(f =>
                Array.isArray(a[f.key]) ? (a[f.key] as string[]) : a[f.key] ? [String(a[f.key])] : [],
            );
        if (fileIds.length) await this.assertFiles(ctx, draft, a);
        const result = await repo
            .createQueryBuilder()
            .update(VendorOnboarding)
            .set({
                sections: this.sections(a),
                version: input.version + 1,
                currentStep: input.step,
                storeName: String(a.storeName || ''),
                city: String(a.city || ''),
                businessType: String(a.businessType || ''),
            })
            .where('id = :id AND version = :version', { id: draft.id, version: input.version })
            .execute();
        if (result.affected !== 1)
            throw new Error('This draft changed in another tab. Reload before saving.');
        return this.view(ctx, (await repo.findOneBy({ id: draft.id }))!);
    }

    async submit(ctx: RequestContext, version: number) {
        const draft = await this.owned(ctx);
        const customer = await this.identity(ctx);
        await this.assertEmailAllowed(ctx, customer.emailAddress);
        const applicationRepo = this.connection.getRepository(ctx, RoleApplication);
        let application = draft.applicationId
            ? await applicationRepo.findOneBy({ id: draft.applicationId })
            : null;
        if (draft.applicationId && !application)
            throw new Error('The application linked to this draft is missing');
        if (application?.status === 'BLOCKED') throw new Error('This vendor application is blocked. Contact support for help.');
        if (application && !['CHANGES_REQUESTED', 'REJECTED'].includes(application.status))
            return this.view(ctx, draft);
        const previousApplicationStatus = application?.status;
        if (draft.version !== version)
            throw new Error('This draft changed. Reload and review before submitting.');
        const a = this.answers(draft);
        const errors = validate(a);
        if (Object.keys(errors).length) throw new Error(Object.values(errors)[0]);
        await this.assertFiles(ctx, draft, a);
        const claim = await this.connection
            .getRepository(ctx, VendorOnboarding)
            .createQueryBuilder()
            .update(VendorOnboarding)
            .set({ version: version + 1 })
            .where('id = :id AND version = :version', { id: draft.id, version })
            .execute();
        if (claim.affected !== 1)
            throw new Error('Application already changed or submitted. Reload to continue.');
        draft.version = version + 1;
        const selected = categories
            .filter(c => (a.categories as string[]).includes(c.id))
            .map(c => c.vendorLabel);
        const duplicates = await applicationRepo.findBy({
            role: 'VENDOR',
            emailAddress: customer.emailAddress,
            status: In(['PENDING', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'BLOCKED', 'ACCOUNT_CREATED']),
        });
        if (duplicates.some(duplicate => String(duplicate.id) !== String(application?.id)))
            throw new Error('A vendor application already exists for this account');
        if (!application) {
            const vendor = await this.vendors.register(ctx, {
                shopName: String(a.displayName),
                slug: `${String(a.displayName)}-${String(ctx.activeUserId)}`,
                ownerFirstName: customer.firstName,
                ownerLastName: customer.lastName,
                ownerEmailAddress: customer.emailAddress,
                phoneNumber: String(a.businessPhone || a.phone),
                businessType: String(a.businessType),
                description: String(a.description),
                categories: selected,
                operatingLocations: [String(a.businessCity || a.city)],
            });
            application = new RoleApplication({
                reference: `VND-${randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase()}`,
                role: 'VENDOR',
                firstName: customer.firstName,
                lastName: customer.lastName,
                emailAddress: customer.emailAddress,
                vendorProfileId: String(vendor.id),
                mustChangePassword: false,
                history: [],
            });
        }
        Object.assign(application, {
            firstName: customer.firstName,
            lastName: customer.lastName,
            emailAddress: customer.emailAddress,
            displayName: a.displayName,
            phoneNumber: a.businessPhone || a.phone,
            businessType: a.businessType,
            description: a.description,
            categories: selected,
            operatingLocations: [a.businessCity || a.city],
            websiteUrl: a.website,
            profileData: { onboardingId: String(draft.id) },
            status: 'PENDING',
            reviewNote: null,
            reviewedAt: null,
            reviewedByUserId: null,
        });
        application.history = [
            ...(application.history || []),
            {
                status: 'PENDING',
                at: new Date().toISOString(),
                note: draft.applicationId ? 'Revised application submitted' : 'Application submitted',
            },
        ];
        if (draft.applicationId) {
            const updated = await applicationRepo.createQueryBuilder()
                .update(RoleApplication)
                .set({
                    firstName: application.firstName,
                    lastName: application.lastName,
                    emailAddress: application.emailAddress,
                    displayName: application.displayName,
                    phoneNumber: application.phoneNumber,
                    businessType: application.businessType,
                    description: application.description,
                    categories: application.categories,
                    operatingLocations: application.operatingLocations,
                    websiteUrl: application.websiteUrl,
                    profileData: application.profileData as any,
                    status: 'PENDING',
                    reviewNote: null,
                    reviewedAt: null,
                    reviewedByUserId: null,
                    history: application.history,
                })
                .where('id = :id AND status = :status', { id: application.id, status: previousApplicationStatus })
                .execute();
            if (updated.affected !== 1)
                throw new Error('This application changed during submission. Reload before trying again.');
            application = (await applicationRepo.findOneBy({ id: application.id }))!;
        } else {
            application = await applicationRepo.save(application);
        }
        draft.applicationId = String(application.id);
        draft.currentStep = 7;
        await this.connection.getRepository(ctx, VendorOnboarding).save(draft);
        if (application.vendorProfileId) {
            await this.connection.getRepository(ctx, VendorProfile).update(application.vendorProfileId, {
                shopName: String(a.displayName),
                description: String(a.description),
                categories: selected,
                businessType: String(a.businessType),
                phoneNumber: String(a.businessPhone || a.phone),
                operatingLocations: [String(a.businessCity || a.city)],
                ownerFirstName: customer.firstName,
                ownerLastName: customer.lastName,
                ownerEmailAddress: customer.emailAddress,
                status: 'PENDING',
                verified: false,
                reviewNote: '',
            });
        }
        await this.events.publish(
            new RoleApplicationStatusEvent(
                ctx,
                application.emailAddress,
                application.firstName,
                application.displayName,
                application.reference,
                'VENDOR',
                'PENDING',
            ),
        );
        return this.view(ctx, draft);
    }

    async review(ctx: RequestContext, id: ID) {
        this.assertAdmin(ctx);
        const draft = await this.connection.getRepository(ctx, VendorOnboarding).findOneBy({ id });
        if (!draft) throw new Error('Application not found');
        return this.view(ctx, draft);
    }

    async approvedForOwner(ctx: RequestContext) {
        if (!ctx.activeUserId) throw new Error('Sign in to continue');
        const draft = await this.connection.getRepository(ctx, VendorOnboarding).findOneBy({
            ownerUserId: String(ctx.activeUserId),
        });
        if (!draft?.applicationId) return null;
        const application = await this.connection.getRepository(ctx, RoleApplication).findOneBy({
            id: draft.applicationId,
        });
        if (
            application?.role !== 'VENDOR' ||
            application.status !== 'ACCOUNT_CREATED' ||
            application.provisionedUserId !== String(ctx.activeUserId) ||
            !application.vendorProfileId
        ) return null;
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOneBy({
            id: application.vendorProfileId,
        });
        if (vendor?.status !== 'APPROVED' || vendor.ownerUserId !== String(ctx.activeUserId))
            return null;
        return this.view(ctx, draft);
    }

    async upload(ctx: RequestContext, fieldKey: string, upload: Promise<any>) {
        const draft = await this.owned(ctx);
        await this.assertEmailAllowed(ctx, (await this.identity(ctx)).emailAddress);
        await this.assertEditable(ctx, draft);
        const field = fields.find(f => f.key === fieldKey && f.type === 'file');
        if (!field) throw new Error('Invalid document field');
        const key = String(ctx.activeUserId);
        if (uploads.has(key)) throw new Error('Another upload is in progress');
        const repo = this.connection.getRepository(ctx, VendorOnboardingFile);
        uploads.set(key, Date.now());
        const storageKey = randomUUID();
        const filePath = path.join(storageRoot(), storageKey);
        try {
            const existing = await this.cleanupOrphanFiles(ctx, draft, await repo.findBy({ onboardingId: String(draft.id) }));
            if (existing.length >= 40 || existing.reduce((sum, f) => sum + f.size, 0) >= 250 * 1024 * 1024)
                throw new Error('Application storage limit reached');
            const file = await upload;
            if (!field.accept?.split(',').includes(file.mimetype))
                throw new Error('This file type is not allowed');
            const fieldLimit = fieldKey === 'artisan_processVideo'
                ? 100 * 1024 * 1024 : 10 * 1024 * 1024;
            const limit = Math.min(
                fieldLimit,
                250 * 1024 * 1024 - existing.reduce((sum, f) => sum + f.size, 0),
            );
            await mkdir(storageRoot(), { recursive: true, mode: 0o700 });
            let size = 0;
            let signature = Buffer.alloc(0);
            const hash = createHash('sha256');
            const guard = new Transform({
                transform(chunk: Buffer, _encoding, done) {
                    size += chunk.length;
                    if (size > limit) return done(new Error(`File exceeds ${limit / 1024 / 1024} MB`));
                    if (signature.length < 16) signature = Buffer.concat([signature, chunk]).subarray(0, 16);
                    hash.update(chunk);
                    done(null, chunk);
                },
            });
            await pipeline(
                file.createReadStream(),
                guard,
                createWriteStream(filePath, { flags: 'wx', mode: 0o600 }),
            );
            if (!size || !this.signatureMatches(file.mimetype, signature))
                throw new Error('File content does not match its type');
            let scanStatus = 'UNAVAILABLE';
            if (process.env.VENDOR_ONBOARDING_SCAN_COMMAND) {
                await promisify(execFile)(process.env.VENDOR_ONBOARDING_SCAN_COMMAND, [filePath], {
                    timeout: 60000,
                });
                scanStatus = 'CLEAN';
            } else if (process.env.VENDOR_ONBOARDING_REQUIRE_SCAN === 'true')
                throw new Error('Document scanning is unavailable. Try again later.');
            const checksum = hash.digest('hex');
            const duplicate = existing.find(
                f => f.fieldKey === fieldKey && f.checksum === checksum && f.scanStatus !== 'REJECTED',
            );
            if (duplicate) {
                await unlink(filePath);
                return duplicate;
            }
            const extension = (
                {
                    'application/pdf': '.pdf',
                    'image/png': '.png',
                    'image/jpeg': '.jpg',
                    'image/webp': '.webp',
                    'application/zip': '.zip',
                    'video/mp4': '.mp4',
                } as Record<string, string>
            )[file.mimetype];
            const safeName =
                path
                    .basename(String(file.filename))
                    .replace(/[\x00-\x1f]/g, '')
                    .slice(0, 160) || 'document';
            return await repo.save(
                new VendorOnboardingFile({
                    onboardingId: String(draft.id),
                    fieldKey,
                    name: `${path.parse(safeName).name}${extension}`,
                    mimeType: file.mimetype,
                    size,
                    storageKey,
                    checksum,
                    scanStatus,
                }),
            );
        } catch (error) {
            await unlink(filePath).catch(() => {});
            throw error;
        } finally {
            uploads.delete(key);
        }
    }

    async file(ctx: RequestContext, id: ID) {
        const file = await this.connection.getRepository(ctx, VendorOnboardingFile).findOneBy({ id });
        if (!file) throw new Error('Document not found');
        const draft = await this.connection
            .getRepository(ctx, VendorOnboarding)
            .findOneBy({ id: file.onboardingId });
        if (
            !draft ||
            (draft.ownerUserId !== String(ctx.activeUserId) &&
                !ctx.userHasPermissions([Permission.SuperAdmin]))
        )
            throw new Error('Document not found');
        return file;
    }

    async removeFile(ctx: RequestContext, id: ID) {
        const file = await this.file(ctx, id);
        const draft = await this.owned(ctx);
        await this.assertEmailAllowed(ctx, (await this.identity(ctx)).emailAddress);
        if (String(draft.id) !== file.onboardingId) throw new Error('Document not found');
        await this.assertEditable(ctx, draft);
        if (
            Object.values(this.answers(draft)).some(v =>
                Array.isArray(v) ? v.some(entry => entry === String(id)) : v === String(id),
            )
        )
            throw new Error('Remove the document from the form and save first');
        await this.connection.getRepository(ctx, VendorOnboardingFile).delete(file.id);
        await unlink(path.join(storageRoot(), file.storageKey)).catch(() => {});
        return true;
    }

    filePath(file: VendorOnboardingFile) {
        return path.join(storageRoot(), path.basename(file.storageKey));
    }

    async downloadToken(ctx: RequestContext, id: ID) {
        await this.file(ctx, id);
        const payload = `${id}.${Date.now() + 60000}`;
        return `${payload}.${createHmac('sha256', downloadSecret).update(payload).digest('hex')}`;
    }

    async consumeDownload(token: string) {
        const [id, expires, signature] = token.split('.');
        if (
            !/^\d+$/.test(id || '') ||
            !/^\d+$/.test(expires || '') ||
            !/^[a-f0-9]{64}$/.test(signature || '')
        )
            throw new Error('Invalid download');
        const expected = createHmac('sha256', downloadSecret).update(`${id}.${expires}`).digest();
        if (Number(expires) < Date.now() || !timingSafeEqual(expected, Buffer.from(signature!, 'hex')))
            throw new Error('Expired download');
        const file = await this.connection.rawConnection
            .getRepository(VendorOnboardingFile)
            .findOneByOrFail({ id });
        return { file, filePath: this.filePath(file) };
    }

    async approve(ctx: RequestContext, application: RoleApplication, vendor: VendorProfile) {
        const id = application.profileData?.onboardingId;
        if (!id) return;
        const draft = await this.connection
            .getRepository(ctx, VendorOnboarding)
            .findOneBy({ id: String(id) });
        if (!draft || draft.applicationId !== String(application.id))
            throw new Error('Onboarding application does not match');
        const a = this.answers(draft);
        if (Object.keys(validate(a)).length) throw new Error('Onboarding is incomplete');
        await this.assertFiles(ctx, draft, a);
        vendor.payoutAccount = {
            method: a.payoutMethod as any,
            accountHolderName: String(a.holderName),
            bankName: a.bankName ? String(a.bankName) : undefined,
            accountIdentifier: String(a.iban || a.walletNumber || a.jazzcashNumber),
            verificationStatus: 'PENDING',
            submittedAt: new Date().toISOString(),
        };
        vendor.contactEmail = String(a.supportEmail || a.contactEmail);
        if (a.supportPhone) vendor.phoneNumber = String(a.supportPhone);
        const cancellationPolicy = [
            a.bookingPolicy ? String(a.bookingPolicy) : '',
            a.reschedulingPolicy ? `Rescheduling: ${String(a.reschedulingPolicy)}` : '',
        ].filter(Boolean).join('\n\n');
        if (cancellationPolicy)
            vendor.policies = { ...(vendor.policies || {}), cancellations: cancellationPolicy };
        await this.connection.getRepository(ctx, VendorProfile).save(vendor);
        for (const [fieldKey, target, urlTarget] of [
            ['logo', 'logoAssetId', 'logoUrl'],
            ['banner', 'bannerAssetId', 'bannerUrl'],
        ] as const) {
            if (!a[fieldKey]) continue;
            const file = await this.connection
                .getRepository(ctx, VendorOnboardingFile)
                .findOneByOrFail({ id: String(a[fieldKey]) });
            const asset = await this.assets.createFromFileStream(
                Readable.from(createReadStream(this.filePath(file))),
                file.name,
                ctx,
            );
            if (isGraphQlErrorResult(asset)) throw new Error(asset.message);
            vendor[target] = String(asset.id);
            vendor[urlTarget] = asset.preview;
        }
        await this.connection.getRepository(ctx, VendorProfile).save(vendor);
    }

    async ownerForApplication(ctx: RequestContext, application: RoleApplication) {
        const id = application.profileData?.onboardingId;
        if (!id) return undefined;
        if (!['PENDING', 'UNDER_REVIEW', 'APPROVED'].includes(application.status))
            throw new Error('The applicant must resubmit the requested changes before approval');
        const draft = await this.connection
            .getRepository(ctx, VendorOnboarding)
            .findOneBy({ id: String(id), applicationId: String(application.id) });
        if (!draft || Object.keys(validate(this.answers(draft))).length)
            throw new Error('Onboarding is incomplete');
        await this.assertFiles(ctx, draft, this.answers(draft));
        return draft.ownerUserId;
    }

    private async identity(ctx: RequestContext) {
        if (!ctx.activeUserId) throw new Error('Sign in to continue');
        const user = await this.connection.getRepository(ctx, User).findOneBy({ id: ctx.activeUserId });
        const customer = await this.customers.findOneByUserId(ctx, ctx.activeUserId);
        if (!user?.verified || !customer) throw new Error('A verified customer account is required');
        return customer;
    }
    private async owned(ctx: RequestContext) {
        await this.identity(ctx);
        const draft = await this.connection
            .getRepository(ctx, VendorOnboarding)
            .findOneBy({ ownerUserId: String(ctx.activeUserId) });
        if (!draft) throw new Error('Start an application first');
        return draft;
    }
    private assertAdmin(ctx: RequestContext) {
        if (!ctx.userHasPermissions([Permission.SuperAdmin]))
            throw new Error('Administrator access required');
    }
    private async assertEditable(ctx: RequestContext, draft: VendorOnboarding) {
        if (!draft.applicationId) return;
        const application = await this.connection
            .getRepository(ctx, RoleApplication)
            .findOneBy({ id: draft.applicationId });
        if (application?.status === 'BLOCKED') throw new Error('This vendor application is blocked. Contact support for help.');
        if (application?.status !== 'CHANGES_REQUESTED' && application?.status !== 'REJECTED')
            throw new Error('This application is locked for review');
    }
    private assertEmailAllowed(ctx: RequestContext, email: string) {
        return assertVendorApplicationEmailAllowed(this.connection.getRepository(ctx, RoleApplication), email);
    }
    private answers(draft: VendorOnboarding): Answers {
        return Object.assign({}, ...Object.values(draft.sections));
    }
    private sections(a: Answers) {
        return Object.fromEntries(
            Array.from({ length: 8 }, (_, step) => [
                String(step),
                Object.fromEntries(
                    fields.filter(f => f.step === step && a[f.key] !== undefined).map(f => [f.key, a[f.key]]),
                ),
            ]),
        );
    }
    private async view(ctx: RequestContext, draft: VendorOnboarding) {
        const application = draft.applicationId
            ? await this.connection.getRepository(ctx, RoleApplication).findOneBy({ id: draft.applicationId })
            : null;
        const blocked = await blockedVendorApplication(this.connection.getRepository(ctx, RoleApplication), draft.emailAddress);
        const files = await this.connection
            .getRepository(ctx, VendorOnboardingFile)
            .findBy({ onboardingId: String(draft.id) });
        return {
            id: draft.id,
            version: draft.version,
            currentStep: Math.min(draft.currentStep, 7),
            updatedAt: draft.updatedAt,
            answers: this.answers(draft),
            files: files.map(({ id, fieldKey, name, mimeType, size, scanStatus }) => ({
                id,
                fieldKey,
                name,
                mimeType,
                size,
                scanStatus,
            })),
            status: blocked ? 'BLOCKED' : application?.status || 'DRAFT',
            rejectionCount: application?.rejectionCount ?? 0,
            reference: application?.reference,
            reviewNote: application?.reviewNote,
            blockedReason: blocked?.blockedReason,
            firstProductId: draft.firstProductId,
        };
    }
    private async assertFiles(ctx: RequestContext, draft: VendorOnboarding, a: Answers) {
        for (const field of visibleFields(a).filter(f => f.type === 'file' && a[f.key])) {
            const ids = Array.isArray(a[field.key]) ? (a[field.key] as string[]) : [String(a[field.key])];
            for (const id of ids) {
                const file = await this.connection
                    .getRepository(ctx, VendorOnboardingFile)
                    .findOneBy({ id, onboardingId: String(draft.id), fieldKey: field.key });
                if (!file || file.scanStatus === 'REJECTED') throw new Error(`Upload a valid ${field.label}`);
                if (process.env.VENDOR_ONBOARDING_REQUIRE_SCAN === 'true' && file.scanStatus !== 'CLEAN')
                    throw new Error('All documents must pass scanning before submission');
                const info = await stat(this.filePath(file)).catch(() => null);
                if (!info || info.size !== file.size)
                    throw new Error('A document is missing or damaged. Upload it again.');
                const hash = createHash('sha256');
                for await (const chunk of createReadStream(this.filePath(file))) hash.update(chunk);
                if (hash.digest('hex') !== file.checksum)
                    throw new Error('A document failed its integrity check. Upload it again.');
            }
        }
    }
    private async cleanupOrphanFiles(ctx: RequestContext, draft: VendorOnboarding, files: VendorOnboardingFile[]) {
        const answers = this.answers(draft);
        const referenced = new Set(
            fields.filter(field => field.type === 'file').flatMap(field => {
                const value = answers[field.key];
                return Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
            }),
        );
        const retained: VendorOnboardingFile[] = [];
        const repo = this.connection.getRepository(ctx, VendorOnboardingFile);
        for (const file of files) {
            // A file uploaded since the last saved version may still be selected in the browser.
            if (referenced.has(String(file.id)) || file.createdAt >= draft.updatedAt) {
                retained.push(file);
                continue;
            }
            await repo.delete(file.id);
            await unlink(this.filePath(file)).catch(() => {});
        }
        return retained;
    }
    private signatureMatches(mime: string, bytes: Buffer) {
        if (mime === 'application/pdf') return bytes.subarray(0, 5).toString() === '%PDF-';
        if (mime === 'image/png')
            return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
        if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (mime === 'image/webp')
            return bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
        if (mime === 'application/zip') return bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
        if (mime === 'video/mp4') return bytes.subarray(4, 8).toString() === 'ftyp';
        return false;
    }

}
