import { ID } from '@vendure/core';

export interface SendMarketplaceChatMessageInput {
    conversationId: ID;
    body: string;
    clientMessageId: string;
    attachmentIds?: ID[];
}

export interface MarketplaceChatListOptions {
    term?: string;
    status?: string;
    take?: number;
}

export interface CreateMarketplaceListingInquiryInput {
    productId: ID;
    inquiryType?: 'EVENT' | 'DIGITAL_PROJECT' | 'CLASS_SUBSCRIPTION';
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

export interface CreateMarketplaceListingQuoteInput {
    conversationId: ID;
    amount: number;
    description: string;
    validUntil: string;
    addOns?: Array<{
        name: string;
        included: string[];
        price: number;
    }>;
}
