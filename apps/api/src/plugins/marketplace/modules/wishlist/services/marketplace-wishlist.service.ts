import { Injectable } from '@nestjs/common';
import { ForbiddenError, RequestContext, TransactionalConnection } from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In } from 'typeorm';

import { MarketplaceCatalogService } from '../../catalog/services/marketplace-catalog.service';
import { VendorService } from '../../vendor/services/vendor.service';
import {
    AddMarketplaceWishlistItemInput,
    CreateMarketplaceWishlistInput,
    MarketplaceWishlistItemType,
    MarketplaceWishlistVisibility,
    UpdateMarketplaceWishlistInput,
} from '../dto/wishlist.inputs';
import { MarketplaceWishlistItem } from '../entities/marketplace-wishlist-item.entity';
import { MarketplaceWishlist } from '../entities/marketplace-wishlist.entity';

@Injectable()
export class MarketplaceWishlistService {
    constructor(
        private connection: TransactionalConnection,
        private catalogService: MarketplaceCatalogService,
        private vendorService: VendorService,
    ) {}

    async findMine(ctx: RequestContext) {
        const ownerUserId = this.requireOwner(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceWishlist);
        let lists = await repository.find({ where: { ownerUserId }, order: { updatedAt: 'DESC' } });
        if (!lists.length) {
            lists = [await repository.save(new MarketplaceWishlist({
                ownerUserId,
                name: 'Later',
                visibility: 'PRIVATE',
                shareEnabled: false,
            }))];
        }
        return this.attachItems(ctx, lists, true);
    }

    async create(ctx: RequestContext, input: CreateMarketplaceWishlistInput) {
        const ownerUserId = this.requireOwner(ctx);
        const name = this.cleanName(input.name);
        await this.assertUniqueName(ctx, ownerUserId, name);
        const list = await this.connection.getRepository(ctx, MarketplaceWishlist).save(new MarketplaceWishlist({
            ownerUserId,
            name,
            description: this.cleanDescription(input.description),
            visibility: 'PRIVATE',
            shareEnabled: false,
        }));
        return this.toResult(list, [], true);
    }

    async update(ctx: RequestContext, input: UpdateMarketplaceWishlistInput) {
        const list = await this.getOwnedList(ctx, input.id);
        if (input.name !== undefined) {
            const name = this.cleanName(input.name);
            await this.assertUniqueName(ctx, list.ownerUserId, name, String(list.id));
            list.name = name;
        }
        if (input.description !== undefined) list.description = this.cleanDescription(input.description);
        await this.connection.getRepository(ctx, MarketplaceWishlist).save(list, { reload: false });
        return this.getOwnedResult(ctx, String(list.id));
    }

    async delete(ctx: RequestContext, id: string) {
        const list = await this.getOwnedList(ctx, id);
        await this.connection.getRepository(ctx, MarketplaceWishlistItem).delete({ wishlistId: String(list.id) });
        await this.connection.getRepository(ctx, MarketplaceWishlist).remove(list);
        return { success: true, message: 'Saved list deleted' };
    }

    async addItem(ctx: RequestContext, input: AddMarketplaceWishlistItemInput) {
        const list = await this.getOwnedList(ctx, input.wishlistId);
        const snapshot = await this.resolveItem(ctx, input.itemType, input.referenceId);
        const repository = this.connection.getRepository(ctx, MarketplaceWishlistItem);
        const existing = await repository.findOne({
            where: { wishlistId: String(list.id), itemType: snapshot.itemType, referenceId: snapshot.referenceId },
        });
        if (!existing) {
            await repository.save(new MarketplaceWishlistItem({ wishlistId: String(list.id), ...snapshot }));
        }
        return this.getOwnedResult(ctx, String(list.id));
    }

    async removeItem(ctx: RequestContext, wishlistId: string, itemId: string) {
        const list = await this.getOwnedList(ctx, wishlistId);
        const repository = this.connection.getRepository(ctx, MarketplaceWishlistItem);
        const item = await repository.findOne({ where: { id: itemId, wishlistId: String(list.id) } });
        if (!item) throw new Error('Saved item was not found');
        await repository.remove(item);
        return this.getOwnedResult(ctx, String(list.id));
    }

    async enableShare(ctx: RequestContext, id: string, visibility: MarketplaceWishlistVisibility) {
        const list = await this.getOwnedList(ctx, id);
        list.visibility = visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
        list.shareEnabled = true;
        list.shareToken ??= randomBytes(18).toString('base64url');
        list.shareAccessKey = list.visibility === 'PRIVATE'
            ? randomBytes(12).toString('base64url')
            : undefined;
        await this.connection.getRepository(ctx, MarketplaceWishlist).save(list, { reload: false });
        return this.getOwnedResult(ctx, String(list.id));
    }

