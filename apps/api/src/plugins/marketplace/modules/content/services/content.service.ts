import { Injectable } from '@nestjs/common';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { assertFound, ID, RequestContext, TransactionalConnection } from '@vendure/core';

import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { requireActiveUserId } from '../../../shared/ownership';
import { CreateArticleInput, UpdateArticleStatusInput } from '../dto/article.inputs';
import { MarketplaceArticle } from '../entities/article.entity';

@Injectable()
export class ContentService {
    constructor(private connection: TransactionalConnection) {}

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
    ): Promise<MarketplaceList<MarketplaceArticle>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, MarketplaceArticle).findAndCount({
            skip,
            take,
            order: { updatedAt: 'DESC' },
        });
        return { items, totalItems };
    }

    findPublished(ctx: RequestContext): Promise<MarketplaceArticle[]> {
        return this.connection.getRepository(ctx, MarketplaceArticle).find({
            where: { status: 'PUBLISHED' },
            order: { publishedAt: 'DESC' },
            take: 20,
        });
    }

    findOne(ctx: RequestContext, id: ID): Promise<MarketplaceArticle | null> {
        return this.connection.getRepository(ctx, MarketplaceArticle).findOne({ where: { id } });
    }

    create(ctx: RequestContext, input: CreateArticleInput): Promise<MarketplaceArticle> {
        return this.connection.getRepository(ctx, MarketplaceArticle).save(
            new MarketplaceArticle({
                ...input,
                slug: normalizeString(input.slug || input.title, '-'),
                authorAdministratorId: String(requireActiveUserId(ctx)),
                status: 'DRAFT',
            }),
        );
    }

    async updateStatus(ctx: RequestContext, input: UpdateArticleStatusInput): Promise<MarketplaceArticle> {
        const article = await assertFound(this.findOne(ctx, input.id));
        article.status = input.status;
        article.publishedAt = input.status === 'PUBLISHED' ? (input.publishedAt ?? new Date()) : input.publishedAt;
        await this.connection.getRepository(ctx, MarketplaceArticle).save(article, { reload: false });
        return assertFound(this.findOne(ctx, article.id));
    }
}
