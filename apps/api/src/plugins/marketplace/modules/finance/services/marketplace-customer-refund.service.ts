import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { Order, Permission, RequestContext, TransactionalConnection } from '@vendure/core';

import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { SupportCase } from '../../support/entities/support-case.entity';
import { RETURN_DISPUTE_CATEGORY } from '../../support/services/support.service';
import { returnSelectionCoversWholeOrder } from '../../support/return-policy';
import type { MarketplaceReturnSelectionItem } from '../../support/return-policy';
import { MarketplaceOrderService } from '../../order/services/marketplace-order.service';
import { MarketplaceRewardRedemption } from '../../review/entities/marketplace-reward-redemption.entity';
import { MarketplacePurchaseRewardService } from '../../review/services/marketplace-purchase-reward.service';
import { MarketplaceRewardRedemptionService } from '../../review/services/marketplace-reward-redemption.service';
import { MarketplaceCouponRedemption } from '../../promotion/entities/marketplace-coupon-redemption.entity';
import {
    CreateMarketplaceCustomerRefundInput,
    ProcessMarketplaceCustomerRefundInput,
} from '../dto/marketplace-customer-refund.inputs';
import {
    MarketplaceCustomerRefund,
    MarketplaceCustomerRefundMethod,
    MarketplaceCustomerRefundStatus,
} from '../entities/marketplace-customer-refund.entity';
import { calculateCustomerRefundAmounts, RefundableOrderStatus } from '../customer-refund-policy';
import { proportionalReturnShare, returnedShare } from '../partial-return-allocation';
import { PayoutLedgerEntry } from '../entities/payout-ledger-entry.entity';
import { MarketplaceCommissionRuleService } from './commission-rule.service';
import { marketplaceOrderPaymentIsSettled } from '../order-earnings-policy';
import { withPayoutTransaction } from '../payout-transaction';

const refundableStatuses = new Set<RefundableOrderStatus>(['CANCELLED', 'REJECTED', 'REFUNDED']);
const refundMethods = new Set<MarketplaceCustomerRefundMethod>(['BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH']);

interface PartialLineAmount {
    orderLineId: string;
    quantity: number;
    alreadyReturned: number;
    purchasedQuantity: number;
    productAmount: number;
    taxAmount: number;
}

interface PartialReturnAmounts {
    lines: PartialLineAmount[];
    productAmount: number;
    rewardAmount: number;
    rewardCoins: number;
    couponAmount: number;
    fundingAmount: number;
}

@Injectable()
export class MarketplaceCustomerRefundService {
    constructor(
        private connection: TransactionalConnection,
        private marketplaceOrderService: MarketplaceOrderService,
        private marketplaceCommissionRuleService: MarketplaceCommissionRuleService,
        private marketplacePurchaseRewardService: MarketplacePurchaseRewardService,
        private marketplaceRewardRedemptionService: MarketplaceRewardRedemptionService,
    ) {}

    async dashboard(ctx: RequestContext, status?: string) {
        const repository = this.connection.getRepository(ctx, MarketplaceCustomerRefund);
        const allItems = await repository.find({ order: { createdAt: 'DESC' } });
        const normalizedStatus = this.optionalStatus(status);
        const items = normalizedStatus
            ? allItems.filter(item => item.status === normalizedStatus)
            : allItems;
        const unpaid = allItems.filter(item => item.status === 'UNPAID');
        const paid = allItems.filter(item => item.status === 'PAID');
        const rejected = allItems.filter(item => item.status === 'REJECTED');
        return {
            items,
            totalItems: items.length,
            unpaidCount: unpaid.length,
            unpaidAmount: this.sumCash(unpaid),
            paidCount: paid.length,
            paidAmount: this.sumCash(paid),
            rejectedCount: rejected.length,
            currencyCode: 'PKR',
        };
    }

    async create(ctx: RequestContext, input: CreateMarketplaceCustomerRefundInput) {
        return withPayoutTransaction(this.connection, ctx, ctx => this.createLocked(ctx, input));
    }

