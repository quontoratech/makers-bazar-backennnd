import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { assertFound, ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { randomBytes } from 'node:crypto';

import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { requireActiveUserId } from '../../../shared/ownership';
import { ApplyAsAffiliateInput, ReviewAffiliateInput } from '../dto/affiliate.inputs';
import { AffiliateProfile } from '../entities/affiliate-profile.entity';

@Injectable()
export class AffiliateService {
    constructor(private connection: TransactionalConnection) {}

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
    ): Promise<MarketplaceList<AffiliateProfile>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, AffiliateProfile).findAndCount({
            skip,
            take,
            order: { createdAt: 'DESC' },
        });
        return { items, totalItems };
    }

    findOne(ctx: RequestContext, id: ID): Promise<AffiliateProfile | null> {
        return this.connection.getRepository(ctx, AffiliateProfile).findOne({ where: { id } });
    }

    findMine(ctx: RequestContext): Promise<AffiliateProfile | null> {
        const activeUserId = requireActiveUserId(ctx);
        return this.connection.getRepository(ctx, AffiliateProfile).findOne({
            where: { customerId: String(activeUserId) },
        });
    }

    async apply(ctx: RequestContext, input: ApplyAsAffiliateInput): Promise<AffiliateProfile> {
        const activeUserId = requireActiveUserId(ctx);
        const repository = this.connection.getRepository(ctx, AffiliateProfile);
        const existing = await repository.findOne({ where: { customerId: String(activeUserId) } });
        if (existing) {
            throw new Error('An influencer application already exists for this account');
        }
        return repository.save(
            new AffiliateProfile({
                ...input,
                customerId: String(activeUserId),
                slug: normalizeString(input.slug || input.displayName, '-'),
                referralCode: randomBytes(5).toString('hex').toUpperCase(),
                status: 'PENDING',
            }),
        );
    }

    async review(ctx: RequestContext, input: ReviewAffiliateInput): Promise<AffiliateProfile> {
        const profile = await assertFound(this.findOne(ctx, input.id));
        profile.status = input.status;
        if (input.commissionPercent != null) {
            profile.commissionPercent = input.commissionPercent;
        }
        await this.connection.getRepository(ctx, AffiliateProfile).save(profile, { reload: false });
        return assertFound(this.findOne(ctx, profile.id));
    }
}
