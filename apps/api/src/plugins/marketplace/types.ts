export interface MarketplacePluginOptions {
    defaultCommissionPercent: number;
    platformFeeSKU: string;
    payoutHoldDays: number;
}

export type VendorApplicationStatus =
    | 'DRAFT'
    | 'PENDING'
    | 'CHANGES_REQUESTED'
    | 'APPROVED'
    | 'REJECTED'
    | 'SUSPENDED';

export type BookingStatus =
    | 'PENDING'
    | 'CONFIRMED'
    | 'RESCHEDULED'
    | 'CANCELLATION_REQUESTED'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'TERMINATED'
    | 'NO_SHOW'
    | 'REFUNDED';

export type WorkflowStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ACTIVE' | 'PAUSED';