    private async createLocked(ctx: RequestContext, input: CreateMarketplaceCustomerRefundInput) {
        if (ctx.activeUserId == null) throw new Error('An authenticated administrator is required');
        const repository = this.connection.getRepository(ctx, MarketplaceCustomerRefund);
        const sellerOrderId = String(input.sellerOrderId);
        const cases = await this.connection.getRepository(ctx, SupportCase).find({ where: { sellerOrderId } });
        const returnCase = input.supportCaseId
            ? cases.find(item => String(item.id) === String(input.supportCaseId) && item.category === RETURN_DISPUTE_CATEGORY)
            : undefined;
        if (input.supportCaseId && !returnCase) throw new Error('Return case does not belong to this seller order');
        if (!input.supportCaseId && cases.some(item => item.category === RETURN_DISPUTE_CATEGORY)) {
            throw new Error('Select the specific return case before creating its refund');
        }
        const isReturn = !!returnCase;
        const previousRefunds = await repository.find({ where: { sellerOrderId } });
        const existing = isReturn
            ? previousRefunds.find(item => item.supportCaseId === String(returnCase.id)
                || (!!returnCase.refundId && String(item.id) === returnCase.refundId))
            : previousRefunds.find(item => !item.supportCaseId);
        if (existing && existing.status !== 'REJECTED') {
            throw new Error(`A ${existing.status.toLowerCase()} refund request already exists for this case or order`);
        }

        const order = await this.sellerOrder(ctx, sellerOrderId);
        const orderStatus = this.orderStatus(order);
        const partial = !!returnCase && !returnSelectionCoversWholeOrder(order.lines, returnCase.returnItems);
        if (isReturn) {
            if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
                throw new Error('Only the super administrator can authorize a return refund');
            }
            const ready = partial
                ? (returnCase.returnRequired ? returnCase.status === 'RETURN_RECEIVED' : returnCase.status === 'RETURN_APPROVED')
                    && orderStatus === 'RETURN_REQUESTED'
                : returnCase.returnRequired
                    ? returnCase.status === 'RETURN_RECEIVED' && orderStatus === 'RETURNED'
                    : returnCase.status === 'RETURN_APPROVED' && orderStatus === 'RETURN_APPROVED';
            const retry = returnCase.status === 'REFUND_PENDING' && returnCase.refundStatus === 'REJECTED'
                && (partial ? ['DELIVERED', 'FULFILLED'].includes(orderStatus) : orderStatus === 'REFUNDED');
            if (!ready && !retry) throw new Error('Approve the return and receive the product, if required, before refunding');
        } else if (!refundableStatuses.has(orderStatus as RefundableOrderStatus)) {
            throw new Error('Refund requests can only be created for cancelled, rejected, or refunded orders');
        }
        if (!order.customer) throw new Error('The order customer could not be found');
        if (!order.aggregateOrder) throw new Error('The customer order could not be found');
        if (!marketplaceOrderPaymentIsSettled(order)) {
            throw new Error('A customer refund requires confirmed company receipt of the original payment');
        }

