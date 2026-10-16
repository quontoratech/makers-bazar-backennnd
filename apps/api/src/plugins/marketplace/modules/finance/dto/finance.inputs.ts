import { ID } from '@vendure/core';

import { MarketplacePayoutSchedule } from '../entities/marketplace-payout-settings.entity';

export interface UpdateMarketplacePayoutSettingsInput {
    holdingPeriodDays: number;
    reservePercent: number;
    minimumPayoutThreshold: number;
    payoutSchedule: MarketplacePayoutSchedule;
    currencyCode?: string;
    requireSeparateApproval?: boolean;
    adjustmentRules?: Record<string, string | number | boolean>;
}

export interface CreateMarketplacePayoutBatchInput {
    vendorIds?: ID[];
    note?: string;
}

export interface ApproveMarketplacePayoutBatchInput {
    id: ID;
    note?: string;
}

export interface ProcessMarketplacePayoutBatchInput {
    id: ID;
    status: 'PAID' | 'FAILED' | 'CANCELLED';
    externalReference?: string;
    reason?: string;
    payouts?: ProcessMarketplacePayoutRecipientInput[];
}

export interface ProcessMarketplacePayoutRecipientInput {
    payoutEntryId: ID;
    status: 'PAID' | 'FAILED';
    externalReference?: string;
    reason?: string;
}

export interface CreateMarketplaceLedgerAdjustmentInput {
    beneficiaryId: ID;
    beneficiaryType?: 'VENDOR' | 'AFFILIATE';
    kind: 'REFUND' | 'TAX' | 'PENALTY' | 'DELIVERY_ADJUSTMENT' | 'ADJUSTMENT';
    direction?: 'CREDIT' | 'DEBIT';
    amount: number;
    reason: string;
    orderId?: string;
    externalReference?: string;
    metadata?: Record<string, string | number | boolean>;
}

export interface UpdateMarketplaceVendorPayoutAccountInput {
    method: 'BANK_TRANSFER' | 'EASYPAISA' | 'JAZZCASH';
    accountHolderName: string;
    bankName?: string;
    accountIdentifier?: string;
    accountIdentifierConfirmation?: string;
}

export interface ReviewMarketplaceVendorPayoutAccountInput {
    vendorId: ID;
    status: 'VERIFIED' | 'REJECTED';
    note?: string;
}

export interface MarketplaceFinanceReportInput {
    reportType: 'RECONCILIATION' | 'COMMISSION' | 'LIABILITY' | 'PAYOUT';
    from?: Date | string;
    to?: Date | string;
    vendorId?: string;
}
