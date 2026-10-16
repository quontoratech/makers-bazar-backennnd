import { DeepPartial, VendureEntity } from '@vendure/core';
import { Column, Entity, Index } from 'typeorm';

import { MarketplaceChatSenderRole } from './marketplace-chat-conversation.entity';
import type { MarketplaceListingQuoteAddOn } from './marketplace-listing-quote.entity';

export type MarketplaceChatMessageKind = 'TEXT' | 'AUTOMATED_GREETING' | 'ORDER_SUMMARY' | 'ORDER_STATUS' | 'APPEAL_SUMMARY' | 'INQUIRY_SUMMARY' | 'QUOTE';

export interface MarketplaceChatInquirySummary {
    inquiryType?: 'EVENT' | 'DIGITAL_PROJECT' | 'CLASS_SUBSCRIPTION';
    productId: string;
    productSlug: string;
    productName: string;
    categoryName: string;
    eventType?: string;
    eventDate?: string;
    startTime?: string;
    endTime?: string;
    guestCount?: number;
    city?: string;
    venue?: string;
    budget?: number;
    theme?: string;
    projectTitle?: string;
    projectType?: string;
    deadline?: string;
    brandName?: string;
    targetAudience?: string;
    projectGoal?: string;
    conceptCount?: number;
    conceptNotes?: string;
    colorTheme?: string;
    stylePreferences?: string;
    dimensions?: string;
    fileFormats?: string[];
    contentStatus?: string;
    usageType?: string;
    revisionRounds?: number;
    referenceLinks?: string[];
    ndaRequired?: boolean;
    className?: string;
    desiredStartDate?: string;
    details: string;
}

export interface MarketplaceChatQuoteSummary {
    id: string;
    code: string;
    productId: string;
    productVariantId: string;
    amount: number;
    currencyCode: string;
    description: string;
    addOns: MarketplaceListingQuoteAddOn[];
    status: string;
    validUntil: string;
    checkoutUrl: string;
}

export interface MarketplaceChatAppealEvidence {
    id: string;
    name: string;
    mimeType: string;
    preview: string;
}

export interface MarketplaceChatAppealSummary {
    appealType: 'CUSTOMER_APPEAL' | 'VENDOR_APPEAL';
    reference: string;
    subject: string;
    statement: string;
    adminNote?: string;
    evidence: MarketplaceChatAppealEvidence[];
}

export interface MarketplaceChatOrderReceiptLine {
    orderLineId: string;
    productName: string;
    variantName: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}

export interface MarketplaceChatOrderReceipt {
    sellerOrderCode: string;
    customerOrderCode: string;
    currencyCode: string;
    lines: MarketplaceChatOrderReceiptLine[];
    itemsBeforeDiscount: number;
    discount: number;
    productSubtotal: number;
    rewardCoins: number;
    rewardFunding: number;
    couponCode?: string;
    couponDiscount: number;
    couponFundingSource?: 'MARKETPLACE' | 'VENDOR';
    customerFundedProductAmount: number;
    shipping: number;
    taxIncluded: number;
    orderTotal: number;
    customerPaidTotal: number;
    placedAt: string;
}

export interface MarketplaceChatMessageMetadata {
    orderReceipt?: MarketplaceChatOrderReceipt;
    orderStatus?: string;
    statusNote?: string;
    appealSummary?: MarketplaceChatAppealSummary;
    inquirySummary?: MarketplaceChatInquirySummary;
    quote?: MarketplaceChatQuoteSummary;
}

@Entity()
@Index(['conversationId', 'createdAt'])
@Index(['senderUserId', 'clientMessageId'], { unique: true })
export class MarketplaceChatMessage extends VendureEntity {
    constructor(input?: DeepPartial<MarketplaceChatMessage>) {
        super(input);
    }

    @Index()
    @Column()
    conversationId: string;

    @Index()
    @Column({ nullable: true })
    senderUserId?: string;

    @Column()
    senderName: string;

    @Index()
    @Column({ type: 'varchar' })
    senderRole: MarketplaceChatSenderRole;

    @Index()
    @Column({ type: 'varchar', default: 'TEXT' })
    kind: MarketplaceChatMessageKind;

    @Column({ type: 'text' })
    body: string;

    @Column({ default: false })
    automated: boolean;

    @Column({ nullable: true })
    clientMessageId?: string;

    @Column({ type: 'simple-json', nullable: true })
    metadata?: MarketplaceChatMessageMetadata;
}