        const vendor = await this.vendorForOrder(ctx, order);
        const rewardAllocation = await this.rewardAllocation(ctx, sellerOrderId);
        const couponAllocation = await this.couponAllocation(ctx, sellerOrderId);
        const selected = partial && returnCase
            ? this.partialAmounts(order, returnCase, previousRefunds.filter(item => item.id !== existing?.id),
                rewardAllocation, couponAllocation)
            : undefined;
        const amounts = calculateCustomerRefundAmounts({
            orderStatus: (isReturn ? 'REFUNDED' : orderStatus) as RefundableOrderStatus,
            productAmount: selected?.productAmount
                ?? order.lines.reduce((total, line) => total + line.discountedLinePriceWithTax, 0),
            deliveryAmount: order.shippingWithTax,
            marketplaceFundingAmount: selected
                ? selected.fundingAmount
                : (rewardAllocation?.amount ?? 0) + (couponAllocation?.allocation.amount ?? 0),
        });
        const payout = this.validatePayoutDetails(input);
        if (partial && returnCase && selected && !existing) {
            await this.marketplaceOrderService.restoreAfterReturn(ctx, sellerOrderId,
                returnCase.sellerOrderStatusBeforeReturn ?? 'FULFILLED',
                this.requiredText(input.reason, 'Refund reason', 1000));
            await this.marketplaceCommissionRuleService.createLedgerEntriesForSellerOrder(ctx, order);
            await this.recordPartialLedger(ctx, order, String(vendor.id), String(returnCase.id), selected,
                couponAllocation?.redemption.fundingSource);
            await this.marketplacePurchaseRewardService.reverseForReturnedItems(ctx, order,
                String(returnCase.id), returnCase.returnItems ?? []);
            await this.marketplaceRewardRedemptionService.restoreForReturnedItems(ctx, order,
                String(returnCase.id), selected.rewardCoins);
        } else if (isReturn && !partial && orderStatus !== 'REFUNDED') {
            await this.marketplaceOrderService.transitionReturnStatus(
                ctx, sellerOrderId, 'REFUNDED', this.requiredText(input.reason, 'Refund reason', 1000),
            );
        }
        const values = {
            sellerOrderId,
            supportCaseId: returnCase ? String(returnCase.id) : undefined,
            returnItems: returnCase?.returnItems,
            sellerOrderCode: order.code,
            customerOrderId: String(order.aggregateOrder.id),
            customerOrderCode: order.aggregateOrder.code,
            customerId: String(order.customer.id),
            customerName: `${order.customer.firstName} ${order.customer.lastName}`.trim() || 'Customer',
            customerEmail: order.customer.emailAddress,
            vendorId: String(vendor.id),
            vendorName: vendor.shopName,
            orderStatus: partial ? 'PARTIALLY_REFUNDED' as const
                : (isReturn ? 'REFUNDED' : orderStatus) as RefundableOrderStatus,
            ...amounts,
            rewardCoins: selected?.rewardCoins ?? rewardAllocation?.coins ?? 0,
            couponCode: couponAllocation?.redemption.couponCode,
            couponDiscountAmount: selected?.couponAmount ?? couponAllocation?.allocation.amount ?? 0,
            couponFundingSource: couponAllocation?.redemption.fundingSource,
            currencyCode: String(order.currencyCode),
            status: 'UNPAID' as const,
            ...payout,
            reason: this.requiredText(input.reason, 'Refund reason', 1000),
            requestedByUserId: String(ctx.activeUserId),
            paidByUserId: undefined,
            paidAt: undefined,
            transactionReference: undefined,
            rejectedByUserId: undefined,
            rejectedAt: undefined,
            decisionNote: undefined,
        };

