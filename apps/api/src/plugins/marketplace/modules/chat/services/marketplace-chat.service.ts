import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import {
    Customer,
    ForbiddenError,
    Order,
    Permission,
    Product,
    ProductVariant,
    RequestContext,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { In, IsNull, LessThan, MoreThan, Not } from 'typeorm';

import { MarketplaceReportEvidence } from '../../report/entities/marketplace-report-evidence.entity';
import { MarketplaceReport } from '../../report/entities/marketplace-report.entity';
import { MarketplaceVendorAppealEvidence } from '../../report/entities/marketplace-vendor-appeal-evidence.entity';
import { MarketplaceVendorAppeal } from '../../report/entities/marketplace-vendor-appeal.entity';
import { MarketplaceRewardRedemption } from '../../review/entities/marketplace-reward-redemption.entity';
import { MarketplaceCouponRedemption } from '../../promotion/entities/marketplace-coupon-redemption.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { MarketplaceCategory } from '../../catalog/entities/marketplace-category.entity';
import { MarketplaceFormTemplate } from '../../catalog/entities/marketplace-form-template.entity';
import { MarketplaceListingCategory } from '../../catalog/entities/marketplace-listing-category.entity';
import { marketplaceListingRequiresShipping } from '../../catalog/catalog-shipping-policy';
import {
    calculateMarketplaceChatReceiptTotals,
    canAccessMarketplaceChat,
    marketplaceOrderChatEnabled,
    normalizeMarketplaceChatOrderReceipt,
} from '../chat-policy';
import {
    CreateMarketplaceListingInquiryInput,
    CreateMarketplaceListingQuoteInput,
    MarketplaceChatListOptions,
    SendMarketplaceChatMessageInput,
} from '../dto/marketplace-chat.inputs';
import { MarketplaceChatAttachment } from '../entities/marketplace-chat-attachment.entity';
import {
    MarketplaceChatConversation,
    MarketplaceChatSenderRole,
} from '../entities/marketplace-chat-conversation.entity';
import {
    MarketplaceChatMessage,
    MarketplaceChatInquirySummary,
    MarketplaceChatOrderReceipt,
} from '../entities/marketplace-chat-message.entity';
import { MarketplaceChatReadState } from '../entities/marketplace-chat-read-state.entity';
import { MarketplaceListingQuote } from '../entities/marketplace-listing-quote.entity';
import { MarketplaceChatRealtimeService } from './marketplace-chat-realtime.service';
import type { MarketplaceBooking } from '../../booking/entities/booking.entity';

const SOCKET_TICKET_TTL_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_MESSAGES_PER_MINUTE = 30;
const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const MAX_ATTACHMENT_SIZE_MB = 100;
const MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
const ORDER_CHAT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const ORPHAN_ATTACHMENT_LIFETIME_MS = 24 * 60 * 60 * 1000;
const STANDARD_ORDER_CHAT_DISABLED_REASON = 'Chat is unavailable for standard product orders';

const CHAT_ATTACHMENT_TYPES = new Map<string, string>([
    ['image/jpeg', '.jpg'],
    ['image/png', '.png'],
    ['image/webp', '.webp'],
    ['image/gif', '.gif'],
    ['application/pdf', '.pdf'],
    ['text/plain', '.txt'],
    ['text/csv', '.csv'],
    ['application/zip', '.zip'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
    ['application/msword', '.doc'],
    ['application/vnd.ms-excel', '.xls'],
]);

interface MarketplaceChatUploadInput {
    file: Promise<{
        filename: string;
        mimetype: string;
        createReadStream: () => NodeJS.ReadableStream;
    }>;
}

interface MarketplaceEscalationInput {
    conversationType: 'CUSTOMER_APPEAL' | 'VENDOR_APPEAL';
    sourceId: string;
    sourceCode: string;
    participantUserId: string;
    participantId: string;
    participantName: string;
    participantEmail: string;
    subject: string;
    statement: string;
    adminNote?: string;
    evidence: Array<{ id: string | number; name: string; mimeType: string; preview: string }>;
}

export interface MarketplaceChatPrincipal {
    userId: string;
    role: MarketplaceChatSenderRole;
    displayName: string;
    expiresAt?: number;
    nonce?: string;
}

@Injectable()
export class MarketplaceChatService {
    constructor(
        private connection: TransactionalConnection,
        private realtime: MarketplaceChatRealtimeService,
    ) {}

    async listCustomerConversations(ctx: RequestContext, options?: MarketplaceChatListOptions) {
        return this.listForPrincipal(ctx, await this.customerPrincipal(ctx), options);
    }

    async customerConversation(ctx: RequestContext, id: string) {
        return this.getForPrincipal(ctx, await this.customerPrincipal(ctx), id);
    }

    async sendCustomerMessage(ctx: RequestContext, input: SendMarketplaceChatMessageInput) {
        return this.sendForPrincipal(ctx, await this.customerPrincipal(ctx), input);
    }

    async markCustomerConversationRead(ctx: RequestContext, id: string) {
        return this.markReadForPrincipal(ctx, await this.customerPrincipal(ctx), id);
    }

    async customerSocketTicket(ctx: RequestContext) {
        return this.createSocketTicket(await this.customerPrincipal(ctx));
    }

    async uploadCustomerAttachments(ctx: RequestContext, conversationId: string, inputs: MarketplaceChatUploadInput[]) {
        return this.uploadAttachments(ctx, await this.customerPrincipal(ctx), conversationId, inputs);
    }

    async customerAttachment(ctx: RequestContext, id: string) {
        return this.downloadAttachment(ctx, await this.customerPrincipal(ctx), id);
    }

    async createCustomerListingInquiry(ctx: RequestContext, input: CreateMarketplaceListingInquiryInput) {
        const principal = await this.customerPrincipal(ctx);
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { user: { id: principal.userId } },
            relations: ['user'],
        });
        if (!customer) throw new ForbiddenError();
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: String(input.productId), enabled: true },
            relations: ['translations', 'channels'],
        });
        if (!product || !product.channels.some(channel => String(channel.id) === String(ctx.channelId))) {
            throw new Error('This listing is no longer available');
        }
        const listingCategory = await this.connection.getRepository(ctx, MarketplaceListingCategory).findOne({
            where: { productId: String(product.id), isPrimary: true },
        });
        const category = listingCategory ? await this.connection.getRepository(ctx, MarketplaceCategory).findOne({
            where: { id: listingCategory.categoryId },
        }) : null;
        if (!category) throw new Error('This listing has no active marketplace category');
        const vendorId = String((product.customFields as Record<string, unknown> | undefined)?.vendorProfileId ?? '');
        const vendor = vendorId ? await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: vendorId } }) : null;
        if (!vendor?.ownerUserId) throw new Error('The listing vendor is unavailable');

        const formTemplate = category.formTemplateId
            ? await this.connection.getRepository(ctx, MarketplaceFormTemplate).findOne({ where: { id: category.formTemplateId } })
            : null;
        const isDigitalProject = formTemplate?.key === 'custom_digital_project';
        const productMetadata = (product.customFields as Record<string, unknown> | undefined)?.marketplaceMetadata;
        let isMonthlyWorkshop = false;
        if (typeof productMetadata === 'string') {
            try {
                const attributes = (JSON.parse(productMetadata) as { attributes?: Record<string, unknown> }).attributes ?? {};
                isMonthlyWorkshop = String((product.customFields as Record<string, unknown> | undefined)?.marketplaceType ?? '') === 'WORKSHOP'
                    && attributes.billing_model === 'Monthly subscription';
            } catch {
                isMonthlyWorkshop = false;
            }
        }
        if (!category.chatEnabled && !isMonthlyWorkshop) throw new Error('Chat with vendor is not enabled for this category');
        if (isMonthlyWorkshop && input.inquiryType && input.inquiryType !== 'CLASS_SUBSCRIPTION') {
            throw new Error('Use the class subscription inquiry form for this listing');
        }
        if (isDigitalProject && input.inquiryType && input.inquiryType !== 'DIGITAL_PROJECT') {
            throw new Error('Submit a digital project brief for this listing');
        }
        if (!isDigitalProject && input.inquiryType === 'DIGITAL_PROJECT') {
            throw new Error('This listing accepts event requirements');
        }
        const summary = this.normalizeInquiry(input, product, category, isDigitalProject, isMonthlyWorkshop);
        const conversationRepository = this.conversationRepository(ctx);
        let conversation = await conversationRepository.findOne({
            where: {
                conversationType: 'LISTING_INQUIRY',
                sourceId: String(product.id),
                customerUserId: principal.userId,
                vendorId: String(vendor.id),
                status: 'OPEN',
            },
        });
        if (!conversation) {
            conversation = await conversationRepository.save(new MarketplaceChatConversation({
                customerId: String(customer.id),
                customerUserId: principal.userId,
                customerName: principal.displayName,
                customerEmail: customer.emailAddress,
                vendorId: String(vendor.id),
                vendorOwnerUserId: vendor.ownerUserId,
                vendorName: vendor.shopName,
                status: 'OPEN',
                conversationType: 'LISTING_INQUIRY',
                sourceId: String(product.id),
                sourceCode: summary.productSlug,
                lastMessageAt: new Date(),
                lastMessagePreview: summary.inquiryType === 'DIGITAL_PROJECT'
                    ? `New ${summary.projectType} brief`
                    : summary.inquiryType === 'CLASS_SUBSCRIPTION'
                        ? `Class timing question for ${summary.className}`
                    : `New ${summary.eventType} inquiry`,
                lastSenderRole: 'CUSTOMER',
            }));
        }
        const message = await this.messageRepository(ctx).save(new MarketplaceChatMessage({
            conversationId: String(conversation.id),
            senderUserId: principal.userId,
            senderName: principal.displayName,
            senderRole: 'CUSTOMER',
            kind: 'INQUIRY_SUMMARY',
                body: summary.inquiryType === 'DIGITAL_PROJECT'
                ? `${summary.projectTitle} creative brief requesting ${summary.conceptCount} concepts`
                : summary.inquiryType === 'CLASS_SUBSCRIPTION'
                    ? `${summary.className} class subscription question`
                : `${summary.eventType} inquiry for ${summary.guestCount} guests in ${summary.city}`,
            automated: false,
            clientMessageId: `inquiry:${randomUUID()}`,
            metadata: { inquirySummary: summary },
        }));
        await this.touchConversation(ctx, conversation, message);
        await this.upsertReadState(ctx, conversation, principal, message.createdAt);
        const mapped = await this.mapConversation(ctx, conversation, principal, true);
        this.realtime.publishMessage(conversation, this.mapMessage(message));
        return mapped;
    }

    async customerListingQuote(ctx: RequestContext, id: string) {
        const principal = await this.customerPrincipal(ctx);
        const quote = await this.requireListingQuote(ctx, id, principal.userId);
        return this.listingQuoteShape(ctx, quote);
    }

    async createVendorListingQuote(ctx: RequestContext, input: CreateMarketplaceListingQuoteInput) {
        const principal = await this.adminPrincipal(ctx);
        if (principal.role !== 'VENDOR') throw new ForbiddenError();
        const conversation = await this.authorizedConversation(ctx, principal, String(input.conversationId));
        if (conversation.conversationType !== 'LISTING_INQUIRY' || conversation.status !== 'OPEN') {
            throw new Error('Personalized quotations can only be sent in an open listing inquiry');
        }
        const amount = Number(input.amount);
        if (!Number.isInteger(amount) || amount < 100) throw new Error('Quotation amount must be at least PKR 1');
        const validUntil = new Date(input.validUntil);
        if (!Number.isFinite(validUntil.getTime()) || validUntil.getTime() <= Date.now()) {
            throw new Error('Choose a future quotation expiry date');
        }
        if (validUntil.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
            throw new Error('A quotation cannot remain open for more than 90 days');
        }
        const addOns = this.normalizeListingQuoteAddOns(input.addOns);
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: conversation.sourceId },
            relations: ['variants'],
        });
        const variant = product?.variants?.find(item => item.enabled) ?? product?.variants?.[0];
        if (!product || !variant) throw new Error('The inquiry listing no longer has an available checkout option');
        const repository = this.connection.getRepository(ctx, MarketplaceListingQuote);
        const previous = await repository.find({
            where: { conversationId: String(conversation.id), status: 'SENT' },
        });
        for (const item of previous) item.status = 'SUPERSEDED';
        if (previous.length) await repository.save(previous, { reload: false });
        const quote = await repository.save(new MarketplaceListingQuote({
            code: `Q-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
            conversationId: String(conversation.id),
            productId: String(product.id),
            productVariantId: String(variant.id),
            customerId: conversation.customerId,
            customerUserId: conversation.customerUserId,
            vendorId: conversation.vendorId,
            vendorOwnerUserId: conversation.vendorOwnerUserId,
            amount,
            currencyCode: 'PKR',
            description: this.cleanBody(input.description),
            addOns,
            status: 'SENT',
            validUntil,
        }));
        const quoteSummary = this.quoteSummary(quote);
        const message = await this.messageRepository(ctx).save(new MarketplaceChatMessage({
            conversationId: String(conversation.id),
            senderUserId: principal.userId,
            senderName: principal.displayName,
            senderRole: 'VENDOR',
            kind: 'QUOTE',
            body: quote.description || `Personalized quotation ${quote.code}`,
            automated: false,
            clientMessageId: `quote:${quote.code}`,
            metadata: { quote: quoteSummary },
        }));
        await this.touchConversation(ctx, conversation, message);
        await this.upsertReadState(ctx, conversation, principal, message.createdAt);
        const mapped = this.mapMessage(message);
        this.realtime.publishMessage(conversation, mapped);
        return mapped;
    }

    async confirmCustomerListingQuoteOrder(ctx: RequestContext, quoteId: string, orderId: string) {
        const principal = await this.customerPrincipal(ctx);
        const quote = await this.requireListingQuote(ctx, quoteId, principal.userId);
        const order = await this.orderQuery(ctx).where('order.id = :orderId', { orderId }).getOne();
        if (!order || String(order.customer?.user?.id ?? '') !== principal.userId) throw new ForbiddenError();
        const matchingLine = order.lines.some(line => String((line.customFields as Record<string, unknown>)?.marketplaceQuoteId ?? '') === String(quote.id));
        if (!matchingLine) throw new Error('The placed order does not match this personalized quotation');
        quote.status = 'PAID';
        quote.orderId = String(order.id);
        quote.orderCode = order.code;
        await this.connection.getRepository(ctx, MarketplaceListingQuote).save(quote, { reload: false });
        const messages = await this.messageRepository(ctx).find({
            where: { conversationId: quote.conversationId, kind: 'QUOTE' },
        });
        for (const message of messages) {
            if (message.metadata?.quote?.id !== String(quote.id)) continue;
            message.metadata = { ...message.metadata, quote: this.quoteSummary(quote) };
            await this.messageRepository(ctx).save(message, { reload: false });
        }
        return this.listingQuoteShape(ctx, quote);
    }

    async listAdminConversations(ctx: RequestContext, options?: MarketplaceChatListOptions) {
        return this.listForPrincipal(ctx, await this.adminPrincipal(ctx), options);
    }

    async adminConversation(ctx: RequestContext, id: string) {
        return this.getForPrincipal(ctx, await this.adminPrincipal(ctx), id);
    }

    async sendAdminMessage(ctx: RequestContext, input: SendMarketplaceChatMessageInput) {
        return this.sendForPrincipal(ctx, await this.adminPrincipal(ctx), input);
    }

    async markAdminConversationRead(ctx: RequestContext, id: string) {
        return this.markReadForPrincipal(ctx, await this.adminPrincipal(ctx), id);
    }

    async adminSocketTicket(ctx: RequestContext) {
        return this.createSocketTicket(await this.adminPrincipal(ctx));
    }

    async uploadAdminAttachments(ctx: RequestContext, conversationId: string, inputs: MarketplaceChatUploadInput[]) {
        return this.uploadAttachments(ctx, await this.adminPrincipal(ctx), conversationId, inputs);
    }

    async adminAttachment(ctx: RequestContext, id: string) {
        return this.downloadAttachment(ctx, await this.adminPrincipal(ctx), id);
    }

    async listForSocket(principal: MarketplaceChatPrincipal, options?: MarketplaceChatListOptions) {
        await this.validateSocketPrincipal(principal);
        return this.listForPrincipal(undefined, principal, options);
    }

    async getForSocket(principal: MarketplaceChatPrincipal, id: string) {
        await this.validateSocketPrincipal(principal);
        return this.getForPrincipal(undefined, principal, id);
    }

    async sendForSocket(principal: MarketplaceChatPrincipal, input: SendMarketplaceChatMessageInput) {
        await this.validateSocketPrincipal(principal);
        return this.sendForPrincipal(undefined, principal, input);
    }

    async markReadForSocket(principal: MarketplaceChatPrincipal, id: string) {
        await this.validateSocketPrincipal(principal);
        return this.markReadForPrincipal(undefined, principal, id);
    }

    async ensureForSellerOrders(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        const conversations = [];
        for (const sellerOrder of sellerOrders) {
            const conversation = await this.ensureForSellerOrder(ctx, aggregateOrder, sellerOrder);
            if (conversation) conversations.push(conversation);
        }
        return conversations;
    }

    async reconcileOrderConversations(ctx: RequestContext) {
        const sellerOrders = await this.orderQuery(ctx)
            .where('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .orderBy('order.id', 'ASC')
            .getMany();
        let created = 0;
        for (const sellerOrder of sellerOrders) {
            if (!sellerOrder.aggregateOrder) continue;
            const existing = await this.connection.getRepository(ctx, MarketplaceChatConversation).findOne({
                where: { sellerOrderId: String(sellerOrder.id) },
            });
            if (!marketplaceOrderChatEnabled(sellerOrder.lines)) {
                if (existing) await this.disableStandardOrderConversation(ctx, existing);
                continue;
            }
            if (existing) {
                await this.syncOrderConversationLifecycle(ctx, existing, sellerOrder);
                continue;
            }
            if (await this.ensureForSellerOrder(ctx, sellerOrder.aggregateOrder, sellerOrder)) created += 1;
        }
        await this.closeExpiredConversations(ctx);
        await this.cleanupOrphanAttachments(ctx);
        return created;
    }

    async recordOrderStatusUpdate(
        ctx: RequestContext,
        sellerOrder: Order,
        status: string,
        statusLabel: string,
        statusNote?: string,
    ) {
        const conversationRepository = this.connection.getRepository(ctx, MarketplaceChatConversation);
        const conversation = await conversationRepository.findOne({
            where: { sellerOrderId: String(sellerOrder.id) },
        });
        if (!conversation || conversation.closedReason === STANDARD_ORDER_CHAT_DISABLED_REASON) return;
        if (this.isDeliveredStatus(status) && !conversation.closeAt) {
            conversation.closeAt = new Date(Date.now() + ORDER_CHAT_LIFETIME_MS);
            await conversationRepository.save(conversation, { reload: false });
        }
        const clientMessageId = `status:${sellerOrder.id}:${status}`;
        const messageRepository = this.connection.getRepository(ctx, MarketplaceChatMessage);
        const existing = await messageRepository.findOne({
            where: { senderUserId: conversation.vendorOwnerUserId, clientMessageId },
        });
        if (existing) return;
        const body = statusNote
            ? `Order status changed to ${statusLabel}. ${this.cleanBody(statusNote)}`
            : `Order status changed to ${statusLabel}.`;
        const message = await messageRepository.save(new MarketplaceChatMessage({
            conversationId: String(conversation.id),
            senderUserId: conversation.vendorOwnerUserId,
            senderName: conversation.vendorName,
            senderRole: 'VENDOR',
            kind: 'ORDER_STATUS',
            body,
            automated: true,
            clientMessageId,
            metadata: { orderStatus: status, statusNote: statusNote || undefined },
        }));
        await this.touchConversation(ctx, conversation, message);
        this.realtime.publishMessage(conversation, this.mapMessage(message));
    }

    private async subscriptionConversation(ctx: RequestContext, booking: MarketplaceBooking) {
        if (!booking.orderId) return null;
        const order = await this.orderQuery(ctx).where('order.id = :orderId', { orderId: booking.orderId }).getOne();
        if (!order) return null;
        const conversation = await this.ensureForSellerOrder(ctx, order.aggregateOrder ?? order, order);
        if (!conversation) return null;
        // A monthly enrollment needs its conversation throughout access and renewal.
        if (!['CANCELLED', 'TERMINATED', 'REFUNDED'].includes(booking.status)) {
            conversation.status = 'OPEN';
            conversation.closedAt = undefined;
            conversation.closedReason = undefined;
            conversation.closeAt = new Date((booking.graceEndsAt ?? booking.endsAt).getTime() + ORDER_CHAT_LIFETIME_MS);
            await this.conversationRepository(ctx).save(conversation, { reload: false });
        }
        return conversation;
    }

    async recordSubscriptionRenewal(ctx: RequestContext, booking: MarketplaceBooking, amount: number) {
        const conversation = await this.subscriptionConversation(ctx, booking);
        if (!conversation || !booking.renewalToken || !booking.graceEndsAt) return;
        const code = `renewal:${booking.id}:${booking.endsAt.getTime()}`;
        const repository = this.messageRepository(ctx);
        if (await repository.findOne({ where: { senderUserId: conversation.vendorOwnerUserId, clientMessageId: code } })) return;
        const variant = await this.connection.getRepository(ctx, ProductVariant).findOne({ where: { id: booking.productVariantId } });
        const periodDays = Math.max(1, Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / (24 * 60 * 60 * 1000)));
        const nextStartsAt = new Date(booking.endsAt.getTime() + 24 * 60 * 60 * 1000);
        const nextEndsAt = new Date(nextStartsAt.getTime() + periodDays * 24 * 60 * 60 * 1000);
        const message = await repository.save(new MarketplaceChatMessage({
            conversationId: String(conversation.id), senderUserId: conversation.vendorOwnerUserId,
            senderName: conversation.vendorName, senderRole: 'VENDOR', kind: 'QUOTE', automated: true,
            clientMessageId: code,
            body: `Renew your ${booking.subscriptionClassName || booking.title} class subscription for ${periodDays} days.`,
            metadata: { quote: {
                id: code, code, productId: String(variant?.productId ?? ''), productVariantId: booking.productVariantId,
                amount, currencyCode: 'PKR', addOns: [], status: 'SENT', validUntil: booking.graceEndsAt.toISOString(),
                description: `${booking.subscriptionClassName || booking.title}: ${periodDays} days of class access from ${nextStartsAt.toLocaleDateString('en-PK')} to ${nextEndsAt.toLocaleDateString('en-PK')}. Payment deadline: ${booking.graceEndsAt.toLocaleString('en-PK')}. Unpaid enrollment ends after this deadline.`,
                checkoutUrl: `/subscriptions/renew?token=${encodeURIComponent(booking.renewalToken)}`,
            } },
        }));
        await this.touchConversation(ctx, conversation, message);
        this.realtime.publishMessage(conversation, this.mapMessage(message));
    }

    async recordSubscriptionUpdate(ctx: RequestContext, booking: MarketplaceBooking, body: string, quoteStatus?: string) {
        const conversation = await this.subscriptionConversation(ctx, booking);
        if (!conversation) return;
        const repository = this.messageRepository(ctx);
        const status = quoteStatus ?? (['CANCELLED', 'TERMINATED', 'REFUNDED', 'CANCELLATION_REQUESTED'].includes(booking.status) ? 'CANCELLED' : undefined);
        if (status) {
            const quotes = await repository.find({ where: { conversationId: String(conversation.id), kind: 'QUOTE' } });
            for (const message of quotes) {
                if (message.metadata?.quote?.code.startsWith(`renewal:${booking.id}:`) && message.metadata.quote.status === 'SENT') {
                    message.metadata.quote.status = status;
                    await repository.save(message, { reload: false });
                    this.realtime.publishMessage(conversation, this.mapMessage(message));
                }
            }
        }
        const message = await repository.save(new MarketplaceChatMessage({
            conversationId: String(conversation.id), senderUserId: conversation.vendorOwnerUserId,
            senderName: conversation.vendorName, senderRole: 'VENDOR', kind: 'TEXT', automated: true,
            clientMessageId: `booking:${booking.id}:${randomUUID()}`, body,
        }));
        await this.touchConversation(ctx, conversation, message);
        this.realtime.publishMessage(conversation, this.mapMessage(message));
    }

    async assertVendorDeliverableAttached(ctx: RequestContext, sellerOrderId: string, vendorOwnerUserId: string) {
        const conversation = await this.connection.getRepository(ctx, MarketplaceChatConversation).findOne({
            where: { sellerOrderId, conversationType: 'ORDER' },
        });
        if (!conversation) {
            throw new Error('The paid order conversation must be available before completing this project');
        }
        const deliveredFiles = await this.connection.getRepository(ctx, MarketplaceChatAttachment).count({
            where: {
                conversationId: String(conversation.id),
                uploadedByUserId: vendorOwnerUserId,
                messageId: Not(IsNull()),
            },
        });
        if (!deliveredFiles) {
            throw new Error('Attach the final project files in the paid order conversation before marking the project completed');
        }
    }

    async ensureForApprovedReport(
        ctx: RequestContext,
        report: MarketplaceReport,
        evidence: MarketplaceReportEvidence[],
    ) {
        if (report.supportConversationId) {
            return this.conversationRepository(ctx).findOne({ where: { id: report.supportConversationId } });
        }
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { ownerUserId: report.reportedByUserId },
        });
        if (vendor) {
            return this.ensureEscalationConversation(ctx, {
                conversationType: 'VENDOR_APPEAL',
                sourceId: String(report.id),
                sourceCode: report.code,
                participantUserId: report.reportedByUserId,
                participantId: String(vendor.id),
                participantName: vendor.shopName,
                participantEmail: report.reporterEmail,
                subject: report.subject,
                statement: report.description,
                adminNote: report.adminNote,
                evidence,
            });
        }
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { user: { id: report.reportedByUserId } },
            relations: ['user'],
        });
        if (!customer) throw new Error('The approved report is not connected to an active customer or vendor account');
        return this.ensureEscalationConversation(ctx, {
            conversationType: 'CUSTOMER_APPEAL',
            sourceId: String(report.id),
            sourceCode: report.code,
            participantUserId: report.reportedByUserId,
            participantId: String(customer.id),
            participantName: `${customer.firstName} ${customer.lastName}`.trim() || report.reporterName,
            participantEmail: customer.emailAddress || report.reporterEmail,
            subject: report.subject,
            statement: report.description,
            adminNote: report.adminNote,
            evidence,
        });
    }

    async ensureForApprovedVendorAppeal(
        ctx: RequestContext,
        appeal: MarketplaceVendorAppeal,
        evidence: MarketplaceVendorAppealEvidence[],
    ) {
        if (appeal.supportConversationId) {
            return this.conversationRepository(ctx).findOne({ where: { id: appeal.supportConversationId } });
        }
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { id: appeal.vendorProfileId },
        });
        if (!vendor?.ownerUserId) throw new Error('The approved appeal is not connected to an active vendor account');
        return this.ensureEscalationConversation(ctx, {
            conversationType: 'VENDOR_APPEAL',
            sourceId: String(appeal.id),
            sourceCode: appeal.reportCode,
            participantUserId: vendor.ownerUserId,
            participantId: String(vendor.id),
            participantName: vendor.shopName,
            participantEmail: '',
            subject: `Restriction appeal ${appeal.reportCode}`,
            statement: appeal.statement,
            adminNote: appeal.adminNote,
            evidence,
        });
    }

    verifySocketTicket(token: unknown): MarketplaceChatPrincipal {
        const value = String(token ?? '');
        const [payload, signature] = value.split('.');
        if (!payload || !signature) throw new Error('Chat connection ticket is missing or invalid');
        const expected = Buffer.from(this.signTicket(payload));
        const supplied = Buffer.from(signature);
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
            throw new Error('Chat connection ticket is invalid');
        }
        let principal: MarketplaceChatPrincipal;
        try {
            principal = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MarketplaceChatPrincipal;
        } catch {
            throw new Error('Chat connection ticket is invalid');
        }
        if (!principal.userId || !principal.role || !principal.expiresAt || principal.expiresAt <= Date.now()) {
            throw new Error('Chat connection ticket has expired');
        }
        return principal;
    }

    private async ensureForSellerOrder(ctx: RequestContext, aggregateOrder: Order, sellerOrder: Order) {
        const hydrated = await this.orderQuery(ctx)
            .where('order.id = :orderId', { orderId: sellerOrder.id })
            .getOne();
        if (!hydrated?.customer?.user) return;
        const conversationRepository = this.connection.getRepository(ctx, MarketplaceChatConversation);
        const existing = await conversationRepository.findOne({
            where: { sellerOrderId: String(sellerOrder.id) },
        });
        if (!marketplaceOrderChatEnabled(hydrated.lines)) {
            if (existing) await this.disableStandardOrderConversation(ctx, existing);
            return;
        }
        if (existing) return existing;

        const vendor = await this.vendorForOrder(ctx, hydrated);
        if (!vendor?.ownerUserId) return;
        const customerName = `${hydrated.customer.firstName} ${hydrated.customer.lastName}`.trim() || 'Customer';
        const now = new Date();
        let conversation: MarketplaceChatConversation;
        try {
            conversation = await conversationRepository.save(new MarketplaceChatConversation({
                sellerOrderId: String(hydrated.id),
                sellerOrderCode: hydrated.code,
                customerOrderId: String(hydrated.aggregateOrder?.id ?? aggregateOrder.id),
                customerOrderCode: hydrated.aggregateOrder?.code ?? aggregateOrder.code,
                customerId: String(hydrated.customer.id),
                customerUserId: String(hydrated.customer.user.id),
                customerName,
                customerEmail: hydrated.customer.emailAddress,
                vendorId: String(vendor.id),
                vendorOwnerUserId: vendor.ownerUserId,
                vendorName: vendor.shopName,
                status: 'OPEN',
                conversationType: 'ORDER',
                sourceId: String(hydrated.id),
                sourceCode: hydrated.code,
                closeAt: this.isDeliveredStatus(hydrated.state)
                    ? new Date(hydrated.updatedAt.getTime() + ORDER_CHAT_LIFETIME_MS)
                    : undefined,
                lastMessageAt: now,
                lastMessagePreview: `Order ${hydrated.aggregateOrder?.code ?? aggregateOrder.code} received`,
                lastSenderRole: 'VENDOR',
            }));
        } catch (error) {
            const concurrentlyCreated = await conversationRepository.findOne({
                where: { sellerOrderId: String(hydrated.id) },
            });
            if (concurrentlyCreated) return concurrentlyCreated;
            throw error;
        }

        const receipt = await this.orderReceipt(ctx, hydrated, conversation);
        const messageRepository = this.connection.getRepository(ctx, MarketplaceChatMessage);
        const summary = await messageRepository.save(new MarketplaceChatMessage({
            conversationId: String(conversation.id),
            senderUserId: vendor.ownerUserId,
            senderName: vendor.shopName,
            senderRole: 'VENDOR',
            kind: 'ORDER_SUMMARY',
            body: `Order receipt ${receipt.customerOrderCode}`,
            automated: true,
            clientMessageId: `order-summary:${hydrated.id}`,
            metadata: { orderReceipt: receipt },
        }));
        const greeting = await messageRepository.save(new MarketplaceChatMessage({
            conversationId: String(conversation.id),
            senderUserId: vendor.ownerUserId,
            senderName: vendor.shopName,
            senderRole: 'VENDOR',
            kind: 'AUTOMATED_GREETING',
            body: `Hey ${customerName}, thanks for buying from ${vendor.shopName}. We have received your order and will keep you updated here.`,
            automated: true,
            clientMessageId: `order-greeting:${hydrated.id}`,
        }));
        await this.touchConversation(ctx, conversation, greeting);
        await this.upsertReadState(ctx, conversation, {
            userId: vendor.ownerUserId,
            role: 'VENDOR',
        }, greeting.createdAt);
        this.realtime.publishMessage(conversation, this.mapMessage(summary));
        this.realtime.publishMessage(conversation, this.mapMessage(greeting));
        await this.syncOrderConversationLifecycle(ctx, conversation, hydrated);
        return conversation;
    }

    private async orderReceipt(
        ctx: RequestContext,
        order: Order,
        conversation: MarketplaceChatConversation,
    ): Promise<MarketplaceChatOrderReceipt> {
        const lines = order.lines.map(line => {
            const variantTranslation = line.productVariant.translations?.[0];
            const productTranslation = line.productVariant.product?.translations?.[0];
            return {
                orderLineId: String(line.id),
                productName: productTranslation?.name || variantTranslation?.name || `Item ${line.id}`,
                variantName: variantTranslation?.name || line.productVariant.sku,
                sku: line.productVariant.sku,
                quantity: line.quantity,
                unitPrice: line.discountedUnitPriceWithTax,
                lineTotal: line.discountedLinePriceWithTax,
            };
        });
        const itemsBeforeDiscount = order.lines.reduce(
            (total, line) => total + Math.max(line.discountedLinePriceWithTax, line.linePriceWithTax),
            0,
        );
        const productSubtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
        const shipping = Math.max(0, order.shippingWithTax);
        const taxIncluded = Math.max(0,
            order.lines.reduce((total, line) => total + line.discountedLinePriceWithTax - line.discountedLinePrice, 0)
            + order.shippingWithTax - order.shipping,
        );
        const redemptions = await this.connection.getRepository(ctx, MarketplaceRewardRedemption).find();
        const allocation = redemptions.flatMap(redemption => redemption.allocations ?? [])
            .find(item => item.sellerOrderId === String(order.id) && !item.reversedAt);
        const rewardFunding = Math.max(0, allocation?.amount ?? 0);
        const rewardCoins = Math.max(0, allocation?.coins ?? 0);
        const couponRedemptions = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).find();
        const couponRedemption = couponRedemptions.find(redemption => (redemption.allocations ?? [])
            .some(item => item.sellerOrderId === String(order.id) && !item.reversedAt));
        const couponAllocation = couponRedemption?.allocations?.find(item => item.sellerOrderId === String(order.id));
        const couponDiscount = Math.max(0, couponAllocation?.amount ?? 0);
        const totals = calculateMarketplaceChatReceiptTotals({
            itemsBeforeDiscount,
            productSubtotal,
            shipping,
            rewardCoins,
            rewardFunding,
            couponDiscount,
        });
        return {
            sellerOrderCode: conversation.sellerOrderCode ?? order.code,
            customerOrderCode: conversation.customerOrderCode ?? order.code,
            currencyCode: String(order.currencyCode),
            lines,
            itemsBeforeDiscount,
            discount: totals.discount,
            productSubtotal,
            rewardCoins,
            rewardFunding,
            couponCode: couponRedemption?.couponCode,
            couponDiscount,
            couponFundingSource: couponRedemption?.fundingSource,
            customerFundedProductAmount: totals.customerFundedProductAmount,
            shipping,
            taxIncluded,
            orderTotal: totals.orderTotal,
            customerPaidTotal: totals.customerPaidTotal,
            placedAt: (order.orderPlacedAt ?? order.createdAt).toISOString(),
        };
    }

    private async ensureEscalationConversation(ctx: RequestContext, input: MarketplaceEscalationInput) {
        const repository = this.conversationRepository(ctx);
        const syntheticOrderId = `${input.conversationType.toLowerCase()}:${input.sourceId}`;
        const existing = await repository.findOne({ where: { sellerOrderId: syntheticOrderId } });
        if (existing) return existing;
        const reviewer = await this.adminPrincipal(ctx);
        if (reviewer.role !== 'ADMIN' && reviewer.role !== 'SUPER_ADMIN') {
            throw new ForbiddenError();
        }
        const now = new Date();
        const customerAppeal = input.conversationType === 'CUSTOMER_APPEAL';
        let conversation: MarketplaceChatConversation;
        try {
            conversation = await repository.save(new MarketplaceChatConversation({
                sellerOrderId: syntheticOrderId,
                sellerOrderCode: input.sourceCode,
                customerOrderId: syntheticOrderId,
                customerOrderCode: input.sourceCode,
                customerId: customerAppeal ? input.participantId : 'MARKETPLACE_ADMIN',
                customerUserId: customerAppeal ? input.participantUserId : reviewer.userId,
                customerName: customerAppeal ? input.participantName : 'Marketplace support',
                customerEmail: customerAppeal ? input.participantEmail : '',
                vendorId: customerAppeal ? 'MARKETPLACE_ADMIN' : input.participantId,
                vendorOwnerUserId: customerAppeal ? reviewer.userId : input.participantUserId,
                vendorName: customerAppeal ? 'Marketplace support' : input.participantName,
                status: 'OPEN',
                conversationType: input.conversationType,
                sourceId: input.sourceId,
                sourceCode: input.sourceCode,
                lastMessageAt: now,
                lastMessagePreview: `Appeal ${input.sourceCode} approved`,
                lastSenderRole: reviewer.role,
            }));
        } catch (error) {
            const concurrentlyCreated = await repository.findOne({ where: { sellerOrderId: syntheticOrderId } });
            if (concurrentlyCreated) return concurrentlyCreated;
            throw error;
        }
        const message = await this.messageRepository(ctx).save(new MarketplaceChatMessage({
            conversationId: String(conversation.id),
            senderUserId: reviewer.userId,
            senderName: reviewer.displayName,
            senderRole: reviewer.role,
            kind: 'APPEAL_SUMMARY',
            body: `Your appeal ${input.sourceCode} was approved. You can now communicate directly with marketplace support in this channel.`,
            automated: true,
            clientMessageId: `appeal-approved:${input.conversationType}:${input.sourceId}`,
            metadata: {
                appealSummary: {
                    appealType: input.conversationType,
                    reference: input.sourceCode,
                    subject: input.subject,
                    statement: input.statement,
                    adminNote: input.adminNote,
                    evidence: input.evidence.map(item => ({
                        id: String(item.id),
                        name: item.name,
                        mimeType: item.mimeType,
                        preview: item.preview,
                    })),
                },
            },
        }));
        await this.touchConversation(ctx, conversation, message);
        await this.upsertReadState(ctx, conversation, reviewer, message.createdAt);
        this.realtime.publishMessage(conversation, this.mapMessage(message));
        return conversation;
    }

    private async uploadAttachments(
        ctx: RequestContext,
        principal: MarketplaceChatPrincipal,
        conversationId: string,
        inputs: MarketplaceChatUploadInput[],
    ) {
        const conversation = await this.authorizedConversation(ctx, principal, conversationId);
        if (conversation.status !== 'OPEN') throw new Error('This conversation is closed');
        if (!inputs.length) throw new Error('Choose at least one image or file');
        if (inputs.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            throw new Error(`Attach no more than ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message`);
        }
        const repository = this.attachmentRepository(ctx);
        const saved: MarketplaceChatAttachment[] = [];
        for (const input of inputs) {
            const file = await input.file;
            const mimeType = String(file.mimetype ?? '').toLowerCase().split(';')[0] ?? '';
            const extension = CHAT_ATTACHMENT_TYPES.get(mimeType);
            if (!extension) throw new Error(`${file.filename} is not an allowed image or document type`);
            const data = await this.readUpload(file.createReadStream(), file.filename);
            this.assertAttachmentSignature(data, mimeType, file.filename);
            const directory = path.join(this.attachmentRoot(), String(conversation.id));
            await mkdir(directory, { recursive: true });
            const storageKey = `${conversation.id}/${randomUUID()}${extension}`;
            const target = this.attachmentPath(storageKey);
            const temporary = `${target}.uploading`;
            await writeFile(temporary, data, { flag: 'wx' });
            await rename(temporary, target);
            try {
                saved.push(await repository.save(new MarketplaceChatAttachment({
                    conversationId: String(conversation.id),
                    uploadedByUserId: principal.userId,
                    name: this.cleanAttachmentName(file.filename, extension),
                    mimeType,
                    size: data.length,
                    storageKey,
                    checksum: createHash('sha256').update(data).digest('hex'),
                })));
            } catch (error) {
                await unlink(target).catch(() => undefined);
                throw error;
            }
        }
        return saved.map(item => this.mapAttachment(item));
    }

    private async downloadAttachment(
        ctx: RequestContext,
        principal: MarketplaceChatPrincipal,
        id: string,
    ) {
        const attachment = await this.attachmentRepository(ctx).findOne({ where: { id } });
        if (!attachment) throw new Error('Chat attachment was not found');
        await this.authorizedConversation(ctx, principal, attachment.conversationId);
        if (!attachment.messageId && attachment.uploadedByUserId !== principal.userId
            && principal.role !== 'ADMIN' && principal.role !== 'SUPER_ADMIN') {
            throw new ForbiddenError();
        }
        const data = await readFile(this.attachmentPath(attachment.storageKey));
        const checksum = createHash('sha256').update(data).digest('hex');
        if (data.length !== attachment.size || checksum !== attachment.checksum) {
            throw new Error('Chat attachment integrity check failed');
        }
        return {
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            data: data.toString('base64'),
        };
    }

    private async readUpload(stream: NodeJS.ReadableStream, filename: string) {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream as AsyncIterable<Buffer | string>) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > MAX_ATTACHMENT_SIZE) {
                if ('destroy' in stream && typeof stream.destroy === 'function') stream.destroy();
                throw new Error(`${filename} is larger than ${MAX_ATTACHMENT_SIZE_MB} MB`);
            }
            chunks.push(buffer);
        }
        if (!size) throw new Error(`${filename} is empty`);
        return Buffer.concat(chunks, size);
    }

    private assertAttachmentSignature(data: Buffer, mimeType: string, filename: string) {
        const starts = (...bytes: number[]) => bytes.every((byte, index) => data[index] === byte);
        const valid = mimeType === 'image/jpeg' ? starts(0xff, 0xd8, 0xff)
            : mimeType === 'image/png' ? starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
            : mimeType === 'image/webp' ? data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP'
            : mimeType === 'image/gif' ? ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())
            : mimeType === 'application/pdf' ? data.subarray(0, 5).toString() === '%PDF-'
            : mimeType === 'text/plain' || mimeType === 'text/csv' ? !data.includes(0)
            : mimeType === 'application/msword' || mimeType === 'application/vnd.ms-excel' ? starts(0xd0, 0xcf, 0x11, 0xe0)
            : starts(0x50, 0x4b, 0x03, 0x04) || starts(0x50, 0x4b, 0x05, 0x06) || starts(0x50, 0x4b, 0x07, 0x08);
        if (!valid) throw new Error(`${filename} content does not match its file type`);
    }

    private cleanAttachmentName(filename: string, extension: string) {
        const base = path.basename(String(filename ?? 'attachment'))
            .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '-')
            .trim()
            .slice(0, 170);
        const nameWithoutExtension = base.slice(0, Math.max(1, base.length - path.extname(base).length)) || 'attachment';
        return `${nameWithoutExtension}${extension}`;
    }

    private attachmentRoot() {
        return path.resolve(process.env.CHAT_ATTACHMENT_DIR ?? path.join(process.cwd(), 'private', 'marketplace-chat'));
    }

    private attachmentPath(storageKey: string) {
        const root = this.attachmentRoot();
        const resolved = path.resolve(root, storageKey);
        if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('Chat attachment path is invalid');
        return resolved;
    }

    private mapAttachment(attachment: MarketplaceChatAttachment) {
        return {
            id: String(attachment.id),
            createdAt: attachment.createdAt,
            name: attachment.name,
            mimeType: attachment.mimeType,
            size: attachment.size,
            isImage: attachment.mimeType.startsWith('image/'),
            downloadUrl: `/api/chat/attachments/${attachment.id}`,
        };
    }

    private async closeExpiredConversations(ctx?: RequestContext) {
        const repository = this.conversationRepository(ctx);
        const expired = await repository.find({
            where: { status: 'OPEN', closeAt: LessThan(new Date()) },
        });
        for (const conversation of expired) {
            conversation.status = 'CLOSED';
            conversation.closedAt = conversation.closeAt ?? new Date();
            conversation.closedReason = 'Order chat closed 30 days after delivery';
        }
        if (expired.length) await repository.save(expired, { reload: false });
    }

    private async syncOrderConversationLifecycle(
        ctx: RequestContext,
        conversation: MarketplaceChatConversation,
        order: Order,
    ) {
        if (conversation.conversationType !== 'ORDER' || !this.isDeliveredStatus(order.state)) return;
        if (!conversation.closeAt) {
            conversation.closeAt = new Date(order.updatedAt.getTime() + ORDER_CHAT_LIFETIME_MS);
        }
        if (conversation.status === 'OPEN' && conversation.closeAt.getTime() <= Date.now()) {
            conversation.status = 'CLOSED';
            conversation.closedAt = conversation.closeAt;
            conversation.closedReason = 'Order chat closed 30 days after delivery';
        }
        await this.conversationRepository(ctx).save(conversation, { reload: false });
    }

    private isDeliveredStatus(status: unknown) {
        return ['DELIVERED', 'FULFILLED'].includes(String(status ?? '').trim().toUpperCase());
    }

    private async cleanupOrphanAttachments(ctx: RequestContext) {
        const repository = this.attachmentRepository(ctx);
        const expired = await repository.find({
            where: { messageId: IsNull(), createdAt: LessThan(new Date(Date.now() - ORPHAN_ATTACHMENT_LIFETIME_MS)) },
        });
        for (const attachment of expired) {
            await unlink(this.attachmentPath(attachment.storageKey)).catch(() => undefined);
        }
        if (expired.length) await repository.remove(expired);
    }

    private async listForPrincipal(
        ctx: RequestContext | undefined,
        principal: MarketplaceChatPrincipal,
        options?: MarketplaceChatListOptions,
    ) {
        await this.closeExpiredConversations(ctx);
        const conversations = await this.conversationRepository(ctx).find({ order: { lastMessageAt: 'DESC' } });
        const term = String(options?.term ?? '').trim().toLowerCase();
        const status = String(options?.status ?? '').trim().toUpperCase();
        const take = Math.min(100, Math.max(1, Number(options?.take ?? 100)));
        const matching = conversations
            .filter(conversation => conversation.closedReason !== STANDARD_ORDER_CHAT_DISABLED_REASON)
            .filter(conversation => this.canAccess(principal, conversation))
            .filter(conversation => !status || conversation.status === status)
            .filter(conversation => !term || [
                conversation.customerName,
                conversation.customerEmail,
                conversation.vendorName,
                conversation.customerOrderCode,
                conversation.sellerOrderCode,
                conversation.sourceCode,
            ].some(value => value?.toLowerCase().includes(term)));
        const conversationIds = matching.map(conversation => String(conversation.id));
        const [messages, readStates] = conversationIds.length ? await Promise.all([
            this.messageRepository(ctx).find({
                where: { conversationId: In(conversationIds) },
                order: { createdAt: 'ASC' },
            }),
            this.readStateRepository(ctx).find({
                where: { conversationId: In(conversationIds), userId: principal.userId },
            }),
        ]) : [[], []];
        const readByConversation = new Map(readStates.map(state => [state.conversationId, state.lastReadAt]));
        const unreadByConversation = new Map<string, number>();
        for (const chatMessage of messages) {
            const readAt = readByConversation.get(chatMessage.conversationId);
            if (chatMessage.senderUserId !== principal.userId
                && (!readAt || chatMessage.createdAt.getTime() > readAt.getTime())) {
                unreadByConversation.set(
                    chatMessage.conversationId,
                    (unreadByConversation.get(chatMessage.conversationId) ?? 0) + 1,
                );
            }
        }
        const mapped = matching.map(conversation => this.conversationShape(
            conversation,
            unreadByConversation.get(String(conversation.id)) ?? 0,
            [],
        ));
        return {
            items: mapped.slice(0, take),
            totalItems: matching.length,
            unreadCount: mapped.reduce((total, item) => total + (item.unreadCount > 0 ? 1 : 0), 0),
        };
    }

    private async getForPrincipal(
        ctx: RequestContext | undefined,
        principal: MarketplaceChatPrincipal,
        id: string,
    ) {
        const conversation = await this.authorizedConversation(ctx, principal, id);
        return this.mapConversation(ctx, conversation, principal, true);
    }

    private async sendForPrincipal(
        ctx: RequestContext | undefined,
        principal: MarketplaceChatPrincipal,
        input: SendMarketplaceChatMessageInput,
    ) {
        const conversation = await this.authorizedConversation(ctx, principal, String(input.conversationId));
        if (conversation.status !== 'OPEN') throw new Error('This conversation is closed');
        const body = this.cleanBody(input.body);
        const attachmentIds = [...new Set((input.attachmentIds ?? []).map(id => String(id)))];
        if (attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) {
            throw new Error(`Attach no more than ${MAX_ATTACHMENTS_PER_MESSAGE} files to one message`);
        }
        if (!body && !attachmentIds.length) throw new Error('Write a message or attach a file before sending');
        const clientMessageId = this.cleanClientMessageId(input.clientMessageId);
        const messageRepository = this.messageRepository(ctx);
        const duplicate = await messageRepository.findOne({
            where: { senderUserId: principal.userId, clientMessageId },
        });
        if (duplicate) {
            const duplicateAttachments = await this.attachmentRepository(ctx).find({
                where: { messageId: String(duplicate.id) },
            });
            return this.mapMessage(duplicate, duplicateAttachments);
        }
        const attachments = attachmentIds.length ? await this.attachmentRepository(ctx).find({
            where: {
                id: In(attachmentIds),
                conversationId: String(conversation.id),
                uploadedByUserId: principal.userId,
                messageId: IsNull(),
            },
        }) : [];
        if (attachments.length !== attachmentIds.length) {
            throw new Error('One or more attachments are invalid or already sent');
        }
        const sentRecently = await messageRepository.count({
            where: { senderUserId: principal.userId, createdAt: MoreThan(new Date(Date.now() - 60_000)) },
        });
        if (sentRecently >= MAX_MESSAGES_PER_MINUTE) {
            throw new Error('Too many messages were sent. Wait a moment and try again');
        }
        let message: MarketplaceChatMessage;
        try {
            message = await messageRepository.save(new MarketplaceChatMessage({
                conversationId: String(conversation.id),
                senderUserId: principal.userId,
                senderName: principal.displayName,
                senderRole: principal.role,
                kind: 'TEXT',
                body,
                automated: false,
                clientMessageId,
            }));
        } catch (error) {
            const concurrentlyCreated = await messageRepository.findOne({
                where: { senderUserId: principal.userId, clientMessageId },
            });
            if (concurrentlyCreated) return this.mapMessage(concurrentlyCreated);
            throw error;
        }
        if (attachments.length) {
            for (const attachment of attachments) attachment.messageId = String(message.id);
            await this.attachmentRepository(ctx).save(attachments, { reload: false });
        }
        await this.touchConversation(ctx, conversation, message);
        await this.upsertReadState(ctx, conversation, principal, message.createdAt);
        const mapped = this.mapMessage(message, attachments);
        this.realtime.publishMessage(conversation, mapped);
        return mapped;
    }

    private async markReadForPrincipal(
        ctx: RequestContext | undefined,
        principal: MarketplaceChatPrincipal,
        id: string,
    ) {
        const conversation = await this.authorizedConversation(ctx, principal, id);
        const readAt = new Date();
        await this.upsertReadState(ctx, conversation, principal, readAt);
        this.realtime.publishRead(String(conversation.id), principal.userId, principal.role, readAt);
        return { success: true, readAt };
    }

    private async mapConversation(
        ctx: RequestContext | undefined,
        conversation: MarketplaceChatConversation,
        principal: MarketplaceChatPrincipal,
        includeMessages: boolean,
    ) {
        const allMessages = await this.messageRepository(ctx).find({
            where: { conversationId: String(conversation.id) },
            order: { createdAt: 'ASC' },
        });
        const messageIds = allMessages.map(message => String(message.id));
        const attachments = messageIds.length ? await this.attachmentRepository(ctx).find({
            where: { messageId: In(messageIds) },
            order: { createdAt: 'ASC' },
        }) : [];
        const attachmentsByMessage = new Map<string, MarketplaceChatAttachment[]>();
        for (const attachment of attachments) {
            const messageId = String(attachment.messageId);
            attachmentsByMessage.set(messageId, [...(attachmentsByMessage.get(messageId) ?? []), attachment]);
        }
        const readState = await this.readStateRepository(ctx).findOne({
            where: { conversationId: String(conversation.id), userId: principal.userId },
        });
        const unreadCount = allMessages.filter(message =>
            message.senderUserId !== principal.userId
            && (!readState || message.createdAt.getTime() > readState.lastReadAt.getTime()),
        ).length;
        return this.conversationShape(
            conversation,
            unreadCount,
            includeMessages ? allMessages.slice(-100).map(message => this.mapMessage(
                message,
                attachmentsByMessage.get(String(message.id)) ?? [],
            )) : [],
        );
    }

    private conversationShape(
        conversation: MarketplaceChatConversation,
        unreadCount: number,
        messages: Array<Record<string, unknown>>,
    ) {
        return {
            id: String(conversation.id),
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt,
            sellerOrderId: conversation.sellerOrderId,
            sellerOrderCode: conversation.sellerOrderCode,
            customerOrderId: conversation.customerOrderId,
            customerOrderCode: conversation.customerOrderCode,
            customerId: conversation.customerId,
            customerName: conversation.customerName,
            customerEmail: conversation.customerEmail,
            vendorId: conversation.vendorId,
            vendorName: conversation.vendorName,
            status: conversation.status,
            conversationType: conversation.conversationType,
            sourceId: conversation.sourceId,
            sourceCode: conversation.sourceCode,
            closeAt: conversation.closeAt,
            closedAt: conversation.closedAt,
            closedReason: conversation.closedReason,
            lastMessageAt: conversation.lastMessageAt,
            lastMessagePreview: conversation.lastMessagePreview,
            lastSenderRole: conversation.lastSenderRole,
            unreadCount,
            messages,
        };
    }

    private mapMessage(message: MarketplaceChatMessage, attachments: MarketplaceChatAttachment[] = []) {
        return {
            id: String(message.id),
            createdAt: message.createdAt,
            conversationId: message.conversationId,
            senderUserId: message.senderUserId,
            senderName: message.senderName,
            senderRole: message.senderRole,
            kind: message.kind,
            body: message.body,
            automated: message.automated,
            clientMessageId: message.clientMessageId,
            orderReceipt: normalizeMarketplaceChatOrderReceipt(message.metadata?.orderReceipt),
            orderStatus: message.metadata?.orderStatus,
            statusNote: message.metadata?.statusNote,
            appealSummary: message.metadata?.appealSummary,
            inquirySummary: message.metadata?.inquirySummary,
            quote: message.metadata?.quote
                ? { ...message.metadata.quote, addOns: message.metadata.quote.addOns ?? [] }
                : undefined,
            attachments: attachments.map(attachment => this.mapAttachment(attachment)),
        };
    }

    private async touchConversation(
        ctx: RequestContext | undefined,
        conversation: MarketplaceChatConversation,
        message: MarketplaceChatMessage,
    ) {
        conversation.lastMessageAt = message.createdAt;
        conversation.lastMessagePreview = message.kind === 'ORDER_SUMMARY'
            ? 'Order receipt shared'
            : message.kind === 'QUOTE'
                ? 'Personalized quotation sent'
                : message.kind === 'INQUIRY_SUMMARY'
                    ? 'New event inquiry'
            : message.body.slice(0, 180) || 'Sent an attachment';
        conversation.lastSenderRole = message.senderRole;
        await this.conversationRepository(ctx).save(conversation, { reload: false });
    }

    private async upsertReadState(
        ctx: RequestContext | undefined,
        conversation: MarketplaceChatConversation,
        principal: Pick<MarketplaceChatPrincipal, 'userId' | 'role'>,
        readAt: Date,
    ) {
        const repository = this.readStateRepository(ctx);
        const state = await repository.findOne({
            where: { conversationId: String(conversation.id), userId: principal.userId },
        }) ?? new MarketplaceChatReadState({
            conversationId: String(conversation.id),
            userId: principal.userId,
            role: principal.role,
        });
        state.role = principal.role;
        state.lastReadAt = readAt;
        await repository.save(state, { reload: false });
    }

    private async authorizedConversation(
        ctx: RequestContext | undefined,
        principal: MarketplaceChatPrincipal,
        id: string,
    ) {
        await this.closeExpiredConversations(ctx);
        const conversation = await this.conversationRepository(ctx).findOne({ where: { id } });
        if (!conversation
            || conversation.closedReason === STANDARD_ORDER_CHAT_DISABLED_REASON
            || !this.canAccess(principal, conversation)) {
            throw new ForbiddenError();
        }
        return conversation;
    }

    private async disableStandardOrderConversation(
        ctx: RequestContext,
        conversation: MarketplaceChatConversation,
    ) {
        if (conversation.closedReason === STANDARD_ORDER_CHAT_DISABLED_REASON) return;
        const now = new Date();
        conversation.status = 'CLOSED';
        conversation.closeAt = now;
        conversation.closedAt = now;
        conversation.closedReason = STANDARD_ORDER_CHAT_DISABLED_REASON;
        await this.conversationRepository(ctx).save(conversation, { reload: false });
    }

    private canAccess(principal: MarketplaceChatPrincipal, conversation: MarketplaceChatConversation) {
        return canAccessMarketplaceChat(principal, conversation);
    }

    private async customerPrincipal(ctx: RequestContext): Promise<MarketplaceChatPrincipal> {
        const userId = this.requireUser(ctx);
        const customer = await this.connection.getRepository(ctx, Customer).findOne({
            where: { user: { id: userId } },
            relations: ['user'],
        });
        if (!customer) throw new ForbiddenError();
        return {
            userId,
            role: 'CUSTOMER',
            displayName: `${customer.firstName} ${customer.lastName}`.trim() || 'Customer',
        };
    }

    private async adminPrincipal(ctx: RequestContext): Promise<MarketplaceChatPrincipal> {
        const userId = this.requireUser(ctx);
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { ownerUserId: userId },
        });
        if (vendor) return { userId, role: 'VENDOR', displayName: vendor.shopName };
        const user = await this.connection.getRepository(ctx, User).findOne({ where: { id: userId } });
        return {
            userId,
            role: ctx.userHasPermissions([Permission.SuperAdmin]) ? 'SUPER_ADMIN' : 'ADMIN',
            displayName: user?.identifier || (ctx.userHasPermissions([Permission.SuperAdmin]) ? 'Super admin' : 'Administrator'),
        };
    }

    async validateSocketPrincipal(principal: MarketplaceChatPrincipal) {
        const user = await this.connection.rawConnection.getRepository(User).findOne({
            where: { id: principal.userId },
        });
        if (!user) throw new ForbiddenError();
        if (principal.role === 'VENDOR') {
            const vendor = await this.connection.rawConnection.getRepository(VendorProfile).findOne({
                where: { ownerUserId: principal.userId },
            });
            if (!vendor) throw new ForbiddenError();
        }
        if (principal.role === 'CUSTOMER') {
            const customer = await this.connection.rawConnection.getRepository(Customer).findOne({
                where: { user: { id: principal.userId } },
                relations: ['user'],
            });
            if (!customer) throw new ForbiddenError();
        }
    }

    private createSocketTicket(principal: MarketplaceChatPrincipal) {
        const expiresAt = Date.now() + SOCKET_TICKET_TTL_MS;
        const payload = Buffer.from(JSON.stringify({
            ...principal,
            expiresAt,
            nonce: randomUUID(),
        })).toString('base64url');
        return { token: `${payload}.${this.signTicket(payload)}`, expiresAt: new Date(expiresAt) };
    }

    private signTicket(payload: string) {
        const secret = process.env.CHAT_SOCKET_SECRET ?? process.env.COOKIE_SECRET ?? 'local-development-secret';
        return createHmac('sha256', secret).update(`marketplace-chat:${payload}`).digest('base64url');
    }

    private normalizeInquiry(
        input: CreateMarketplaceListingInquiryInput,
        product: Product,
        category: MarketplaceCategory,
        isDigitalProject: boolean,
        isMonthlyWorkshop: boolean,
    ): MarketplaceChatInquirySummary {
        if (isDigitalProject) return this.normalizeDigitalProjectInquiry(input, product, category);
        if (isMonthlyWorkshop) return this.normalizeClassSubscriptionInquiry(input, product, category);
        const eventType = String(input.eventType ?? '').trim().slice(0, 100);
        const eventDate = String(input.eventDate ?? '').trim();
        const guestCount = Number(input.guestCount);
        const city = String(input.city ?? '').trim().slice(0, 120);
        const details = this.cleanBody(input.details);
        if (!eventType) throw new Error('Choose a party or event type');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || new Date(`${eventDate}T00:00:00Z`).getTime() < Date.now() - 24 * 60 * 60 * 1000) {
            throw new Error('Choose a valid future event date');
        }
        if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 100_000) {
            throw new Error('Number of guests must be between 1 and 100,000');
        }
        if (!city) throw new Error('Enter the event city');
        if (details.length < 10) throw new Error('Add a little more detail about the event you want');
        const translation = product.translations?.[0];
        const budget = Number(input.budget ?? 0);
        return {
            inquiryType: 'EVENT',
            productId: String(product.id),
            productSlug: String(translation?.slug ?? product.id),
            productName: String(translation?.name ?? 'Event service'),
            categoryName: category.name,
            eventType,
            eventDate,
            startTime: String(input.startTime ?? '').trim().slice(0, 20) || undefined,
            endTime: String(input.endTime ?? '').trim().slice(0, 20) || undefined,
            guestCount,
            city,
            venue: String(input.venue ?? '').trim().slice(0, 240) || undefined,
            budget: Number.isInteger(budget) && budget > 0 ? budget : undefined,
            theme: String(input.theme ?? '').trim().slice(0, 240) || undefined,
            details,
        };
    }

    private normalizeClassSubscriptionInquiry(
        input: CreateMarketplaceListingInquiryInput,
        product: Product,
        category: MarketplaceCategory,
    ): MarketplaceChatInquirySummary {
        const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
        const className = clean(input.className, 160);
        const desiredStartDate = clean(input.desiredStartDate, 10);
        const details = this.cleanBody(input.details);
        if (!className) throw new Error('Choose or describe the class time you want to attend');
        if (desiredStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(desiredStartDate)) {
            throw new Error('Choose a valid preferred start date');
        }
        if (details.length < 5) throw new Error('Add your class timing or access question');
        const translation = product.translations?.[0];
        return {
            inquiryType: 'CLASS_SUBSCRIPTION',
            productId: String(product.id),
            productSlug: String(translation?.slug ?? product.id),
            productName: String(translation?.name ?? 'Class subscription'),
            categoryName: category.name,
            className,
            desiredStartDate: desiredStartDate || undefined,
            details,
        };
    }

    private normalizeDigitalProjectInquiry(
        input: CreateMarketplaceListingInquiryInput,
        product: Product,
        category: MarketplaceCategory,
    ): MarketplaceChatInquirySummary {
        const clean = (value: unknown, max: number) => String(value ?? '').trim().slice(0, max);
        const projectTitle = clean(input.projectTitle, 160);
        const projectType = clean(input.projectType, 120);
        const deadline = clean(input.deadline, 10);
        const targetAudience = clean(input.targetAudience, 300);
        const projectGoal = clean(input.projectGoal, 1_000);
        const conceptCount = Number(input.conceptCount);
        const colorTheme = clean(input.colorTheme, 300);
        const details = this.cleanBody(input.details);
        if (projectTitle.length < 3) throw new Error('Enter a project title');
        if (!projectType) throw new Error('Choose a project type');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || new Date(`${deadline}T23:59:59Z`).getTime() < Date.now()) {
            throw new Error('Choose a valid project deadline');
        }
        if (!targetAudience) throw new Error('Describe the target audience');
        if (projectGoal.length < 10) throw new Error('Describe the goal of this project');
        if (!Number.isInteger(conceptCount) || conceptCount < 1 || conceptCount > 5) {
            throw new Error('Choose between 1 and 5 initial concepts');
        }
        if (!colorTheme) throw new Error('Describe the colour theme or palette');
        if (details.length < 10) throw new Error('Add the important project requirements');
        const fileFormats = (Array.isArray(input.fileFormats) ? input.fileFormats : [])
            .map(value => clean(value, 20))
            .filter(Boolean)
            .slice(0, 12);
        if (!fileFormats.length) throw new Error('Choose at least one final file format');
        const referenceLinks = (Array.isArray(input.referenceLinks) ? input.referenceLinks : [])
            .map(value => clean(value, 500))
            .filter(Boolean)
            .slice(0, 5);
        for (const link of referenceLinks) {
            try {
                const url = new URL(link);
                if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
            } catch {
                throw new Error('Reference links must use valid HTTP or HTTPS URLs');
            }
        }
        const revisionRounds = Number(input.revisionRounds ?? 0);
        if (!Number.isInteger(revisionRounds) || revisionRounds < 0 || revisionRounds > 20) {
            throw new Error('Requested revision rounds must be between 0 and 20');
        }
        const translation = product.translations?.[0];
        const budget = Number(input.budget ?? 0);
        return {
            inquiryType: 'DIGITAL_PROJECT',
            productId: String(product.id),
            productSlug: String(translation?.slug ?? product.id),
            productName: String(translation?.name ?? 'Custom digital design'),
            categoryName: category.name,
            projectTitle,
            projectType,
            deadline,
            brandName: clean(input.brandName, 160) || undefined,
            targetAudience,
            projectGoal,
            conceptCount,
            conceptNotes: clean(input.conceptNotes, 1_000) || undefined,
            colorTheme,
            stylePreferences: clean(input.stylePreferences, 500) || undefined,
            dimensions: clean(input.dimensions, 240) || undefined,
            fileFormats,
            contentStatus: clean(input.contentStatus, 120) || undefined,
            usageType: clean(input.usageType, 120) || undefined,
            revisionRounds,
            referenceLinks,
            ndaRequired: input.ndaRequired === true,
            budget: Number.isInteger(budget) && budget > 0 ? budget : undefined,
            details,
        };
    }

    private async requireListingQuote(ctx: RequestContext, id: string, customerUserId: string) {
        const repository = this.connection.getRepository(ctx, MarketplaceListingQuote);
        const quote = await repository.findOne({ where: { id } });
        if (!quote || quote.customerUserId !== customerUserId) throw new ForbiddenError();
        if (quote.status === 'SENT' && quote.validUntil.getTime() <= Date.now()) {
            quote.status = 'EXPIRED';
            await repository.save(quote, { reload: false });
        }
        if (quote.status !== 'SENT') throw new Error(`This quotation is ${quote.status.toLowerCase()}`);
        return quote;
    }

    private quoteSummary(quote: MarketplaceListingQuote) {
        return {
            id: String(quote.id),
            code: quote.code,
            productId: quote.productId,
            productVariantId: quote.productVariantId,
            amount: quote.amount,
            currencyCode: quote.currencyCode,
            description: quote.description,
            addOns: quote.addOns ?? [],
            status: quote.status,
            validUntil: quote.validUntil.toISOString(),
            checkoutUrl: quote.status === 'SENT' ? `/checkout?quote=${quote.id}` : '',
        };
    }

    private async listingQuoteShape(ctx: RequestContext, quote: MarketplaceListingQuote) {
        const product = await this.connection.getRepository(ctx, Product).findOne({
            where: { id: quote.productId },
            relations: ['translations', 'featuredAsset', 'variants', 'variants.translations'],
        });
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: quote.vendorId } });
        const variant = product?.variants?.find(item => String(item.id) === quote.productVariantId);
        const listingCategory = await this.connection.getRepository(ctx, MarketplaceListingCategory).findOne({
            where: { productId: quote.productId, isPrimary: true },
        });
        const category = listingCategory
            ? await this.connection.getRepository(ctx, MarketplaceCategory).findOne({ where: { id: listingCategory.categoryId } })
            : null;
        const formTemplate = category?.formTemplateId
            ? await this.connection.getRepository(ctx, MarketplaceFormTemplate).findOne({ where: { id: category.formTemplateId } })
            : null;
        const productTranslation = product?.translations?.[0];
        const variantTranslation = variant?.translations?.[0];
        const productType = String((product?.customFields as Record<string, unknown> | undefined)?.marketplaceType ?? '').toUpperCase();
        const requiresShipping = marketplaceListingRequiresShipping(formTemplate?.listingType, productType);
        return {
            ...this.quoteSummary(quote),
            conversationId: quote.conversationId,
            productName: String(productTranslation?.name ?? 'Personalized event service'),
            productSlug: String(productTranslation?.slug ?? ''),
            variantName: String(variantTranslation?.name ?? 'Personalized quotation'),
            sku: String(variant?.sku ?? quote.code),
            vendorName: vendor?.shopName ?? 'Vendor',
            vendorSlug: vendor?.slug ?? '',
            image: product?.featuredAsset?.preview ?? '',
            requiresShipping,
            orderId: quote.orderId,
            orderCode: quote.orderCode,
        };
    }

    private normalizeListingQuoteAddOns(input: CreateMarketplaceListingQuoteInput['addOns']) {
        if (!input) return [];
        if (input.length > 20) throw new Error('A quotation can include up to 20 items');
        return input.map((item, index) => {
            const name = String(item.name ?? '').trim();
            if (!name || name.length > 120) {
                throw new Error(`Item ${index + 1} needs a name of up to 120 characters`);
            }
            const included = (Array.isArray(item.included) ? item.included : [])
                .map(value => String(value).trim())
                .filter(Boolean);
            if (!included.length || included.length > 30 || included.some(value => value.length > 200)) {
                throw new Error(`Item ${index + 1} must include 1 to 30 inclusions of up to 200 characters each`);
            }
            const price = Number(item.price);
            if (!Number.isInteger(price) || price < 0) {
                throw new Error(`Item ${index + 1} price must be a valid PKR amount`);
            }
            return { name, included, price };
        });
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }

    private cleanBody(value: unknown) {
        const body = String(value ?? '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
            .replace(/\r\n?/g, '\n')
            .trim();
        if (body.length > MAX_MESSAGE_LENGTH) {
            throw new Error(`Messages cannot exceed ${MAX_MESSAGE_LENGTH} characters`);
        }
        return body;
    }

    private cleanClientMessageId(value: unknown) {
        const id = String(value ?? '').trim();
        if (!/^[A-Za-z0-9:_-]{8,120}$/.test(id)) throw new Error('Message request identifier is invalid');
        return id;
    }

    private async vendorForOrder(ctx: RequestContext, order: Order) {
        const channelIds = new Set(order.channels.map(channel => String(channel.id)));
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        return vendors.find(vendor => vendor.channelId && channelIds.has(vendor.channelId));
    }

    private orderQuery(ctx: RequestContext) {
        return this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('customer.user', 'customerUser')
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'productVariant')
            .leftJoinAndSelect('productVariant.translations', 'productVariantTranslations')
            .leftJoinAndSelect('productVariant.product', 'product')
            .leftJoinAndSelect('product.translations', 'productTranslations')
            .leftJoinAndSelect('order.channels', 'channels')
            .leftJoinAndSelect('order.aggregateOrder', 'aggregateOrder');
    }

    private conversationRepository(ctx?: RequestContext) {
        return ctx
            ? this.connection.getRepository(ctx, MarketplaceChatConversation)
            : this.connection.rawConnection.getRepository(MarketplaceChatConversation);
    }

    private messageRepository(ctx?: RequestContext) {
        return ctx
            ? this.connection.getRepository(ctx, MarketplaceChatMessage)
            : this.connection.rawConnection.getRepository(MarketplaceChatMessage);
    }

    private attachmentRepository(ctx?: RequestContext) {
        return ctx
            ? this.connection.getRepository(ctx, MarketplaceChatAttachment)
            : this.connection.rawConnection.getRepository(MarketplaceChatAttachment);
    }

    private readStateRepository(ctx?: RequestContext) {
        return ctx
            ? this.connection.getRepository(ctx, MarketplaceChatReadState)
            : this.connection.rawConnection.getRepository(MarketplaceChatReadState);
    }
}
