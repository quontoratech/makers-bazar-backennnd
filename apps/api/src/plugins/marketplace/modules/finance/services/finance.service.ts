import { Inject, Injectable } from '@nestjs/common';
import { assertFound, ID, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { In } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';

import { MARKETPLACE_PLUGIN_OPTIONS } from '../../../constants';
import { MarketplaceList, MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplacePluginOptions } from '../../../types';
import { MarketplaceVendorPayoutAccount, VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import {
    ApproveMarketplacePayoutBatchInput,
    CreateMarketplaceLedgerAdjustmentInput,
    CreateMarketplacePayoutBatchInput,
    MarketplaceFinanceReportInput,
    ProcessMarketplacePayoutBatchInput,
    ReviewMarketplaceVendorPayoutAccountInput,
    UpdateMarketplacePayoutSettingsInput,
    UpdateMarketplaceVendorPayoutAccountInput,
} from '../dto/finance.inputs';
import { MarketplacePayoutBatch } from '../entities/marketplace-payout-batch.entity';
import { MarketplacePayoutSettings } from '../entities/marketplace-payout-settings.entity';
import { PayoutLedgerEntry } from '../entities/payout-ledger-entry.entity';
import { summarizeVendorLedger } from '../ledger-summary';
import { withPayoutTransaction } from '../payout-transaction';
import { payoutSchedulePeriod } from '../payout-schedule';
import { marketplaceEarningsAvailableAt, marketplaceOrderCanReleaseEarnings } from '../order-earnings-policy';
import { PromotionFinanceService } from '../../promotion/services/promotion-finance.service';

interface VendorFinanceBalance {
    vendorId: string;
    vendorName: string;
    currencyCode: string;
    grossSales: number;
    commission: number;
    fees: number;
    deliveryAdjustments: number;
    refunds: number;
    taxes: number;
    penalties: number;
    adjustments: number;
    rewardFunding: number;
    couponFunding: number;
    couponDiscounts: number;
    customerFundedSales: number;
    netEarnings: number;
    onHoldBalance: number;
    pendingBalance: number;
    pendingPayout: number;
    paidPayout: number;
    failedPayout: number;
    availableBalance: number;
    reserveHeld: number;
    payableBalance: number;
    payoutAccount: VendorPayoutAccountSummary;
    lastPayoutAt?: Date;
}

interface VendorPayoutAccountSummary {
    method?: MarketplaceVendorPayoutAccount['method'];
    accountHolderName?: string;
    bankName?: string;
    accountIdentifierMasked?: string;
    verificationStatus: MarketplaceVendorPayoutAccount['verificationStatus'] | 'MISSING';
    submittedAt?: string;
    verifiedAt?: string;
    verificationNote?: string;
}

@Injectable()
export class FinanceService {
    constructor(
        private connection: TransactionalConnection,
        private promotionFinance: PromotionFinanceService,
        @Inject(MARKETPLACE_PLUGIN_OPTIONS) private options: MarketplacePluginOptions,
    ) {}

    async ensureDefaultPayoutSettings(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplacePayoutSettings);
        const existing = await repository.findOne({ where: {} });
        if (existing) return existing;
        return repository.save(new MarketplacePayoutSettings({
            holdingPeriodDays: Math.max(0, this.options.payoutHoldDays ?? 7),
            reservePercent: 0,
            minimumPayoutThreshold: 0,
            payoutSchedule: 'MONTHLY',
            currencyCode: 'PKR',
            requireSeparateApproval: false,
            adjustmentRules: {
                refundsDebitVendor: true,
                penaltiesRequireReason: true,
                manualAdjustmentsRequireReason: true,
            },
        }));
    }

    async findAll(
        ctx: RequestContext,
        options?: MarketplaceListOptions,
        beneficiaryId?: string,
    ): Promise<MarketplaceList<PayoutLedgerEntry>> {
        const { skip, take } = normalizeListOptions(options);
        const [items, totalItems] = await this.connection.getRepository(ctx, PayoutLedgerEntry).findAndCount({
            where: beneficiaryId ? { beneficiaryId } : {},
            skip,
            take,
            order: { createdAt: 'DESC' },
        });
        return { items, totalItems };
    }

    async getSettings(ctx: RequestContext) {
        return this.ensureDefaultPayoutSettings(ctx);
    }

    async updateSettings(ctx: RequestContext, input: UpdateMarketplacePayoutSettingsInput) {
        return this.withFinanceTransaction(ctx, async ctx => {
        const settings = await this.ensureDefaultPayoutSettings(ctx);
        settings.holdingPeriodDays = this.nonNegativeInteger(input.holdingPeriodDays, 'Holding period');
        settings.reservePercent = this.percent(input.reservePercent, 'Reserve');
        settings.minimumPayoutThreshold = this.nonNegativeInteger(input.minimumPayoutThreshold, 'Minimum payout threshold');
        settings.payoutSchedule = this.schedule(input.payoutSchedule);
        settings.currencyCode = this.currencyCode(input.currencyCode ?? settings.currencyCode);
        settings.requireSeparateApproval = input.requireSeparateApproval ?? settings.requireSeparateApproval;
        settings.adjustmentRules = input.adjustmentRules ?? settings.adjustmentRules;
        await this.connection.getRepository(ctx, MarketplacePayoutSettings).save(settings, { reload: false });
        return this.getSettings(ctx);
        });
    }

    async dashboard(ctx: RequestContext) {
        await this.releaseAvailableEntries(ctx);
        const [settings, balances, batches, ledger, revenueLedger, promotionSummary] = await Promise.all([
            this.getSettings(ctx),
            this.vendorBalances(ctx),
            this.connection.getRepository(ctx, MarketplacePayoutBatch).find({
                order: { createdAt: 'DESC' },
            }),
            this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: { beneficiaryType: 'VENDOR' },
                order: { createdAt: 'DESC' },
            }),
            this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: { beneficiaryType: 'VENDOR', kind: In(['COMMISSION', 'PAYMENT_FEE']) },
            }),
            this.promotionFinance.summary(ctx),
        ]);
        const summary = this.reportSummary(balances, batches, ledger);
        const activeRevenue = revenueLedger.filter(entry => entry.status !== 'REVERSED');
        summary.commissionRevenue = -activeRevenue.filter(entry => entry.kind === 'COMMISSION').reduce((sum, entry) => sum + entry.amount, 0);
        summary.feeRevenue = -activeRevenue.filter(entry => entry.kind === 'PAYMENT_FEE').reduce((sum, entry) => sum + entry.amount, 0);
        return {
            settings,
            balances,
            payoutBatches: batches.slice(0, 50),
            recentLedgerEntries: ledger.slice(0, 100),
            reportSummary: { ...summary, promotionRevenue: promotionSummary.netRevenue,
                promotionRefunds: promotionSummary.refundedAmount,
                marketplaceEarnings: summary.commissionRevenue + summary.feeRevenue + promotionSummary.netRevenue },
        };
    }

    async vendorStatement(ctx: RequestContext, vendorId: ID) {
        await this.releaseAvailableEntries(ctx);
        const [settings, vendor, entries] = await Promise.all([
            this.getSettings(ctx),
            this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: vendorId } }),
            this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: { beneficiaryType: 'VENDOR', beneficiaryId: String(vendorId) },
                order: { createdAt: 'DESC' },
                take: 200,
            }),
        ]);
        const [balance] = await this.vendorBalances(ctx, [String(vendorId)], settings);
        return {
            vendorId: String(vendorId),
            vendorName: vendor?.shopName ?? balance?.vendorName ?? 'Vendor',
            currencyCode: balance?.currencyCode ?? settings.currencyCode,
            balance,
            entries,
        };
    }

    async myVendorFinance(ctx: RequestContext) {
        await this.releaseAvailableEntries(ctx);
        const vendor = await this.vendorForChannel(ctx);
        const [settings, entries, allBatches] = await Promise.all([
            this.getSettings(ctx),
            this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: { beneficiaryType: 'VENDOR', beneficiaryId: String(vendor.id) },
                order: { createdAt: 'DESC' },
            }),
            this.connection.getRepository(ctx, MarketplacePayoutBatch).find({
                order: { createdAt: 'DESC' },
            }),
        ]);
        const balance = this.balanceForVendor(String(vendor.id), vendor, entries, settings);
        // Totals must use the entire ledger. Only the activity list is limited for display.
        const payoutBatches = allBatches
            .filter(batch => (batch.vendorIds ?? []).includes(String(vendor.id)))
            .slice(0, 100)
            .map(batch => this.vendorBatch(batch, String(vendor.id), entries));
        return {
            vendorId: String(vendor.id),
            vendorName: vendor.shopName,
            currencyCode: balance.currencyCode,
            balance,
            settings: { ...settings, adjustmentRules: undefined },
            payoutAccount: balance.payoutAccount,
            entries: entries.slice(0, 500).map(entry => this.vendorEntry(entry)),
            payoutBatches,
            alerts: this.vendorFinanceAlerts(balance, entries, payoutBatches),
        };
    }

    async updateMyVendorPayoutAccount(ctx: RequestContext, input: UpdateMarketplaceVendorPayoutAccountInput) {
        return this.withFinanceTransaction(ctx, async ctx => {
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const vendor = await this.vendorForChannel(ctx);
        const method = String(input.method ?? '').trim().toUpperCase() as MarketplaceVendorPayoutAccount['method'];
        if (!['BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH'].includes(method)) {
            throw new Error('Choose a valid payout method');
        }
        const accountHolderName = this.cleanPayoutName(input.accountHolderName, 'account holder', 160, 3);
        const bankName = method === 'BANK_TRANSFER'
            ? this.cleanPayoutName(input.bankName, 'bank name', 120, 2)
            : undefined;
        const suppliedIdentifier = this.cleanAccountIdentifier(input.accountIdentifier, method);
        if (suppliedIdentifier) {
            const confirmation = this.cleanAccountIdentifier(input.accountIdentifierConfirmation, method);
            if (!confirmation) throw new Error('Confirm the account number, IBAN, or mobile wallet number');
            if (confirmation !== suppliedIdentifier) throw new Error('The payout account details do not match');
        } else if (input.accountIdentifierConfirmation) {
            throw new Error('Enter the payout account details before confirming them');
        }
        const accountIdentifier = suppliedIdentifier
            ?? (vendor.payoutAccount?.method === method ? vendor.payoutAccount.accountIdentifier : undefined);
        if (!accountIdentifier) throw new Error('Enter the account number, IBAN, or mobile wallet number');

        vendor.payoutAccount = {
            method,
            accountHolderName,
            bankName: method === 'BANK_TRANSFER' ? bankName : undefined,
            accountIdentifier,
            verificationStatus: 'PENDING',
            submittedAt: new Date().toISOString(),
        };
        await repository.save(vendor, { reload: false });
        return this.payoutAccountSummary(vendor.payoutAccount);
        });
    }

    async vendorPayoutAccounts(ctx: RequestContext, statusInput?: string) {
        const status = this.cleanText(statusInput, 32)?.toUpperCase();
        const allowedStatuses = new Set(['MISSING', 'PENDING', 'VERIFIED', 'REJECTED']);
        if (status && !allowedStatuses.has(status)) throw new Error('Choose a valid payout account status');
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find({
            where: { status: 'APPROVED' },
            order: { shopName: 'ASC' },
        });
        const priority = new Map([['PENDING', 0], ['REJECTED', 1], ['MISSING', 2], ['VERIFIED', 3]]);
        return vendors.map(vendor => {
            const account = vendor.payoutAccount;
            const summary = this.payoutAccountSummary(account);
            return {
                vendorId: String(vendor.id),
                vendorName: vendor.shopName,
                ownerName: `${vendor.ownerFirstName} ${vendor.ownerLastName}`.trim(),
                ownerEmailAddress: vendor.ownerEmailAddress,
                method: account?.method,
                accountHolderName: account?.accountHolderName,
                bankName: account?.bankName,
                accountIdentifier: account?.accountIdentifier,
                accountIdentifierMasked: summary.accountIdentifierMasked,
                verificationStatus: summary.verificationStatus,
                submittedAt: account?.submittedAt,
                verifiedAt: account?.verifiedAt,
                verifiedByUserId: account?.verifiedByUserId,
                verificationNote: account?.verificationNote,
            };
        }).filter(account => !status || account.verificationStatus === status)
            .sort((left, right) => (priority.get(left.verificationStatus) ?? 4) - (priority.get(right.verificationStatus) ?? 4)
                || left.vendorName.localeCompare(right.vendorName));
    }

    async reviewVendorPayoutAccount(ctx: RequestContext, input: ReviewMarketplaceVendorPayoutAccountInput) {
        return this.withFinanceTransaction(ctx, async ctx => {
        const repository = this.connection.getRepository(ctx, VendorProfile);
        const vendor = await assertFound(repository.findOne({ where: { id: input.vendorId } }));
        if (!vendor.payoutAccount) throw new Error('This vendor has not submitted a payout account');
        const status = String(input.status ?? '').trim().toUpperCase();
        if (!['VERIFIED', 'REJECTED'].includes(status)) throw new Error('Choose verified or rejected');
        const note = this.cleanText(input.note, 500);
        if (status === 'REJECTED' && !note) throw new Error('Add a reason when rejecting payout details');
        vendor.payoutAccount = {
            ...vendor.payoutAccount,
            verificationStatus: status as 'VERIFIED' | 'REJECTED',
            verifiedAt: status === 'VERIFIED' ? new Date().toISOString() : undefined,
            verifiedByUserId: String(ctx.activeUserId ?? ''),
            verificationNote: note,
        };
        await repository.save(vendor, { reload: false });
        return this.payoutAccountSummary(vendor.payoutAccount);
        });
    }

    findOne(ctx: RequestContext, id: ID): Promise<PayoutLedgerEntry | null> {
        return this.connection.getRepository(ctx, PayoutLedgerEntry).findOne({ where: { id } });
    }

    async approve(ctx: RequestContext, id: ID, reason: string): Promise<PayoutLedgerEntry> {
        throw new Error('Approve the payout batch so that all recipient and balance checks are applied');
    }

    async createAdjustment(ctx: RequestContext, input: CreateMarketplaceLedgerAdjustmentInput) {
        return this.withFinanceTransaction(ctx, async ctx => {
        const settings = await this.getSettings(ctx);
        if ((input.beneficiaryType ?? 'VENDOR') !== 'VENDOR') throw new Error('Vendor adjustments require a vendor beneficiary');
        await this.connection.getEntityOrThrow(ctx, VendorProfile, input.beneficiaryId);
        const amount = this.nonNegativeInteger(input.amount, 'Adjustment amount');
        if (amount <= 0) throw new Error('Adjustment amount must be greater than zero');
        const reason = this.cleanText(input.reason, 500);
        if (!reason) throw new Error('Adjustment reason is required');
        const kind = String(input.kind ?? '').trim().toUpperCase();
        if (!['REFUND', 'TAX', 'PENALTY', 'DELIVERY_ADJUSTMENT', 'ADJUSTMENT'].includes(kind)) {
            throw new Error('Choose a valid adjustment type');
        }
        const direction = String(input.direction ?? 'DEBIT').trim().toUpperCase();
        if (!['CREDIT', 'DEBIT'].includes(direction)) throw new Error('Choose a valid adjustment direction');
        const signedAmount = direction === 'CREDIT' ? amount : -amount;
        const orderId = this.cleanText(input.orderId, 120);
        if (kind === 'REFUND' && direction === 'DEBIT' && orderId) {
            await this.assertOrderRefundNeedsManualDebit(ctx, String(input.beneficiaryId), orderId);
        }
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        return repository.save(new PayoutLedgerEntry({
            beneficiaryType: input.beneficiaryType ?? 'VENDOR',
            beneficiaryId: String(input.beneficiaryId),
            orderId,
            kind: kind as PayoutLedgerEntry['kind'],
            amount: signedAmount,
            currencyCode: settings.currencyCode,
            status: 'AVAILABLE',
            availableAt: new Date(),
            externalReference: this.cleanText(input.externalReference, 160),
            reason,
            metadata: {
                source: 'MANUAL_FINANCE_ADJUSTMENT',
                createdByUserId: String(ctx.activeUserId ?? ''),
            },
        }));
        });
    }

    async createPayoutBatch(ctx: RequestContext, input: CreateMarketplacePayoutBatchInput) {
        return this.withFinanceTransaction(ctx, ctx => this.createPayoutBatchLocked(ctx, input));
    }

    private async createPayoutBatchLocked(ctx: RequestContext, input: CreateMarketplacePayoutBatchInput, period?: string) {
        await this.releaseAvailableEntries(ctx);
        const settings = await this.getSettings(ctx);
        const requestedVendorIds = new Set((input.vendorIds ?? []).map(id => String(id)).filter(Boolean));
        const balances = await this.vendorBalances(ctx, [...requestedVendorIds], settings);
        const eligible = balances.filter(balance => balance.payoutAccount.verificationStatus === 'VERIFIED'
            && balance.currencyCode === settings.currencyCode
            && balance.payableBalance >= settings.minimumPayoutThreshold
            && balance.payableBalance > 0);
        if (!eligible.length) {
            const unverified = balances.some(balance => balance.payableBalance > 0
                && balance.payoutAccount.verificationStatus !== 'VERIFIED');
            throw new Error(unverified
                ? 'Eligible vendor balances need a verified payout account before batching'
                : 'No vendor balances are eligible for payout');
        }

        const vendors = await this.connection.getRepository(ctx, VendorProfile).find({
            where: { id: In(eligible.map(balance => balance.vendorId)) },
        });
        const vendorById = new Map(vendors.map(vendor => [String(vendor.id), vendor]));
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const payoutEntries = await repository.save(eligible.map(balance => new PayoutLedgerEntry({
            beneficiaryType: 'VENDOR',
            beneficiaryId: balance.vendorId,
            kind: 'PAYOUT',
            amount: -balance.payableBalance,
            currencyCode: balance.currencyCode,
            status: 'PENDING',
            availableAt: new Date(),
            reason: `Payout batch for ${balance.vendorName}`,
            metadata: {
                source: 'MARKETPLACE_PAYOUT_BATCH',
                reserveHeld: balance.reserveHeld,
                createdByUserId: String(ctx.activeUserId ?? ''),
                payoutAccountFingerprint: this.accountFingerprint(vendorById.get(balance.vendorId)!.payoutAccount!),
            },
        })));
        const totalAmount = eligible.reduce((total, balance) => total + balance.payableBalance, 0);
        const batch = await this.connection.getRepository(ctx, MarketplacePayoutBatch).save(new MarketplacePayoutBatch({
            code: period ? `PO-AUTO-${period}-${settings.currencyCode}` : `PO-${randomUUID()}`,
            status: 'PENDING_APPROVAL',
            totalAmount,
            currencyCode: settings.currencyCode,
            vendorIds: eligible.map(balance => balance.vendorId),
            payoutEntryIds: payoutEntries.map(entry => String(entry.id)),
            createdByUserId: String(ctx.activeUserId ?? ''),
            note: this.cleanText(input.note, 1000),
            metadata: {
                vendorCount: eligible.length,
                minimumPayoutThreshold: settings.minimumPayoutThreshold,
                reservePercent: settings.reservePercent,
                requireSeparateApproval: settings.requireSeparateApproval,
                ...(period ? { schedulePeriod: period } : {}),
                payoutsJson: JSON.stringify(eligible.map((balance, index) => {
                    const account = vendorById.get(balance.vendorId)!.payoutAccount!;
                    return {
                        payoutEntryId: String(payoutEntries[index]!.id),
                        vendorId: balance.vendorId,
                        vendorName: balance.vendorName,
                        amount: balance.payableBalance,
                        currencyCode: balance.currencyCode,
                        method: account.method,
                        accountHolderName: account.accountHolderName,
                        bankName: account.bankName,
                        accountIdentifier: account.accountIdentifier,
                        accountIdentifierMasked: balance.payoutAccount.accountIdentifierMasked,
                        status: 'PENDING',
                    };
                })),
            },
        }));
        await repository.save(payoutEntries.map(entry => {
            entry.metadata = {
                ...(entry.metadata ?? {}),
                payoutBatchId: String(batch.id),
                payoutBatchCode: batch.code,
            };
            return entry;
        }), { reload: false });
        return assertFound(this.findPayoutBatch(ctx, batch.id));
    }

    async prepareScheduledPayouts(ctx: RequestContext, now = new Date()) {
        return this.withFinanceTransaction(ctx, async ctx => {
            await this.releaseAvailableEntries(ctx);
            const settings = await this.getSettings(ctx);
            const period = payoutSchedulePeriod(settings.payoutSchedule, now);
            if (!period) return { created: false, reason: 'Manual schedule' };
            const code = `PO-AUTO-${period}-${settings.currencyCode}`;
            if (await this.connection.getRepository(ctx, MarketplacePayoutBatch).findOne({ where: { code } })) {
                return { created: false, reason: 'Period already prepared' };
            }
            const balances = await this.vendorBalances(ctx, undefined, settings);
            const eligible = balances.filter(balance => balance.currencyCode === settings.currencyCode
                && balance.payoutAccount.verificationStatus === 'VERIFIED'
                && balance.payableBalance > 0 && balance.payableBalance >= settings.minimumPayoutThreshold);
            if (!eligible.length) return { created: false, reason: 'No eligible balances' };
            const batch = await this.createPayoutBatchLocked(ctx, { vendorIds: eligible.map(balance => balance.vendorId) }, period);
            return { created: true, batchId: String(batch.id) };
        });
    }

    findPayoutBatch(ctx: RequestContext, id: ID) {
        return this.connection.getRepository(ctx, MarketplacePayoutBatch).findOne({ where: { id } });
    }

    async approvePayoutBatch(ctx: RequestContext, input: ApproveMarketplacePayoutBatchInput) {
        return this.withFinanceTransaction(ctx, async ctx => {
        const batch = await assertFound(this.findPayoutBatch(ctx, input.id));
        if (batch.status !== 'PENDING_APPROVAL') throw new Error('Only pending payout batches can be approved');
        const userId = String(ctx.activeUserId ?? '');
        if (!userId) throw new Error('An authenticated administrator is required');
        const settings = await this.getSettings(ctx);
        if ((settings.requireSeparateApproval || batch.metadata?.requireSeparateApproval) && userId === batch.createdByUserId) {
            throw new Error('A different administrator must approve this payout batch');
        }
        await this.validatePayoutRecipients(ctx, batch, await this.batchEntries(ctx, batch));
        batch.status = 'APPROVED';
        batch.approvedByUserId = userId;
        batch.approvedAt = new Date();
        batch.note = this.appendNote(batch.note, input.note);
        await this.connection.getRepository(ctx, MarketplacePayoutBatch).save(batch, { reload: false });
        await this.updatePayoutEntries(ctx, batch, 'APPROVED', 'Payout batch approved');
        return assertFound(this.findPayoutBatch(ctx, batch.id));
        });
    }

    async processPayoutBatch(ctx: RequestContext, input: ProcessMarketplacePayoutBatchInput) {
        return this.withFinanceTransaction(ctx, async ctx => {
        const batch = await assertFound(this.findPayoutBatch(ctx, input.id));
        const requestedStatus = String(input.status ?? '').toUpperCase();
        if (!['APPROVED', 'PROCESSING'].includes(batch.status)
            && !(requestedStatus === 'CANCELLED' && batch.status === 'PENDING_APPROVAL')) {
            throw new Error('Only approved payout batches can be processed');
        }
        const userId = String(ctx.activeUserId ?? '');
        if (!userId) throw new Error('An authenticated administrator is required');
        const entries = await this.batchEntries(ctx, batch);
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        if (requestedStatus === 'CANCELLED') {
            if (entries.some(entry => entry.status === 'PAID')) throw new Error('A batch with a paid recipient cannot be cancelled');
            const reason = this.cleanText(input.reason, 1000);
            if (!reason) throw new Error('A cancellation reason is required');
            for (const entry of entries) {
                entry.status = 'REVERSED';
                entry.reason = reason;
            }
            batch.status = 'CANCELLED';
            batch.failureReason = reason;
        } else {
            const outcomes = input.payouts?.length ? input.payouts : entries
                .filter(entry => ['PENDING', 'APPROVED'].includes(entry.status))
                .map(entry => ({ payoutEntryId: entry.id, status: requestedStatus, externalReference: input.externalReference, reason: input.reason }));
            if (!outcomes.length) throw new Error('This batch has no unprocessed recipients');
            if (new Set(outcomes.map(result => String(result.payoutEntryId))).size !== outcomes.length) {
                throw new Error('Each payout recipient can have only one result');
            }
            const byId = new Map(entries.map(entry => [String(entry.id), entry]));
            for (const result of outcomes) {
                const entry = byId.get(String(result.payoutEntryId));
                if (!entry || !['PENDING', 'APPROVED'].includes(entry.status)) {
                    throw new Error('Only unprocessed recipients in this batch can be recorded');
                }
                if (!['PAID', 'FAILED'].includes(result.status)) throw new Error('Recipient result must be paid or failed');
                const reference = this.cleanText(result.externalReference, 160);
                const reason = this.cleanText(result.reason, 1000);
                if (result.status === 'PAID') {
                    if (!reference) throw new Error('A confirmed transfer reference is required');
                    await this.validatePayoutRecipients(ctx, batch, [entry]);
                    const duplicate = await repository.findOne({ where: { kind: 'PAYOUT', status: 'PAID',
                        beneficiaryId: entry.beneficiaryId, externalReference: reference } });
                    if (duplicate) throw new Error('This vendor transfer reference has already been recorded');
                } else if (!reason) throw new Error('A failure reason is required');
                entry.status = result.status as 'PAID' | 'FAILED';
                entry.externalReference = reference;
                entry.reason = reason ?? 'Company confirmed the external bank or wallet transfer';
                entry.metadata = { ...entry.metadata, processedByUserId: userId, processedAt: new Date().toISOString() };
                await repository.save(entry, { reload: false });
            }
            batch.status = entries.every(entry => entry.status === 'PAID') ? 'PAID'
                : entries.every(entry => entry.status === 'FAILED') ? 'FAILED'
                : entries.every(entry => ['PAID', 'FAILED'].includes(entry.status)) ? 'PARTIALLY_PAID' : 'PROCESSING';
            batch.externalReference = this.cleanText(input.externalReference, 160);
            batch.failureReason = batch.status === 'FAILED' ? this.cleanText(input.reason, 1000) ?? 'All recipient transfers failed' : undefined;
        }
        batch.processedByUserId = userId;
        batch.processedAt = new Date();
        await repository.save(entries, { reload: false });
        this.updateBatchSnapshot(batch, entries);
        await this.connection.getRepository(ctx, MarketplacePayoutBatch).save(batch, { reload: false });
        return assertFound(this.findPayoutBatch(ctx, batch.id));
        });
    }

    async generateReport(ctx: RequestContext, input: MarketplaceFinanceReportInput) {
        await this.releaseAvailableEntries(ctx);
        const reportType = String(input.reportType ?? '').trim().toUpperCase();
        if (!['RECONCILIATION', 'COMMISSION', 'LIABILITY', 'PAYOUT'].includes(reportType)) {
            throw new Error('Choose a valid finance report');
        }
        const from = this.optionalDate(input.from);
        const to = this.optionalDate(input.to, true);
        if (from && to && from > to) throw new Error('Report start date must be before its end date');
        const entries = await this.filteredLedgerEntries(ctx, from, to, input.vendorId);
        const allBatches = await this.connection.getRepository(ctx, MarketplacePayoutBatch).find({
            order: { createdAt: 'DESC' },
        });
        const vendorLedger = input.vendorId ? await this.filteredLedgerEntries(ctx, undefined, undefined, input.vendorId) : [];
        const batches = allBatches.filter(batch => (!from || batch.createdAt >= from) && (!to || batch.createdAt <= to))
            .filter(batch => !input.vendorId || batch.vendorIds?.includes(String(input.vendorId)))
            .map(batch => input.vendorId ? this.vendorBatch(batch, String(input.vendorId), vendorLedger) : batch);
        const balances = await this.vendorBalances(ctx, input.vendorId ? [input.vendorId] : undefined);
        const rows = this.reportRows(reportType, entries, batches, balances);
        return {
            reportType,
            generatedAt: new Date(),
            currencyCode: balances[0]?.currencyCode ?? entries[0]?.currencyCode ?? 'PKR',
            totals: this.reportTotals(entries, batches, balances),
            rows,
        };
    }

    private async releaseAvailableEntries(ctx: RequestContext) {
        const now = new Date();
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const entries = await repository.find({ where: { status: In(['ON_HOLD', 'AVAILABLE']) } });
        const orderIds = [...new Set(entries.filter(entry => entry.kind !== 'PAYOUT' && entry.orderId
            && entry.metadata?.source !== 'MANUAL_FINANCE_ADJUSTMENT').map(entry => entry.orderId!))];
        const orders = orderIds.length ? await this.connection.getRepository(ctx, Order).find({
            where: { id: In(orderIds) },
            relations: ['payments', 'payments.refunds', 'aggregateOrder', 'aggregateOrder.payments', 'aggregateOrder.payments.refunds'],
        }) : [];
        const ordersById = new Map(orders.map(order => [String(order.id), order]));
        const salesByOrder = new Map(entries.filter(entry => entry.kind === 'SALE' && entry.orderId)
            .map(entry => [entry.orderId!, entry]));
        let released = 0;
        for (const entry of entries) {
            if (entry.kind === 'PAYOUT' || entry.metadata?.accountingEffect === 'INFORMATIONAL') continue;
            const orderBacked = !!entry.orderId && entry.metadata?.source !== 'MANUAL_FINANCE_ADJUSTMENT';
            const order = entry.orderId ? ordersById.get(entry.orderId) : undefined;
            const recordedDate = orderBacked ? salesByOrder.get(entry.orderId!)?.availableAt : entry.availableAt;
            const appealDeadline = orderBacked && order
                ? marketplaceEarningsAvailableAt(order, 0, now)
                : undefined;
            const effectiveDate = recordedDate && appealDeadline && recordedDate < appealDeadline
                ? appealDeadline
                : recordedDate;
            const eligible = (!orderBacked || !!order && marketplaceOrderCanReleaseEarnings(order))
                && !!effectiveDate && (orderBacked ? effectiveDate < now : effectiveDate <= now);
            const status = eligible ? 'AVAILABLE' : 'ON_HOLD';
            const changedDate = !!effectiveDate && effectiveDate.getTime() !== entry.availableAt?.getTime();
            if (entry.status === status && !changedDate || !orderBacked && entry.status === 'AVAILABLE') continue;
            // Never overwrite a concurrent reversal with a stale entity snapshot.
            const result = await repository.update({ id: entry.id, status: entry.status }, { status, ...(effectiveDate ? { availableAt: effectiveDate } : {}) });
            if (status === 'AVAILABLE') released += result.affected ?? 0;
        }
        return released;
    }

    private async vendorBalances(ctx: RequestContext, vendorIds?: string[], settingsInput?: MarketplacePayoutSettings) {
        const settings = settingsInput ?? await this.getSettings(ctx);
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const entries = await repository.find({
            where: vendorIds?.length
                ? { beneficiaryType: 'VENDOR', beneficiaryId: In(vendorIds) }
                : { beneficiaryType: 'VENDOR' },
            order: { createdAt: 'DESC' },
        });
        const vendorIdSet = new Set(entries.map(entry => entry.beneficiaryId));
        if (vendorIds?.length) vendorIds.forEach(id => vendorIdSet.add(String(id)));
        const vendorsWithActivity = vendorIdSet.size
            ? await this.connection.getRepository(ctx, VendorProfile).find({ where: { id: In([...vendorIdSet]) } })
            : [];
        const vendorById = new Map(vendorsWithActivity.map(vendor => [String(vendor.id), vendor]));
        if (!vendorIds?.length) {
            const approvedVendors = await this.connection.getRepository(ctx, VendorProfile).find({
                where: { status: 'APPROVED' },
            });
            for (const vendor of approvedVendors) {
                const vendorId = String(vendor.id);
                vendorIdSet.add(vendorId);
                vendorById.set(vendorId, vendor);
            }
        }
        const byVendor = new Map<string, PayoutLedgerEntry[]>();
        for (const entry of entries) {
            const list = byVendor.get(entry.beneficiaryId) ?? [];
            list.push(entry);
            byVendor.set(entry.beneficiaryId, list);
        }
        return [...vendorIdSet].map(vendorId => {
            const vendorEntries = byVendor.get(vendorId) ?? [];
            return this.balanceForVendor(vendorId, vendorById.get(vendorId), vendorEntries, settings);
        }).sort((left, right) => right.payableBalance - left.payableBalance || left.vendorName.localeCompare(right.vendorName));
    }

    private balanceForVendor(
        vendorId: string,
        vendor: VendorProfile | undefined,
        entries: PayoutLedgerEntry[],
        settings: MarketplacePayoutSettings,
    ): VendorFinanceBalance {
        const ledgerSummary = summarizeVendorLedger(entries);
        const activeEntries = ledgerSummary.activeEntries;
        const currencies = new Set(activeEntries.map(entry => entry.currencyCode));
        if (currencies.size > 1) throw new Error(`Vendor ${vendorId} has mixed currencies; reconcile separate currency ledgers before payout`);
        const sum = (kinds: PayoutLedgerEntry['kind'][], statuses?: PayoutLedgerEntry['status'][]) => activeEntries
            .filter(entry => kinds.includes(entry.kind) && (!statuses || statuses.includes(entry.status)))
            .reduce((total, entry) => total + entry.amount, 0);
        const nonPayoutAvailable = activeEntries
            .filter(entry => entry.kind !== 'PAYOUT' && entry.status === 'AVAILABLE')
            .filter(entry => entry.metadata?.accountingEffect !== 'INFORMATIONAL')
            .reduce((total, entry) => total + entry.amount, 0);
        const heldEarnings = activeEntries
            .filter(entry => entry.kind !== 'PAYOUT' && ['PENDING', 'ON_HOLD'].includes(entry.status))
            .filter(entry => entry.metadata?.accountingEffect !== 'INFORMATIONAL')
            .reduce((total, entry) => total + entry.amount, 0);
        const pendingPayout = heldEarnings + Math.abs(sum(['PAYOUT'], ['PENDING', 'APPROVED']));
        const onHoldBalance = activeEntries
            .filter(entry => entry.kind !== 'PAYOUT' && ['PENDING', 'ON_HOLD'].includes(entry.status))
            .filter(entry => entry.metadata?.accountingEffect !== 'INFORMATIONAL')
            .reduce((total, entry) => total + entry.amount, 0);
        const pendingBalance = Math.abs(sum(['PAYOUT'], ['PENDING', 'APPROVED']));
        const paidPayout = Math.abs(sum(['PAYOUT'], ['PAID']));
        const failedPayout = Math.abs(sum(['PAYOUT'], ['FAILED']));
        const committedPayout = sum(['PAYOUT'], ['AVAILABLE', 'PENDING', 'APPROVED', 'PAID']);
        const availableBalance = Math.max(0, nonPayoutAvailable + committedPayout);
        // Reserve is calculated from earnings, not the remaining balance; repeat batches cannot drain it.
        const reserveTarget = Math.max(0, Math.round(nonPayoutAvailable * (settings.reservePercent / 100)));
        const reserveHeld = Math.min(availableBalance, reserveTarget);
        const vendorEligible = vendor?.status === 'APPROVED' && vendor.enforcementStatus === 'ACTIVE';
        const payableBalance = vendorEligible ? Math.max(0, availableBalance - reserveHeld) : 0;
        const lastPaidPayout = entries
            .filter(entry => entry.kind === 'PAYOUT' && entry.status === 'PAID')
            .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())[0];
        const ledgeredSaleOrderIds = new Set(activeEntries
            .filter(entry => entry.kind === 'SALE' && entry.orderId)
            .map(entry => String(entry.orderId)));
        const rewardFunding = activeEntries
            .filter(entry => entry.kind === 'REWARD_FUNDING' && entry.orderId && ledgeredSaleOrderIds.has(String(entry.orderId)))
            .reduce((total, entry) => total + entry.amount, 0);
        const couponFunding = activeEntries
            .filter(entry => entry.kind === 'COUPON_FUNDING' && entry.orderId && ledgeredSaleOrderIds.has(String(entry.orderId)))
            .reduce((total, entry) => total + entry.amount, 0);
        const couponDiscounts = Math.abs(activeEntries
            .filter(entry => entry.kind === 'COUPON_DISCOUNT' && entry.orderId && ledgeredSaleOrderIds.has(String(entry.orderId)))
            .reduce((total, entry) => total + entry.amount, 0));
        return {
            vendorId,
            vendorName: vendor?.shopName ?? `Vendor ${vendorId}`,
            currencyCode: [...currencies][0] ?? settings.currencyCode,
            grossSales: ledgerSummary.grossSales,
            commission: ledgerSummary.commission,
            fees: ledgerSummary.fees,
            deliveryAdjustments: sum(['DELIVERY_ADJUSTMENT']),
            refunds: Math.abs(sum(['REFUND'])),
            taxes: Math.abs(sum(['TAX'])),
            penalties: Math.abs(sum(['PENALTY'])),
            adjustments: sum(['ADJUSTMENT']),
            rewardFunding,
            couponFunding,
            couponDiscounts,
            customerFundedSales: Math.max(0, ledgerSummary.grossSales - rewardFunding - couponFunding - couponDiscounts),
            netEarnings: ledgerSummary.netEarnings,
            onHoldBalance,
            pendingBalance,
            pendingPayout,
            paidPayout,
            failedPayout,
            availableBalance,
            reserveHeld,
            payableBalance,
            payoutAccount: this.payoutAccountSummary(vendor?.payoutAccount),
            lastPayoutAt: lastPaidPayout?.updatedAt,
        };
    }

    private async vendorForChannel(ctx: RequestContext) {
        const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({
            where: { channelId: String(ctx.channelId), status: 'APPROVED' },
        });
        if (!vendor) throw new Error('This account is not connected to an approved vendor shop');
        return vendor;
    }

    private payoutAccountSummary(account?: MarketplaceVendorPayoutAccount): VendorPayoutAccountSummary {
        if (!account) return { verificationStatus: 'MISSING' };
        const visible = account.accountIdentifier.replace(/\s+/g, '');
        return {
            method: account.method,
            accountHolderName: account.accountHolderName,
            bankName: account.bankName,
            accountIdentifierMasked: `${'*'.repeat(Math.max(4, Math.min(12, visible.length - 4)))}${visible.slice(-4)}`,
            verificationStatus: account.verificationStatus,
            submittedAt: account.submittedAt,
            verifiedAt: account.verifiedAt,
            verificationNote: account.verificationNote,
        };
    }

    private vendorFinanceAlerts(
        balance: VendorFinanceBalance,
        entries: PayoutLedgerEntry[],
        batches: MarketplacePayoutBatch[],
    ) {
        const alerts: Array<{
            id: string;
            type: string;
            tone: string;
            title: string;
            message: string;
            createdAt: Date | string;
        }> = [];
        const account = balance.payoutAccount;
        if (account.verificationStatus === 'MISSING') {
            alerts.push({
                id: `payout-account:${balance.vendorId}:missing`,
                type: 'ACCOUNT_VERIFICATION',
                tone: 'WARNING',
                title: 'Payout account required',
                message: 'Add a payout account before your available balance can be included in a payout batch.',
                createdAt: new Date(),
            });
        } else if (account.verificationStatus === 'PENDING') {
            alerts.push({
                id: `payout-account:${balance.vendorId}:pending`,
                type: 'ACCOUNT_VERIFICATION',
                tone: 'INFO',
                title: 'Payout account under review',
                message: 'Your payout account was submitted and is awaiting marketplace verification.',
                createdAt: account.submittedAt ?? new Date(),
            });
        } else if (account.verificationStatus === 'REJECTED') {
            alerts.push({
                id: `payout-account:${balance.vendorId}:rejected`,
                type: 'ACCOUNT_VERIFICATION',
                tone: 'DANGER',
                title: 'Payout account needs correction',
                message: account.verificationNote ?? 'Update your payout account details and submit them again.',
                createdAt: account.submittedAt ?? new Date(),
            });
        }
        const failedBatch = batches.find(batch => batch.status === 'FAILED');
        const failedEntry = entries.find(entry => entry.kind === 'PAYOUT' && entry.status === 'FAILED');
        if (failedBatch || failedEntry) {
            alerts.push({
                id: `failed-payout:${failedBatch?.id ?? failedEntry?.id}`,
                type: 'FAILED_PAYOUT',
                tone: 'DANGER',
                title: 'Payout failed',
                message: failedBatch?.failureReason ?? failedEntry?.reason ?? 'Review your payout details or contact marketplace finance.',
                createdAt: failedBatch?.processedAt ?? failedEntry?.updatedAt ?? new Date(),
            });
        }
        if (balance.reserveHeld > 0) {
            alerts.push({
                id: `reserve:${balance.vendorId}:${balance.reserveHeld}`,
                type: 'RESERVE',
                tone: 'WARNING',
                title: 'Payout reserve held',
                message: `${balance.currencyCode} ${(balance.reserveHeld / 100).toLocaleString('en-PK')} is reserved under marketplace payout controls.`,
                createdAt: new Date(),
            });
        }
        if (balance.onHoldBalance > 0) {
            const nextRelease = entries
                .filter(entry => entry.status === 'ON_HOLD' && entry.availableAt)
                .sort((left, right) => left.availableAt!.getTime() - right.availableAt!.getTime())[0];
            alerts.push({
                id: `hold:${balance.vendorId}:${balance.onHoldBalance}`,
                type: 'HOLD',
                tone: 'INFO',
                title: 'Earnings are on hold',
                message: nextRelease?.availableAt
                    ? `Held earnings begin releasing on ${nextRelease.availableAt.toLocaleDateString('en-PK')}.`
                    : 'Some earnings are still within the marketplace holding period.',
                createdAt: nextRelease?.createdAt ?? new Date(),
            });
        }
        return alerts;
    }

    private async updatePayoutEntries(
        ctx: RequestContext,
        batch: MarketplacePayoutBatch,
        status: PayoutLedgerEntry['status'],
        reason?: string,
        externalReference?: string,
    ) {
        const ids = (batch.payoutEntryIds ?? []).filter(Boolean);
        if (!ids.length) return;
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const entries = await repository.find({ where: { id: In(ids) } });
        await repository.save(entries.map(entry => {
            entry.status = status;
            entry.reason = reason ?? entry.reason;
            entry.externalReference = externalReference ?? entry.externalReference;
            return entry;
        }), { reload: false });
        this.updateBatchSnapshot(batch, entries);
        await this.connection.getRepository(ctx, MarketplacePayoutBatch).save(batch, { reload: false });
    }

    private async withFinanceTransaction<T>(ctx: RequestContext, work: (ctx: RequestContext) => Promise<T>) {
        await this.ensureDefaultPayoutSettings(ctx);
        return withPayoutTransaction(this.connection, ctx, work);
    }

    private accountFingerprint(account: MarketplaceVendorPayoutAccount) {
        return createHash('sha256').update(JSON.stringify([
            account.method, account.accountIdentifier, account.accountHolderName, account.bankName ?? '', account.submittedAt,
        ])).digest('hex');
    }

    private async batchEntries(ctx: RequestContext, batch: MarketplacePayoutBatch) {
        const ids = batch.payoutEntryIds ?? [];
        const entries = ids.length ? await this.connection.getRepository(ctx, PayoutLedgerEntry).find({ where: { id: In(ids) } }) : [];
        if (!ids.length || entries.length !== ids.length || entries.some(entry => entry.kind !== 'PAYOUT'
            || entry.beneficiaryType !== 'VENDOR' || entry.amount >= 0
            || entry.currencyCode !== batch.currencyCode || String(entry.metadata?.payoutBatchId) !== String(batch.id))) {
            throw new Error('Payout batch ledger is incomplete or inconsistent');
        }
        if (entries.reduce((sum, entry) => sum - entry.amount, 0) !== batch.totalAmount) {
            throw new Error('Payout batch total does not match its recipients');
        }
        return entries;
    }

    private async validatePayoutRecipients(ctx: RequestContext, batch: MarketplacePayoutBatch, entries: PayoutLedgerEntry[]) {
        await this.releaseAvailableEntries(ctx);
        const settings = await this.getSettings(ctx);
        if (settings.currencyCode !== batch.currencyCode) throw new Error('Payout currency does not match current settings');
        for (const entry of entries) {
            const vendor = await this.connection.getRepository(ctx, VendorProfile).findOne({ where: { id: entry.beneficiaryId } });
            if (!vendor || vendor.status !== 'APPROVED' || vendor.enforcementStatus !== 'ACTIVE'
                || vendor.payoutAccount?.verificationStatus !== 'VERIFIED') {
                throw new Error('Each recipient must be an active approved vendor with a verified payout account');
            }
            if (entry.metadata?.payoutAccountFingerprint !== this.accountFingerprint(vendor.payoutAccount)) {
                throw new Error('Payout account changed or batch has no account snapshot; cancel and create a new batch');
            }
            const ledger = await this.connection.getRepository(ctx, PayoutLedgerEntry).find({
                where: { beneficiaryType: 'VENDOR', beneficiaryId: entry.beneficiaryId },
            });
            const active = ledger.filter(row => row.status !== 'REVERSED' && row.metadata?.accountingEffect !== 'INFORMATIONAL');
            if (active.some(row => row.currencyCode !== batch.currencyCode)) throw new Error('Vendor ledger currencies cannot be combined');
            const earnings = active.filter(row => row.kind !== 'PAYOUT' && row.status === 'AVAILABLE').reduce((sum, row) => sum + row.amount, 0);
            const otherPayouts = active.filter(row => row.kind === 'PAYOUT' && String(row.id) !== String(entry.id)
                && ['AVAILABLE', 'PENDING', 'APPROVED', 'PAID'].includes(row.status)).reduce((sum, row) => sum + row.amount, 0);
            const available = earnings + otherPayouts - Math.max(0, Math.round(earnings * settings.reservePercent / 100));
            if (available < -entry.amount) throw new Error('Vendor balance changed or an order is on hold; cancel and rebuild the unpaid payout');
        }
    }

    private snapshot(batch: MarketplacePayoutBatch): Array<Record<string, unknown>> {
        try {
            const value = JSON.parse(String(batch.metadata?.payoutsJson ?? '[]'));
            return Array.isArray(value) ? value : [];
        } catch { return []; }
    }

    private updateBatchSnapshot(batch: MarketplacePayoutBatch, entries: PayoutLedgerEntry[]) {
        const byId = new Map(entries.map(entry => [String(entry.id), entry]));
        batch.metadata = { ...batch.metadata, payoutsJson: JSON.stringify(this.snapshot(batch).map(row => {
            const entry = byId.get(String(row.payoutEntryId));
            return entry ? { ...row, status: entry.status, externalReference: entry.externalReference, reason: entry.reason } : row;
        })) };
    }

    private vendorEntry(entry: PayoutLedgerEntry) {
        const metadata = { ...entry.metadata };
        delete metadata.payoutAccountFingerprint;
        delete metadata.createdByUserId;
        delete metadata.processedByUserId;
        return { ...entry, metadata } as PayoutLedgerEntry;
    }

    private vendorBatch(batch: MarketplacePayoutBatch, vendorId: string, ledger: PayoutLedgerEntry[]) {
        const ids = new Set(batch.payoutEntryIds ?? []);
        const entries = ledger.filter(entry => ids.has(String(entry.id)) && entry.beneficiaryId === vendorId);
        const status = entries.every(entry => entry.status === 'PAID') ? 'PAID'
            : entries.every(entry => entry.status === 'FAILED') ? 'FAILED' : batch.status;
        return new MarketplacePayoutBatch({
            id: batch.id, createdAt: batch.createdAt, updatedAt: batch.updatedAt, code: batch.code,
            status, currencyCode: batch.currencyCode, totalAmount: entries.reduce((sum, entry) => sum - entry.amount, 0),
            vendorIds: [vendorId], payoutEntryIds: entries.map(entry => String(entry.id)),
            approvedAt: batch.approvedAt, processedAt: batch.processedAt,
            failureReason: entries.find(entry => entry.status === 'FAILED')?.reason,
        });
    }

    private async filteredLedgerEntries(ctx: RequestContext, from?: Date, to?: Date, vendorId?: string) {
        const query = this.connection.getRepository(ctx, PayoutLedgerEntry)
            .createQueryBuilder('entry')
            .where('entry.beneficiaryType = :type', { type: 'VENDOR' })
            .orderBy('entry.createdAt', 'DESC');
        if (vendorId) query.andWhere('entry.beneficiaryId = :vendorId', { vendorId });
        if (from) query.andWhere('entry.createdAt >= :from', { from });
        if (to) query.andWhere('entry.createdAt <= :to', { to });
        return query.getMany();
    }

    private reportRows(
        reportType: string,
        entries: PayoutLedgerEntry[],
        batches: MarketplacePayoutBatch[],
        balances: VendorFinanceBalance[],
    ) {
        if (reportType === 'PAYOUT') {
            return batches.map(batch => ({
                code: batch.code,
                status: batch.status,
                totalAmount: batch.totalAmount,
                vendorCount: batch.vendorIds?.length ?? 0,
                createdAt: batch.createdAt,
                processedAt: batch.processedAt,
            }));
        }
        if (reportType === 'LIABILITY') {
            return balances.map(balance => ({
                vendorId: balance.vendorId,
                vendorName: balance.vendorName,
                availableBalance: balance.availableBalance,
                reserveHeld: balance.reserveHeld,
                payableBalance: balance.payableBalance,
                pendingPayout: balance.pendingPayout,
                customerFundedSales: balance.customerFundedSales,
                rewardFunding: balance.rewardFunding,
                couponFunding: balance.couponFunding,
                couponDiscounts: balance.couponDiscounts,
            }));
        }
        if (reportType === 'COMMISSION') {
            return entries
                .filter(entry => ['COMMISSION', 'PAYMENT_FEE', 'REWARD_FUNDING', 'COUPON_FUNDING', 'COUPON_DISCOUNT'].includes(entry.kind))
                .map(entry => ({
                    id: String(entry.id),
                    createdAt: entry.createdAt,
                    vendorId: entry.beneficiaryId,
                    orderId: entry.orderId,
                    kind: entry.kind,
                    amount: entry.amount,
                    status: entry.status,
                    reason: entry.reason,
                }));
        }
        return entries.map(entry => ({
            id: String(entry.id),
            createdAt: entry.createdAt,
            vendorId: entry.beneficiaryId,
            orderId: entry.orderId,
            kind: entry.kind,
            amount: entry.amount,
            status: entry.status,
            reason: entry.reason,
        }));
    }

    private reportTotals(entries: PayoutLedgerEntry[], batches: MarketplacePayoutBatch[], balances: VendorFinanceBalance[]) {
        const sumEntries = (predicate: (entry: PayoutLedgerEntry) => boolean) => entries
            .filter(entry => entry.status !== 'REVERSED')
            .filter(predicate)
            .reduce((total, entry) => total + entry.amount, 0);
        return {
            grossSales: sumEntries(entry => entry.kind === 'SALE'),
            rewardFunding: sumEntries(entry => entry.kind === 'REWARD_FUNDING'),
            couponFunding: sumEntries(entry => entry.kind === 'COUPON_FUNDING'),
            couponDiscounts: Math.abs(sumEntries(entry => entry.kind === 'COUPON_DISCOUNT')),
            commission: Math.abs(sumEntries(entry => entry.kind === 'COMMISSION')),
            fees: Math.abs(sumEntries(entry => entry.kind === 'PAYMENT_FEE')),
            deliveryAdjustments: sumEntries(entry => entry.kind === 'DELIVERY_ADJUSTMENT'),
            refunds: Math.abs(sumEntries(entry => entry.kind === 'REFUND')),
            taxes: Math.abs(sumEntries(entry => entry.kind === 'TAX')),
            penalties: Math.abs(sumEntries(entry => entry.kind === 'PENALTY')),
            adjustments: sumEntries(entry => entry.kind === 'ADJUSTMENT'),
            payableLiability: balances.reduce((total, balance) => total + balance.payableBalance, 0),
            reserveLiability: balances.reduce((total, balance) => total + balance.reserveHeld, 0),
            pendingPayoutBatches: batches.filter(batch => ['PENDING_APPROVAL', 'APPROVED', 'PROCESSING'].includes(batch.status)).length,
            paidPayoutBatches: batches.filter(batch => batch.status === 'PAID').length,
            failedPayoutBatches: batches.filter(batch => batch.status === 'FAILED').length,
        };
    }

    private reportSummary(
        balances: VendorFinanceBalance[],
        batches: MarketplacePayoutBatch[],
        ledger: PayoutLedgerEntry[],
    ) {
        const activeLedger = ledger.filter(entry => entry.status !== 'REVERSED');
        return {
            vendorCount: balances.length,
            payableLiability: balances.reduce((total, balance) => total + balance.payableBalance, 0),
            reserveLiability: balances.reduce((total, balance) => total + balance.reserveHeld, 0),
            pendingPayout: balances.reduce((total, balance) => total + balance.pendingPayout, 0),
            failedPayout: balances.reduce((total, balance) => total + balance.failedPayout, 0),
            commissionRevenue: Math.abs(activeLedger.filter(entry => entry.kind === 'COMMISSION').reduce((total, entry) => total + entry.amount, 0)),
            feeRevenue: Math.abs(activeLedger.filter(entry => entry.kind === 'PAYMENT_FEE').reduce((total, entry) => total + entry.amount, 0)),
            rewardFunding: activeLedger.filter(entry => entry.kind === 'REWARD_FUNDING').reduce((total, entry) => total + entry.amount, 0),
            couponFunding: activeLedger.filter(entry => entry.kind === 'COUPON_FUNDING').reduce((total, entry) => total + entry.amount, 0),
            couponDiscounts: Math.abs(activeLedger.filter(entry => entry.kind === 'COUPON_DISCOUNT').reduce((total, entry) => total + entry.amount, 0)),
            openBatches: batches.filter(batch => ['PENDING_APPROVAL', 'APPROVED', 'PROCESSING'].includes(batch.status)).length,
            failedBatches: batches.filter(batch => batch.status === 'FAILED').length,
        };
    }

    private async assertOrderRefundNeedsManualDebit(
        ctx: RequestContext,
        beneficiaryId: string,
        orderReference: string,
    ) {
        const orderRepository = this.connection.getRepository(ctx, Order);
        const order = await orderRepository.findOne({
            where: /^\d+$/.test(orderReference)
                ? [{ id: orderReference }, { code: orderReference }]
                : { code: orderReference },
        });
        if (!order) return;

        const ledgerRepository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const orderEntries = await ledgerRepository.find({
            where: {
                beneficiaryType: 'VENDOR',
                beneficiaryId,
                orderId: String(order.id),
                status: 'REVERSED',
            },
        });
        const orderLedgerWasReversed = orderEntries
            .some(entry => entry.metadata?.source === 'MARKETPLACE_COMMISSION_RULES');
        if (!orderLedgerWasReversed) return;

        throw new Error('This order refund already reversed the vendor earnings. Do not add a second refund debit.');
    }

    private schedule(value: unknown) {
        const schedule = String(value ?? '').trim().toUpperCase();
        if (!['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY', 'MANUAL'].includes(schedule)) {
            throw new Error('Choose a valid payout schedule');
        }
        return schedule as MarketplacePayoutSettings['payoutSchedule'];
    }

    private percent(value: unknown, label: string) {
        const numeric = Number(value ?? 0);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) {
            throw new Error(`${label} percent must be between 0 and 100`);
        }
        return Math.round(numeric * 100) / 100;
    }

    private nonNegativeInteger(value: unknown, label: string) {
        const numeric = Number(value ?? 0);
        if (!Number.isSafeInteger(numeric) || numeric < 0) throw new Error(`${label} must be a safe whole number of zero or more`);
        return numeric;
    }

    private currencyCode(value: unknown) {
        const code = String(value ?? 'PKR').trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code)) throw new Error('Currency code must be a 3-letter ISO code');
        return code;
    }

    private optionalDate(value: unknown, endOfDay = false) {
        if (!value) return undefined;
        const date = value instanceof Date ? value : new Date(String(value));
        if (Number.isNaN(date.getTime())) throw new Error('Choose a valid report date range');
        if (endOfDay) date.setHours(23, 59, 59, 999);
        return date;
    }

    private cleanText(value: unknown, maxLength: number) {
        if (typeof value !== 'string' && typeof value !== 'number') return undefined;
        return String(value).replace(/[\u0000-\u001F\u007F]+/g, ' ').trim().slice(0, maxLength) || undefined;
    }

    private cleanPayoutName(value: unknown, field: string, maxLength: number, minimumLetters: number) {
        const name = this.cleanText(value, maxLength)?.replace(/\s+/g, ' ');
        if (!name) throw new Error(`Enter the ${field}`);
        if (!/^[\p{L}\p{M}0-9][\p{L}\p{M}0-9 .,'&()/-]*$/u.test(name)) {
            throw new Error(`Enter a valid ${field}`);
        }
        if ((name.match(/\p{L}/gu) ?? []).length < minimumLetters) {
            throw new Error(`Enter a valid ${field}`);
        }
        const compact = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (['abc', 'asdf', 'bank', 'dummy', 'none', 'null', 'qwerty', 'sample', 'test', 'testing'].includes(compact)) {
            throw new Error(`Enter a valid ${field}`);
        }
        return name;
    }

    private cleanAccountIdentifier(value: unknown, method: MarketplaceVendorPayoutAccount['method']) {
        if (value == null || String(value).trim() === '') return undefined;
        const identifier = String(value).replace(/[\s-]+/g, '').toUpperCase();
        if (method === 'BANK_TRANSFER') {
            if (identifier.startsWith('PK')) {
                if (!/^PK\d{2}[A-Z]{4}[A-Z0-9]{16}$/.test(identifier) || !this.hasValidIbanChecksum(identifier)) {
                    throw new Error('Enter a valid Pakistani IBAN');
                }
            } else if (!/^\d{8,24}$/.test(identifier) || this.isPlaceholderAccount(identifier)) {
                throw new Error('Enter a valid bank account number or Pakistani IBAN');
            }
            return identifier;
        }
        let walletNumber = identifier.replace(/^\+/, '');
        if (walletNumber.startsWith('0092')) walletNumber = walletNumber.slice(2);
        if (!/^(03\d{9}|923\d{9})$/.test(walletNumber) || this.isPlaceholderAccount(walletNumber)) {
            throw new Error('Enter a valid Pakistani mobile wallet number');
        }
        return walletNumber;
    }

    private hasValidIbanChecksum(iban: string) {
        const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`;
        let remainder = 0;
        for (const character of rearranged) {
            const digits = /[A-Z]/.test(character) ? String(character.charCodeAt(0) - 55) : character;
            for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
        }
        return remainder === 1;
    }

    private isPlaceholderAccount(identifier: string) {
        if (new Set(identifier).size <= 2) return true;
        return ['01234567', '12345678', '123456789', '987654321', '00000000', '11111111']
            .some(value => identifier === value || identifier === value.repeat(Math.ceil(identifier.length / value.length)).slice(0, identifier.length));
    }

    private appendNote(current?: string, addition?: string) {
        const note = this.cleanText(addition, 1000);
        if (!note) return current;
        return [current, note].filter(Boolean).join('\n');
    }
}
