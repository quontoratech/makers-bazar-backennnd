import { ID } from '@vendure/core';

export interface CreateArticleInput {
    slug: string;
    title: string;
    excerpt: string;
    body: string;
    featuredAssetId?: string;
    tags?: string[];
    relations?: Array<{ entityType: string; entityId: string }>;
    seo?: { title?: string; description?: string; socialAssetId?: string };
}

export interface UpdateArticleStatusInput {
    id: ID;
    status: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'SCHEDULED' | 'PUBLISHED' | 'ARCHIVED';
    publishedAt?: Date;
}