        let refund: MarketplaceCustomerRefund;
        if (existing) {
            Object.assign(existing, values);
            refund = await repository.save(existing);
        } else {
            refund = await repository.save(new MarketplaceCustomerRefund(values));
        }
        if (isReturn && returnCase) {
            returnCase.status = 'REFUND_PENDING';
            returnCase.refundId = String(refund.id);
            returnCase.refundStatus = 'UNPAID';
            await this.connection.getRepository(ctx, SupportCase).save(returnCase);
        }
        return refund;
    }

    async process(ctx: RequestContext, input: ProcessMarketplaceCustomerRefundInput) {
        return withPayoutTransaction(this.connection, ctx, ctx => this.processLocked(ctx, input));
    }

    private async processLocked(ctx: RequestContext, input: ProcessMarketplaceCustomerRefundInput) {
        if (ctx.activeUserId == null) throw new Error('An authenticated administrator is required');
        const repository = this.connection.getRepository(ctx, MarketplaceCustomerRefund);
        const refund = await repository.findOne({ where: { id: input.id } });
        if (!refund) throw new Error('Customer refund request was not found');
        if (refund.status !== 'UNPAID') {
            throw new Error(`Only unpaid refund requests can be processed; this request is ${refund.status.toLowerCase()}`);
        }
        const nextStatus = String(input.status ?? '').trim().toUpperCase();
        const now = new Date();
        const returnCase = await this.connection.getRepository(ctx, SupportCase).findOne({
            where: refund.supportCaseId
                ? { id: refund.supportCaseId }
                : { refundId: String(refund.id) },
        });
        if (nextStatus === 'PAID') {
            if (returnCase?.category === RETURN_DISPUTE_CATEGORY) {
                if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
                    throw new Error('Only the super administrator can confirm a return refund');
                }
                if (returnCase.refundId !== String(refund.id) || returnCase.status !== 'REFUND_PENDING') {
                    throw new Error('Return case is not waiting for this refund');
                }
            }
            refund.status = 'PAID';
            refund.transactionReference = this.requiredText(
                input.transactionReference,
                'Transaction reference',
                120,
            );
            refund.decisionNote = this.optionalText(input.decisionNote, 1000);
            refund.paidByUserId = String(ctx.activeUserId);
            refund.paidAt = now;
            refund.rejectedByUserId = undefined;
            refund.rejectedAt = undefined;
            if (returnCase?.category === RETURN_DISPUTE_CATEGORY) {
                returnCase.status = 'REFUNDED';
                returnCase.refundStatus = 'PAID';
                returnCase.resolvedAt = now;
                returnCase.messages = [
                    ...(returnCase.messages ?? []),
                    {
                        authorId: String(ctx.activeUserId),
                        authorRole: 'ADMIN',
                        body: `Your refund has been transferred. Transaction reference: ${refund.transactionReference}.`,
                        createdAt: now.toISOString(),
                    },
                ];
                await this.connection.getRepository(ctx, SupportCase).save(returnCase);
                if (refund.orderStatus === 'PARTIALLY_REFUNDED') {
                    const ledgerRepository = this.connection.getRepository(ctx, PayoutLedgerEntry);
                    const entries = await ledgerRepository.find({
                        where: { orderId: refund.sellerOrderId, kind: 'REFUND' },
                    });
                    const activity = entries.find(entry => entry.metadata?.source === 'MARKETPLACE_PARTIAL_RETURN'
                        && entry.metadata.supportCaseId === String(returnCase.id));
                    if (activity) {
                        activity.status = 'PAID';
                        await ledgerRepository.save(activity, { reload: false });
                    }
                }
            }
        } else if (nextStatus === 'REJECTED') {
            refund.status = 'REJECTED';
            refund.decisionNote = this.requiredText(input.decisionNote, 'Rejection reason', 1000);
            refund.rejectedByUserId = String(ctx.activeUserId);
            refund.rejectedAt = now;
            refund.paidByUserId = undefined;
            refund.paidAt = undefined;
            refund.transactionReference = undefined;
            if (returnCase?.category === RETURN_DISPUTE_CATEGORY) {
                if (!ctx.userHasPermissions([Permission.SuperAdmin])) {
                    throw new Error('Only the super administrator can reject a return refund attempt');
                }
                if (returnCase.refundId !== String(refund.id) || returnCase.status !== 'REFUND_PENDING') {
                    throw new Error('Return case is not waiting for this refund');
                }
                returnCase.refundStatus = 'REJECTED';
                await this.connection.getRepository(ctx, SupportCase).save(returnCase);
            }
        } else {
            throw new Error('Refund status must be PAID or REJECTED');
        }
        return repository.save(refund);
    }

    private sellerOrder(ctx: RequestContext, id: string) {
        return this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('order.aggregateOrder', 'aggregateOrder')
            .leftJoinAndSelect('aggregateOrder.payments', 'aggregatePayments')
            .leftJoinAndSelect('aggregatePayments.refunds', 'aggregateRefunds')
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('lines.productVariant', 'productVariant')
            .leftJoinAndSelect('order.channels', 'channels')
            .where('order.id = :id', { id })
            .andWhere('order.type = :type', { type: OrderType.Seller })
            .andWhere('order.active = :active', { active: false })
            .getOne()
            .then(order => {
                if (!order) throw new Error('Seller order was not found');
                return order;
            });
    }

    private async vendorForOrder(ctx: RequestContext, order: Order) {
        const channelIds = order.channels.map(channel => String(channel.id));
        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendor = vendors.find(item => item.channelId && channelIds.includes(item.channelId));
        if (!vendor) throw new Error('The order vendor could not be found');
        return vendor;
    }

    private async rewardAllocation(ctx: RequestContext, sellerOrderId: string) {
        const redemptions = await this.connection.getRepository(ctx, MarketplaceRewardRedemption).find();
        return redemptions.flatMap(redemption => redemption.allocations ?? [])
            .find(allocation => allocation.sellerOrderId === sellerOrderId);
    }

    private async couponAllocation(ctx: RequestContext, sellerOrderId: string) {
        const redemptions = await this.connection.getRepository(ctx, MarketplaceCouponRedemption).find();
        for (const redemption of redemptions) {
            const allocation = (redemption.allocations ?? []).find(item => item.sellerOrderId === sellerOrderId);
            if (allocation) return { redemption, allocation };
        }
        return undefined;
    }

    private partialAmounts(
        order: Order,
        returnCase: SupportCase,
        priorRefunds: MarketplaceCustomerRefund[],
        reward?: Awaited<ReturnType<MarketplaceCustomerRefundService['rewardAllocation']>>,
        coupon?: Awaited<ReturnType<MarketplaceCustomerRefundService['couponAllocation']>>,
    ): PartialReturnAmounts {
        const selected = returnCase.returnItems ?? [];
        if (!selected.length) throw new Error('A partial return needs selected products');
        const priorQuantities = new Map<string, number>();
        for (const refund of priorRefunds) {
            if (!refund.returnItems?.length) throw new Error('The seller order already has a full refund');
            for (const item of refund.returnItems) {
                priorQuantities.set(item.orderLineId,
                    (priorQuantities.get(item.orderLineId) ?? 0) + item.quantity);
            }
        }
        const byId = new Map(order.lines.map(line => [String(line.id), line]));
        const lines = selected.map(item => {
            const line = byId.get(item.orderLineId);
            if (!line) throw new Error('A selected product is no longer on this seller order');
            const alreadyReturned = priorQuantities.get(item.orderLineId) ?? 0;
            const productAmount = returnedShare(line.discountedLinePriceWithTax,
                line.quantity, alreadyReturned, item.quantity);
            const taxTotal = Math.max(0, line.discountedLinePriceWithTax - line.discountedLinePrice);
            return {
                orderLineId: item.orderLineId,
                quantity: item.quantity,
                alreadyReturned,
                purchasedQuantity: line.quantity,
                productAmount,
                taxAmount: returnedShare(taxTotal, line.quantity, alreadyReturned, item.quantity),
            };
        });
        const productAmount = lines.reduce((sum, line) => sum + line.productAmount, 0);
        const fullProductAmount = order.lines.reduce((sum, line) => sum + line.discountedLinePriceWithTax, 0);
        const priorProductAmount = priorRefunds.reduce((sum, refund) => sum + refund.productAmount, 0);
        const rewardCoins = proportionalReturnShare(reward?.coins ?? 0,
            fullProductAmount, priorProductAmount, productAmount);
        const rewardAmount = proportionalReturnShare(reward?.amount ?? 0,
            fullProductAmount, priorProductAmount, productAmount);
        const couponAmount = this.selectedCouponAmount(order, selected, priorQuantities,
            coupon?.allocation.amount ?? 0, coupon?.allocation.lineAllocations ?? [],
            fullProductAmount, priorProductAmount, productAmount);
        const fundingAmount = proportionalReturnShare(
            Math.min(fullProductAmount, (reward?.amount ?? 0) + (coupon?.allocation.amount ?? 0)),
            fullProductAmount, priorProductAmount, productAmount);
        return { lines, productAmount, rewardAmount, rewardCoins, couponAmount, fundingAmount };
    }

    private selectedCouponAmount(
        order: Order,
        selected: MarketplaceReturnSelectionItem[],
        priorQuantities: Map<string, number>,
        totalCoupon: number,
        allocations: Array<{ variantId: string; amount: number }>,
        fullProductAmount: number,
        priorProductAmount: number,
        productAmount: number,
    ) {
        if (!allocations.length) {
            return proportionalReturnShare(totalCoupon, fullProductAmount, priorProductAmount, productAmount);
        }
        const couponByVariant = new Map<string, number>();
        for (const allocation of allocations) {
            couponByVariant.set(allocation.variantId,
                (couponByVariant.get(allocation.variantId) ?? 0) + allocation.amount);
        }
        const couponByLine = new Map<string, number>();
        for (const [variantId, amount] of couponByVariant) {
            const matching = order.lines.filter(line => String(line.productVariant.id) === variantId);
            const totalWeight = matching.reduce((sum, line) => sum + line.discountedLinePriceWithTax, 0);
            let precedingWeight = 0;
            for (const line of matching) {
                couponByLine.set(String(line.id), proportionalReturnShare(amount, totalWeight,
                    precedingWeight, line.discountedLinePriceWithTax));
                precedingWeight += line.discountedLinePriceWithTax;
            }
        }
        return selected.reduce((sum, item) => {
            const line = order.lines.find(candidate => String(candidate.id) === item.orderLineId)!;
            return sum + returnedShare(couponByLine.get(item.orderLineId) ?? 0,
                line.quantity, priorQuantities.get(item.orderLineId) ?? 0, item.quantity);
        }, 0);
    }

    private async recordPartialLedger(
        ctx: RequestContext,
        order: Order,
        vendorId: string,
        supportCaseId: string,
        selected: PartialReturnAmounts,
        couponFundingSource?: string,
    ) {
        const repository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        const entries = await repository.find({
            where: { beneficiaryType: 'VENDOR', beneficiaryId: vendorId, orderId: String(order.id) },
        });
        if (entries.some(entry => entry.metadata?.source === 'MARKETPLACE_PARTIAL_RETURN'
            && entry.metadata.supportCaseId === supportCaseId)) return;
        const sale = entries.find(entry => entry.kind === 'SALE'
            && entry.metadata?.source === 'MARKETPLACE_COMMISSION_RULES' && entry.status !== 'REVERSED');
        if (!sale) throw new Error('The original vendor sale ledger is missing');
        let ruleSummary: Array<{ lineId: string; commissionAmount: number; feeAmount: number }>;
        try {
            ruleSummary = JSON.parse(String(sale.metadata?.ruleSummary ?? ''));
            if (!Array.isArray(ruleSummary)) throw new Error('Invalid rule summary');
        } catch {
            throw new Error('The original commission breakdown is unavailable');
        }
        const byLine = new Map(ruleSummary.map(item => [String(item.lineId), item]));
        let commission = 0;
        let fees = 0;
        for (const item of selected.lines) {
            const original = byLine.get(item.orderLineId);
            if (!original) throw new Error('A selected product has no original commission entry');
            commission += returnedShare(original.commissionAmount,
                item.purchasedQuantity, item.alreadyReturned, item.quantity);
            fees += returnedShare(original.feeAmount,
                item.purchasedQuantity, item.alreadyReturned, item.quantity);
        }
        const tax = selected.lines.reduce((sum, item) => sum + item.taxAmount, 0);
        const metadata = { source: 'MARKETPLACE_PARTIAL_RETURN', supportCaseId, sellerOrderCode: order.code };
        const values: Array<{ kind: PayoutLedgerEntry['kind']; amount: number; informational?: boolean }> = [
            { kind: 'SALE', amount: -selected.productAmount },
            { kind: 'COMMISSION', amount: commission },
            { kind: 'PAYMENT_FEE', amount: fees },
            { kind: 'TAX', amount: tax },
            { kind: 'COUPON_DISCOUNT', amount: couponFundingSource === 'VENDOR' ? selected.couponAmount : 0 },
            { kind: 'REWARD_FUNDING', amount: -selected.rewardAmount, informational: true },
            { kind: 'COUPON_FUNDING', amount: couponFundingSource === 'MARKETPLACE' ? -selected.couponAmount : 0, informational: true },
            { kind: 'REFUND', amount: -selected.productAmount, informational: true },
        ];
        await repository.save(values.filter(value => value.amount !== 0).map(value => new PayoutLedgerEntry({
            beneficiaryType: 'VENDOR',
            beneficiaryId: vendorId,
            orderId: String(order.id),
            kind: value.kind,
            amount: value.amount,
            currencyCode: String(order.currencyCode),
            status: value.kind === 'REFUND' ? 'PENDING' : 'ON_HOLD',
            availableAt: sale.availableAt,
            reason: `Selected-item return ${supportCaseId} for seller order ${order.code}`,
            metadata: value.informational ? { ...metadata, accountingEffect: 'INFORMATIONAL' } : metadata,
        })));
    }

    private validatePayoutDetails(input: CreateMarketplaceCustomerRefundInput) {
        const method = String(input.method ?? '').trim().toUpperCase() as MarketplaceCustomerRefundMethod;
        if (!refundMethods.has(method)) throw new Error('Choose bank transfer, Easypaisa, or JazzCash');
        const accountHolderName = this.requiredText(input.accountHolderName, 'Account holder name', 120);
        const bankName = method === 'BANK_TRANSFER'
            ? this.requiredText(input.bankName, 'Bank name', 120)
            : this.optionalText(input.bankName, 120);
        const accountIdentifier = String(input.accountIdentifier ?? '').replace(/\s+/g, '').toUpperCase();
        if (method === 'BANK_TRANSFER') {
            const validIban = /^PK\d{2}[A-Z0-9]{20}$/.test(accountIdentifier);
            const validAccount = /^[A-Z0-9-]{8,24}$/.test(accountIdentifier);
            if (!validIban && !validAccount) throw new Error('Enter a valid Pakistani IBAN or bank account number');
        } else if (!/^(?:\+92|0)3\d{9}$/.test(accountIdentifier)) {
            throw new Error('Enter a valid Pakistani mobile wallet number');
        }
        return { method, accountHolderName, bankName, accountIdentifier };
    }

    private orderStatus(order: Order) {
        const stored = String((order.customFields as Record<string, unknown> | undefined)?.marketplaceStatus ?? '')
            .trim()
            .toUpperCase();
        if (stored === 'PLACED') return 'PENDING';
        if (stored === 'SHIPPED') return 'DISPATCHED';
        return stored;
    }

    private optionalStatus(value?: string) {
        if (!value) return undefined;
        const status = value.trim().toUpperCase() as MarketplaceCustomerRefundStatus;
        if (!['UNPAID', 'PAID', 'REJECTED'].includes(status)) throw new Error('Unknown customer refund status');
        return status;
    }

    private sumCash(items: MarketplaceCustomerRefund[]) {
        return items.reduce((total, item) => total + item.cashAmount, 0);
    }

    private requiredText(value: unknown, label: string, maxLength: number) {
        const cleaned = this.optionalText(value, maxLength);
        if (!cleaned || cleaned.length < 3) throw new Error(`${label} must contain at least 3 characters`);
        return cleaned;
    }

    private optionalText(value: unknown, maxLength: number) {
        const cleaned = String(value ?? '')
            .replace(/[\u0000-\u001F\u007F]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned ? cleaned.slice(0, maxLength).trim() : undefined;
    }
}
