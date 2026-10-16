import { ID } from '@vendure/core';

import { BookingStatus } from '../../../types';

export interface CreateBookingInput {
    vendorProfileId: string;
    productVariantId: string;
    availabilitySessionId?: string;
    eventTicketTypeId?: string;
    bookingType: 'SERVICE' | 'WORKSHOP' | 'EXPERIENCE' | 'TICKET';
    purchaseMode?: 'MONTHLY' | 'ONE_DAY';
    title: string;
    startsAt: Date;
    endsAt: Date;
    quantity?: number;
    attendeeDetails?: Array<Record<string, string>>;
    customerNote?: string;
}

export interface UpdateBookingStatusInput {
    id: ID;
    status: BookingStatus;
    internalNote?: string;
    secureAccessReference?: string;
}

export interface RequestSubscriptionCancellationInput {
    id: ID;
    reason?: string;
}