    async disableShare(ctx: RequestContext, id: string) {
        const list = await this.getOwnedList(ctx, id);
        list.shareEnabled = false;
        list.shareAccessKey = undefined;
        await this.connection.getRepository(ctx, MarketplaceWishlist).save(list, { reload: false });
        return this.getOwnedResult(ctx, String(list.id));
    }

    async findShared(ctx: RequestContext, token: string, accessKey?: string) {
        const list = await this.connection.getRepository(ctx, MarketplaceWishlist).findOne({
            where: { shareToken: token.trim(), shareEnabled: true },
        });
        if (!list) return null;
        if (list.visibility === 'PRIVATE' && (!accessKey || accessKey !== list.shareAccessKey)) return null;
        const items = await this.connection.getRepository(ctx, MarketplaceWishlistItem).find({
            where: { wishlistId: String(list.id) },
            order: { createdAt: 'DESC' },
        });
        return this.toResult(list, items, false);
    }

    private async getOwnedResult(ctx: RequestContext, id: string) {
        const list = await this.getOwnedList(ctx, id);
        const items = await this.connection.getRepository(ctx, MarketplaceWishlistItem).find({
            where: { wishlistId: String(list.id) },
            order: { createdAt: 'DESC' },
        });
        return this.toResult(list, items, true);
    }

    private async attachItems(ctx: RequestContext, lists: MarketplaceWishlist[], includeAccessKey: boolean) {
        const ids = lists.map(list => String(list.id));
        const items = ids.length
            ? await this.connection.getRepository(ctx, MarketplaceWishlistItem).find({
                where: { wishlistId: In(ids) },
                order: { createdAt: 'DESC' },
            })
            : [];
        const itemsByWishlistId = new Map<string, MarketplaceWishlistItem[]>();
        for (const item of items) {
            const wishlistId = String(item.wishlistId);
            itemsByWishlistId.set(wishlistId, [...(itemsByWishlistId.get(wishlistId) ?? []), item]);
        }
        return lists.map(list => this.toResult(
            list,
            itemsByWishlistId.get(String(list.id)) ?? [],
            includeAccessKey,
        ));
    }

    private toResult(list: MarketplaceWishlist, items: MarketplaceWishlistItem[], includeAccessKey: boolean) {
        return {
            ...list,
            items,
            itemCount: items.length,
            shareAccessKey: includeAccessKey ? list.shareAccessKey : undefined,
        };
    }

    private async getOwnedList(ctx: RequestContext, id: string) {
        const list = await this.connection.getRepository(ctx, MarketplaceWishlist).findOne({
            where: { id, ownerUserId: this.requireOwner(ctx) },
        });
        if (!list) throw new Error('Saved list was not found');
        return list;
    }

    private async resolveItem(ctx: RequestContext, itemType: MarketplaceWishlistItemType, referenceId: string) {
        if (itemType === 'VENDOR') {
            const vendor = await this.vendorService.findPublicById(ctx, referenceId);
            if (!vendor) throw new Error('This vendor shop is no longer available');
            return {
                itemType,
                referenceId: String(vendor.id),
                name: vendor.shopName,
                slug: vendor.slug,
                image: vendor.logoUrl ?? vendor.bannerUrl,
                vendorName: vendor.shopName,
                vendorSlug: vendor.slug,
                category: vendor.categories?.join(', '),
                location: vendor.operatingLocations?.[0],
            };
        }
        const product = await this.catalogService.findPublicProductById(ctx, referenceId);
        if (!product) throw new Error('This listing is no longer available');
        const actualType: MarketplaceWishlistItemType = product.productType === 'SERVICE'
            ? 'SERVICE'
            : product.productType === 'WORKSHOP'
                ? 'WORKSHOP'
                : 'PRODUCT';
        if (itemType !== actualType) throw new Error('The saved item type does not match this listing');
        return {
            itemType: actualType,
            referenceId: String(product.id),
            name: product.name,
            slug: product.slug,
            image: product.featuredAsset?.preview,
            price: product.minPrice,
            compareAtPrice: product.variants?.[0]?.compareAtPrice,
            vendorName: product.vendorName,
            vendorSlug: product.vendorSlug,
            category: product.categoryName,
            location: product.location,
        };
    }

    private async assertUniqueName(ctx: RequestContext, ownerUserId: string, name: string, excludeId?: string) {
        const lists = await this.connection.getRepository(ctx, MarketplaceWishlist).find({ where: { ownerUserId } });
        const duplicate = lists.some(list => String(list.id) !== excludeId && list.name.toLowerCase() === name.toLowerCase());
        if (duplicate) throw new Error('You already have a saved list with this name');
    }

    private requireOwner(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }

    private cleanName(value: string) {
        const name = value?.trim().slice(0, 80);
        if (!name) throw new Error('Enter a name for this saved list');
        return name;
    }

    private cleanDescription(value?: string | null) {
        return value?.trim().slice(0, 500) || undefined;
    }
}
