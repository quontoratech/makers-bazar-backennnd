import { Controller, Get, Param, Res } from '@nestjs/common';
import { Args, Mutation, Query, Resolver } from '@nestjs/graphql';
import { Allow, Ctx, Permission, RequestContext, Transaction } from '@vendure/core';
import type { Response } from 'express';
import gql from 'graphql-tag';
import { createReadStream } from 'node:fs';
import { VendorOnboardingService } from './services/vendor-onboarding.service';

export const onboardingCommonSchema = gql`
    type VendorOnboardingFile {
        id: ID!
        fieldKey: String!
        name: String!
        mimeType: String!
        size: Int!
        scanStatus: String!
    }
    type VendorOnboardingDraft {
        id: ID!
        version: Int!
        currentStep: Int!
        updatedAt: DateTime!
        answers: JSON!
        files: [VendorOnboardingFile!]!
        status: String!
        rejectionCount: Int!
        reference: String
        reviewNote: String
        blockedReason: String
        firstProductId: ID
    }
`;
export const onboardingShopSchema = gql`
    ${onboardingCommonSchema}
    input SaveVendorOnboardingInput {
        version: Int!
        step: Int!
        answers: JSON!
        validateStep: Int
    }
    extend type Query {
        myVendorOnboarding: VendorOnboardingDraft!
        vendorOnboardingDownloadToken(id: ID!): String!
    }
    extend type Mutation {
        saveVendorOnboarding(input: SaveVendorOnboardingInput!): VendorOnboardingDraft!
        submitVendorOnboarding(version: Int!): VendorOnboardingDraft!
        uploadVendorOnboardingFile(fieldKey: String!, file: Upload!): VendorOnboardingFile!
        removeVendorOnboardingFile(id: ID!): Boolean!
    }
`;
export const onboardingAdminSchema = gql`
    ${onboardingCommonSchema}
    extend type Query {
        vendorOnboarding(id: ID!): VendorOnboardingDraft!
        myApprovedVendorOnboarding: VendorOnboardingDraft
        vendorOnboardingDownloadToken(id: ID!): String!
    }
`;

@Resolver()
export class VendorOnboardingShopResolver {
    constructor(private onboarding: VendorOnboardingService) {}
    @Query()
    @Allow(Permission.Authenticated)
    myVendorOnboarding(@Ctx() ctx: RequestContext) {
        return this.onboarding.mine(ctx);
    }
    @Query()
    @Allow(Permission.Authenticated)
    vendorOnboardingDownloadToken(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.onboarding.downloadToken(ctx, args.id);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    saveVendorOnboarding(
        @Ctx() ctx: RequestContext,
        @Args() args: { input: { version: number; step: number; answers: unknown; validateStep?: number } },
    ) {
        return this.onboarding.save(ctx, args.input);
    }
    @Mutation()
    @Transaction()
    @Allow(Permission.Authenticated)
    submitVendorOnboarding(@Ctx() ctx: RequestContext, @Args() args: { version: number }) {
        return this.onboarding.submit(ctx, args.version);
    }
    @Mutation()
    @Allow(Permission.Authenticated)
    uploadVendorOnboardingFile(
        @Ctx() ctx: RequestContext,
        @Args() args: { fieldKey: string; file: Promise<any> },
    ) {
        return this.onboarding.upload(ctx, args.fieldKey, args.file);
    }
    @Mutation()
    @Allow(Permission.Authenticated)
    removeVendorOnboardingFile(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.onboarding.removeFile(ctx, args.id);
    }
}
@Resolver()
export class VendorOnboardingAdminResolver {
    constructor(private onboarding: VendorOnboardingService) {}
    @Query()
    @Allow(Permission.SuperAdmin)
    vendorOnboarding(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.onboarding.review(ctx, args.id);
    }
    @Query()
    @Allow(Permission.Authenticated)
    myApprovedVendorOnboarding(@Ctx() ctx: RequestContext) {
        return this.onboarding.approvedForOwner(ctx);
    }
    @Query()
    @Allow(Permission.Authenticated)
    vendorOnboardingDownloadToken(@Ctx() ctx: RequestContext, @Args() args: { id: string }) {
        return this.onboarding.downloadToken(ctx, args.id);
    }
}

@Controller('vendor-onboarding-documents')
export class VendorOnboardingDownloadController {
    constructor(private onboarding: VendorOnboardingService) {}
    @Get(':token')
    async download(@Param('token') token: string, @Res() response: Response) {
        try {
            const { file, filePath } = await this.onboarding.consumeDownload(token);
            response.setHeader('Content-Type', file.mimeType);
            response.setHeader(
                'Content-Disposition',
                `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
            );
            response.setHeader('Cache-Control', 'private, no-store');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            const stream = createReadStream(filePath);
            stream.on('error', () => response.destroy());
            stream.pipe(response);
        } catch {
            response.status(404).json({ message: 'Document unavailable' });
        }
    }
}
