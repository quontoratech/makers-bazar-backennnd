import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { assertFound, ForbiddenError, ID, Order, Permission, RequestContext, TransactionalConnection } from '@vendure/core';
import { randomBytes } from 'node:crypto';
import { In, Not } from 'typeorm';

import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { assertResourceOwner, requireActiveUserId } from '../../../shared/ownership';
import { marketplaceOrderUsesShipping, resolveMarketplaceOrderFulfillmentType } from '../../order/order-workflow-policy';
import { MarketplaceOrderService } from '../../order/services/marketplace-order.service';
import { withPayoutTransaction } from '../../finance/payout-transaction';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { OpenMarketplaceReturnCaseInput, OpenSupportCaseInput, ReplyToSupportCaseInput, ResolveSupportCaseInput } from '../dto/support.inputs';
import { SupportCase } from '../entities/support-case.entity';
import { configuredReturnWindowDays, evaluateReturnWindow, MarketplaceReturnSelectionItem,
    returnSelectionCoversWholeOrder } from '../return-policy';

export const RETURN_DISPUTE_CATEGORY = 'RETURN_DISPUTE';

@Injectable()
export class SupportService {
    constructor(
        private connection: TransactionalConnection,
        private marketplaceOrderService: MarketplaceOrderService,
    ) {}

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
    ): Promise<MarketplaceList<SupportCase>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, SupportCase).findAndCount({
            where: this.isSuperAdmin(ctx) ? {} : { category: Not(RETURN_DISPUTE_CATEGORY) },
            skip,
            take,
            order: { updatedAt: 'DESC' },
        });
        return { items, totalItems };
    }

    async findReturnCases(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        sellerOrderIds?: ID[],
    ): Promise<MarketplaceList<SupportCase>> {
        this.requireSuperAdmin(ctx);
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, SupportCase).findAndCount({
            where: { category: RETURN_DISPUTE_CATEGORY,
                ...(sellerOrderIds ? { sellerOrderId: In(sellerOrderIds.map(String)) } : {}) },
            skip,
            take,
            order: { updatedAt: 'DESC', id: 'DESC' },
        });
        return { items, totalItems };
    }

    findOne(ctx: RequestContext, id: ID): Promise<SupportCase | null> {
        return this.connection.getRepository(ctx, SupportCase).findOne({ where: { id } });
    }

    async findMine(ctx: RequestContext): Promise<SupportCase[]> {
        const activeUserId = requireActiveUserId(ctx);
        return this.connection.getRepository(ctx, SupportCase).find({
            where: { openedByUserId: String(activeUserId) },
            order: { updatedAt: 'DESC' },
        });
    }

    async open(ctx: RequestContext, input: OpenSupportCaseInput): Promise<SupportCase> {
        const activeUserId = requireActiveUserId(ctx);
        const category = this.requiredText(input.category, 'Category', 80).toUpperCase();
        if (['RETURN', 'RETURN_DISPUTE', 'REFUND', 'DISPUTE'].includes(category)) {
            throw new Error('Use the order return appeal to request a return or refund');
        }
        let vendorProfileId = input.vendorProfileId;
        if (input.orderId) {
            const order = await this.customerOrder(ctx, input.orderId);
            if (order.type === OrderType.Seller) {
                const vendor = await this.vendorForOrder(ctx, order);
                if (vendorProfileId && vendorProfileId !== String(vendor.id)) {
                    throw new Error('The selected vendor does not own this order');
                }
                vendorProfileId = String(vendor.id);
            } else if (vendorProfileId) {
                throw new Error('Choose a seller order to contact a specific vendor');
            }
        } else if (vendorProfileId) {
            const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: vendorProfileId } });
            if (!vendor) throw new Error('Vendor was not found');
        }
        const now = new Date().toISOString();
        return this.connection.getRepository(ctx, SupportCase).save(
            new SupportCase({
                code: `CASE-${randomBytes(4).toString('hex').toUpperCase()}`,
                openedByUserId: String(activeUserId),
                vendorProfileId,
                orderId: input.orderId,
                category,
                subject: this.requiredText(input.subject, 'Subject', 180),
                priority: input.priority ?? 'NORMAL',
                status: 'OPEN',
                messages: [
                    {
                        authorId: String(activeUserId),
                        authorRole: 'CUSTOMER',
                        body: this.requiredText(input.message, 'Message', 4000),
                        createdAt: now,
                        assetIds: input.assetIds,
                    },
                ],
            }),
        );
    }

    async returnEligibility(ctx: RequestContext, sellerOrderId: ID, now = new Date()) {
        const order = await this.customerSellerOrder(ctx, sellerOrderId);
        const sellerOrderStatus = this.orderStatus(order);
        const windowDays = configuredReturnWindowDays();
        const window = evaluateReturnWindow(this.deliveryDate(order), now, windowDays);
        const prior = await this.connection.getRepository(ctx, SupportCase).find({
            where: { sellerOrderId: String(order.id) },
        });
        const committed = prior.filter(item => ['RETURN_APPROVED', 'RETURN_RECEIVED', 'REFUND_PENDING', 'REFUNDED'].includes(item.status));
        const returnableItems = order.lines.map(line => {
            const orderLineId = String(line.id);
            const consumed = committed.reduce((sum, item) => sum + (item.returnItems
                ? item.returnItems.find(selected => selected.orderLineId === orderLineId)?.quantity ?? 0
                : line.quantity), 0);
            return {
                orderLineId,
                quantity: Math.max(0, line.quantity - consumed),
                productName: line.productVariant?.product?.name,
                variantName: line.productVariant?.name,
                sku: line.productVariant?.sku,
            };
        }).filter(item => item.quantity > 0);
        const activeCase = prior.some(item => !['RETURN_REJECTED', 'REFUNDED'].includes(item.status));
        const reason = activeCase
            ? 'A return appeal is already in progress for this vendor order'
            : !returnableItems.length
                ? 'All purchased quantities have already been returned'
                : !['DELIVERED', 'FULFILLED'].includes(sellerOrderStatus)
                ? 'Return appeals can be opened after delivery or fulfillment'
                : window.reason;
        return {
            eligible: !reason && window.eligible,
            windowDays,
            deadlineAt: window.deadlineAt,
            reason,
            sellerOrderStatus,
            returnableItems,
        };
    }

    async openReturnCase(ctx: RequestContext, input: OpenMarketplaceReturnCaseInput): Promise<SupportCase> {
        return withPayoutTransaction(this.connection, ctx, transactionCtx => this.openReturnCaseLocked(transactionCtx, input));
    }

    private async openReturnCaseLocked(ctx: RequestContext, input: OpenMarketplaceReturnCaseInput): Promise<SupportCase> {
        const activeUserId = requireActiveUserId(ctx);
        const reason = this.requiredText(input.reason, 'Return reason', 4000);
        const order = await this.customerSellerOrder(ctx, input.sellerOrderId);
        const eligibility = await this.returnEligibility(ctx, input.sellerOrderId);
        if (!eligibility.eligible) throw new Error(eligibility.reason ?? 'This order is not eligible for a return appeal');
        const returnItems = this.validateReturnItems(order, input.items, eligibility.returnableItems);
        const vendor = await this.vendorForOrder(ctx, order);
        const caseItem = await this.connection.getRepository(ctx, SupportCase).save(new SupportCase({
            code: `CASE-${randomBytes(4).toString('hex').toUpperCase()}`,
            openedByUserId: String(activeUserId),
            vendorProfileId: String(vendor.id),
            orderId: String(order.id),
            sellerOrderId: String(order.id),
            returnItems,
            sellerOrderStatusBeforeReturn: eligibility.sellerOrderStatus as 'DELIVERED' | 'FULFILLED',
            category: RETURN_DISPUTE_CATEGORY,
            subject: `Return or order dispute for ${order.code}`,
            priority: 'HIGH',
            status: 'OPEN',
            returnWindowDays: eligibility.windowDays,
            returnDeadlineAt: eligibility.deadlineAt,
            returnRequired: marketplaceOrderUsesShipping(this.fulfillmentType(
                order.lines.filter(line => returnItems.some(item => item.orderLineId === String(line.id))),
            )),
            messages: [{
                authorId: String(activeUserId),
                authorRole: 'CUSTOMER',
                body: reason,
                createdAt: new Date().toISOString(),
                assetIds: input.assetIds,
            }],
        }));
        await this.marketplaceOrderService.requestCustomerReturn(ctx, String(order.id), reason);
        return caseItem;
    }

    async findVendorReturnCases(ctx: RequestContext): Promise<SupportCase[]> {
        const vendor = await this.ownedVendor(ctx);
        const cases = await this.connection.getRepository(ctx, SupportCase).find({
            where: { vendorProfileId: String(vendor.id), category: RETURN_DISPUTE_CATEGORY },
            order: { updatedAt: 'DESC' },
        });
        return cases.map(item => this.vendorView(item));
    }

    async replyAsVendor(ctx: RequestContext, id: ID, body: string): Promise<SupportCase> {
        const vendor = await this.ownedVendor(ctx);
        const supportCase = await this.returnCase(ctx, id);
        if (supportCase.vendorProfileId !== String(vendor.id)) throw new ForbiddenError();
        this.assertReturnOpen(supportCase);
        supportCase.internalMessages = [
            ...(supportCase.internalMessages ?? []),
            this.message(ctx, 'VENDOR', body),
        ];
        supportCase.status = 'OPEN';
        const saved = await this.connection.getRepository(ctx, SupportCase).save(supportCase);
        return this.vendorView(saved);
    }

    async messageReturnVendor(ctx: RequestContext, id: ID, body: string): Promise<SupportCase> {
        this.requireSuperAdmin(ctx);
        const supportCase = await this.returnCase(ctx, id);
        this.assertReturnOpen(supportCase);
        supportCase.internalMessages = [
            ...(supportCase.internalMessages ?? []),
            this.message(ctx, 'ADMIN', body),
        ];
        supportCase.status = 'WAITING_FOR_VENDOR';
        return this.connection.getRepository(ctx, SupportCase).save(supportCase);
    }

    async decideReturnCase(
        ctx: RequestContext,
        id: ID,
        decision: string,
        note: string,
        requiresReturn?: boolean,
    ): Promise<SupportCase> {
        return withPayoutTransaction(this.connection, ctx, transactionCtx =>
            this.decideReturnCaseLocked(transactionCtx, id, decision, note, requiresReturn));
    }

    private async decideReturnCaseLocked(
        ctx: RequestContext,
        id: ID,
        decision: string,
        note: string,
        requiresReturn?: boolean,
    ): Promise<SupportCase> {
        this.requireSuperAdmin(ctx);
        const supportCase = await this.returnCase(ctx, id);
        this.assertReturnOpen(supportCase);
        if (!(supportCase.internalMessages ?? []).some(message => message.authorRole === 'ADMIN')) {
            throw new Error('Contact the vendor in this case before deciding the return appeal');
        }
        const decisionNote = this.requiredText(note, 'Decision note', 2000);
        const normalized = String(decision ?? '').trim().toUpperCase();
        if (!['APPROVE', 'REJECT'].includes(normalized)) throw new Error('Decision must be APPROVE or REJECT');
        if (normalized === 'APPROVE') {
            if (requiresReturn === true && supportCase.returnRequired === false) {
                throw new Error('This digital or service order cannot require a physical return');
            }
            supportCase.returnRequired = requiresReturn ?? supportCase.returnRequired ?? true;
            if (await this.isWholeOrderReturn(ctx, supportCase)) {
                await this.marketplaceOrderService.transitionReturnStatus(
                    ctx, supportCase.sellerOrderId!, 'RETURN_APPROVED', decisionNote,
                );
            }
            supportCase.status = 'RETURN_APPROVED';
            supportCase.decision = decisionNote;
        } else {
            await this.marketplaceOrderService.transitionReturnStatus(
                ctx, supportCase.sellerOrderId!, 'RETURN_REJECTED', decisionNote,
            );
            await this.marketplaceOrderService.restoreAfterReturn(
                ctx, supportCase.sellerOrderId!, supportCase.sellerOrderStatusBeforeReturn ?? 'FULFILLED', decisionNote,
            );
            supportCase.status = 'RETURN_REJECTED';
            supportCase.decision = decisionNote;
            supportCase.resolvedAt = new Date();
        }
        supportCase.messages = [
            ...(supportCase.messages ?? []),
            this.message(ctx, 'ADMIN', decisionNote),
        ];
        return this.connection.getRepository(ctx, SupportCase).save(supportCase);
    }

    async markReturnReceived(ctx: RequestContext, id: ID, note: string): Promise<SupportCase> {
        return withPayoutTransaction(this.connection, ctx, transactionCtx =>
            this.markReturnReceivedLocked(transactionCtx, id, note));
    }

    private async markReturnReceivedLocked(ctx: RequestContext, id: ID, note: string): Promise<SupportCase> {
        this.requireSuperAdmin(ctx);
        const supportCase = await this.returnCase(ctx, id);
        if (supportCase.status !== 'RETURN_APPROVED' || !supportCase.returnRequired) {
            throw new Error('Only an approved physical return can be marked received');
        }
        const receiptNote = this.requiredText(note, 'Receipt note', 2000);
        if (await this.isWholeOrderReturn(ctx, supportCase)) {
            await this.marketplaceOrderService.transitionReturnStatus(
                ctx, supportCase.sellerOrderId!, 'RETURNED', receiptNote,
            );
        }
        supportCase.status = 'RETURN_RECEIVED';
        supportCase.messages = [
            ...(supportCase.messages ?? []),
            this.message(ctx, 'ADMIN', receiptNote),
        ];
        return this.connection.getRepository(ctx, SupportCase).save(supportCase);
    }

    async replyAsOwner(ctx: RequestContext, input: ReplyToSupportCaseInput): Promise<SupportCase> {
        const supportCase = await assertFound(this.findOne(ctx, input.id));
        assertResourceOwner(ctx, supportCase.openedByUserId);
        if (supportCase.status === 'CLOSED' || (supportCase.category !== RETURN_DISPUTE_CATEGORY && supportCase.status === 'RESOLVED')) {
            throw new Error('This support case is closed');
        }
        return this.appendPublicReply(ctx, supportCase, input.body, 'CUSTOMER', input.assetIds);
    }

    async replyAsAdmin(ctx: RequestContext, input: ReplyToSupportCaseInput): Promise<SupportCase> {
        const supportCase = await assertFound(this.findOne(ctx, input.id));
        if (supportCase.category === RETURN_DISPUTE_CATEGORY) this.requireSuperAdmin(ctx);
        if (supportCase.status === 'CLOSED' || (supportCase.category !== RETURN_DISPUTE_CATEGORY && supportCase.status === 'RESOLVED')) {
            throw new Error('This support case is closed');
        }
        return this.appendPublicReply(ctx, supportCase, input.body, 'ADMIN', input.assetIds);
    }

    async resolve(ctx: RequestContext, input: ResolveSupportCaseInput): Promise<SupportCase> {
        const supportCase = await assertFound(this.findOne(ctx, input.id));
        if (supportCase.category === RETURN_DISPUTE_CATEGORY) {
            throw new Error('Use the return decision and refund workflow for order disputes');
        }
        if (input.financialAdjustment != null && input.financialAdjustment !== 0) {
            throw new Error('Financial adjustments must be recorded through the customer refund workflow');
        }
        supportCase.status = 'RESOLVED';
        supportCase.decision = this.requiredText(input.decision, 'Decision', 2000);
        supportCase.financialAdjustment = 0;
        supportCase.resolvedAt = new Date();
        await this.connection.getRepository(ctx, SupportCase).save(supportCase, { reload: false });
        return assertFound(this.findOne(ctx, supportCase.id));
    }

    private async appendPublicReply(
        ctx: RequestContext,
        supportCase: SupportCase,
        body: string,
        role: 'CUSTOMER' | 'ADMIN',
        assetIds?: string[],
    ): Promise<SupportCase> {
        supportCase.messages = [
            ...(supportCase.messages ?? []),
            { ...this.message(ctx, role, body), assetIds },
        ];
        if (supportCase.category !== RETURN_DISPUTE_CATEGORY ||
            ['OPEN', 'WAITING_FOR_VENDOR', 'WAITING_FOR_CUSTOMER', 'ESCALATED'].includes(supportCase.status)) {
            supportCase.status = role === 'CUSTOMER' ? 'OPEN' : 'WAITING_FOR_CUSTOMER';
        }
        return this.connection.getRepository(ctx, SupportCase).save(supportCase);
    }

    private message(ctx: RequestContext, role: string, body: string) {
        return {
            authorId: String(requireActiveUserId(ctx)),
            authorRole: role,
            body: this.requiredText(body, 'Message', 4000),
            createdAt: new Date().toISOString(),
        };
    }

    private async returnCase(ctx: RequestContext, id: ID) {
        const supportCase = await assertFound(this.findOne(ctx, id));
        if (supportCase.category !== RETURN_DISPUTE_CATEGORY || !supportCase.sellerOrderId) {
            throw new Error('Return appeal was not found');
        }
        return supportCase;
    }

    private async isWholeOrderReturn(ctx: RequestContext, supportCase: SupportCase) {
        const order = await this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.lines', 'lines')
            .where('order.id = :id', { id: supportCase.sellerOrderId })
            .getOne();
        if (!order) throw new Error('The vendor order could not be found');
        return returnSelectionCoversWholeOrder(order.lines, supportCase.returnItems);
    }

    private assertReturnOpen(supportCase: SupportCase) {
        if (!['OPEN', 'WAITING_FOR_VENDOR', 'WAITING_FOR_CUSTOMER', 'ESCALATED'].includes(supportCase.status)) {
            throw new Error('This return appeal has already been decided');
        }
    }

    private vendorView(supportCase: SupportCase): SupportCase {
        return Object.assign(Object.create(Object.getPrototypeOf(supportCase)), supportCase, {
            openedByUserId: 'CUSTOMER',
            messages: [],
        });
    }

    private async ownedVendor(ctx: RequestContext) {
        const userId = String(requireActiveUserId(ctx));
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { ownerUserId: userId, status: 'APPROVED' },
        });
        if (!vendor) throw new ForbiddenError();
        return vendor;
    }

    private customerOrder(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('customer.user', 'customerUser')
            .leftJoinAndSelect('order.channels', 'channels')
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'variant')
            .leftJoinAndSelect('variant.product', 'product')
            .where('order.id = :id', { id })
            .andWhere('order.active = :active', { active: false })
            .andWhere('customerUser.id = :userId', { userId: requireActiveUserId(ctx) })
            .getOne()
            .then(order => {
                if (!order) throw new ForbiddenError();
                return order;
            });
    }

    private async customerSellerOrder(ctx: RequestContext, id: ID) {
        const order = await this.customerOrder(ctx, id);
        if (order.type !== OrderType.Seller) throw new Error('Choose a vendor order for this return appeal');
        return order;
    }

    private async vendorForOrder(ctx: RequestContext, order: Order) {
        const channelIds = new Set(order.channels.map(channel => String(channel.id)));
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendor = vendors.find(item => item.channelId && channelIds.has(item.channelId));
        if (!vendor) throw new Error('The order vendor could not be found');
        return vendor;
    }

    private fulfillmentType(lines: Order['lines']) {
        return resolveMarketplaceOrderFulfillmentType(lines.map(line =>
            (line.productVariant?.product?.customFields as Record<string, unknown> | undefined)?.marketplaceType,
        ));
    }

    private validateReturnItems(
        order: Order,
        items: OpenMarketplaceReturnCaseInput['items'],
        returnableItems: MarketplaceReturnSelectionItem[],
    ) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Select at least one product and quantity for the return appeal');
        }
        const lines = new Map(order.lines.map(line => [String(line.id), line]));
        const remaining = new Map(returnableItems.map(item => [item.orderLineId, item.quantity]));
        const seen = new Set<string>();
        return items.map(item => {
            const orderLineId = String(item?.orderLineId ?? '').trim();
            const line = lines.get(orderLineId);
            if (!line) throw new Error('A selected product does not belong to this vendor order');
            if (seen.has(orderLineId)) throw new Error('Each product can only be selected once');
            seen.add(orderLineId);
            const maximum = remaining.get(orderLineId) ?? 0;
            if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > maximum) {
                throw new Error(`Return quantity must be between 1 and ${maximum} for each selected product`);
            }
            return {
                orderLineId, quantity: item.quantity,
                productName: line.productVariant?.product?.name,
                variantName: line.productVariant?.name,
                sku: line.productVariant?.sku,
            };
        });
    }

    private orderStatus(order: Order) {
        return String((order.customFields as Record<string, unknown> | undefined)?.marketplaceStatus ?? 'PENDING')
            .trim().toUpperCase();
    }

    private deliveryDate(order: Order) {
        const fields = order.customFields as Record<string, unknown> | undefined;
        const raw = fields?.marketplaceDeliveredAt
            || (['DELIVERED', 'FULFILLED'].includes(this.orderStatus(order)) ? fields?.marketplaceStatusUpdatedAt : undefined);
        const date = raw ? new Date(String(raw)) : undefined;
        return date && Number.isFinite(date.getTime()) ? date : undefined;
    }

    private requiredText(value: unknown, label: string, maxLength: number) {
        const cleaned = String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
        if (cleaned.length < 3) throw new Error(`${label} must contain at least 3 characters`);
        return cleaned.slice(0, maxLength).trim();
    }

    private isSuperAdmin(ctx: RequestContext) {
        return ctx.userHasPermissions([Permission.SuperAdmin]);
    }

    private requireSuperAdmin(ctx: RequestContext) {
        if (!ctx.activeUserId || !this.isSuperAdmin(ctx)) throw new ForbiddenError();
    }
}
