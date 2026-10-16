import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { ForbiddenError, Order, RequestContext, TransactionalConnection } from '@vendure/core';

import { PayoutLedgerEntry } from '../../finance/entities/payout-ledger-entry.entity';
import { VendorProfile } from '../../vendor/entities/vendor-profile.entity';
import { MarketplaceCouponService } from '../../promotion/services/marketplace-coupon.service';
import { UpdateMarketplaceRewardRedemptionSettingsInput } from '../dto/marketplace-reward-redemption.inputs';
import {
    MarketplaceRewardRedemption,
    MarketplaceRewardRedemptionAllocation,
} from '../entities/marketplace-reward-redemption.entity';
import { MarketplaceRewardRedemptionSettings } from '../entities/marketplace-reward-redemption-settings.entity';
import { MarketplaceRewardWalletTransaction } from '../entities/marketplace-reward-wallet-transaction.entity';
import {
    allocateCoinsByWeight,
    customerFundedProductAmount,
    maximumRedeemableCoins,
    rewardCoinValueMinor,
    validateCoinsPerPkr,
} from './reward-redemption-policy';

@Injectable()
export class MarketplaceRewardRedemptionService {
    constructor(
        private connection: TransactionalConnection,
        private marketplaceCouponService: MarketplaceCouponService,
    ) {}

    async settings(ctx: RequestContext) {
        const repository = this.connection.getRepository(ctx, MarketplaceRewardRedemptionSettings);
        const existing = await repository.findOne({ where: { scopeKey: 'GLOBAL' } });
        if (existing) return existing;
        try {
            return await repository.save(repository.create({ scopeKey: 'GLOBAL' }));
        } catch (error) {
            const concurrentlyCreated = await repository.findOne({ where: { scopeKey: 'GLOBAL' } });
            if (concurrentlyCreated) return concurrentlyCreated;
            throw error;
        }
    }

    async updateSettings(ctx: RequestContext, input: UpdateMarketplaceRewardRedemptionSettingsInput) {
        const settings = await this.settings(ctx);
        settings.enabled = Boolean(input.enabled);
        settings.minimumWalletBalance = this.nonNegativeInteger(
            input.minimumWalletBalance,
            'Minimum wallet balance',
            10_000_000,
        );
        settings.coinsPerPkr = this.coinRate(input.coinsPerPkr);
        settings.updatedByUserId = this.requireUser(ctx);
        return this.connection.getRepository(ctx, MarketplaceRewardRedemptionSettings).save(settings);
    }

    async reserve(ctx: RequestContext, orderId: string, requestedCoins: number) {
        const userId = this.requireUser(ctx);
        const coins = this.positiveInteger(requestedCoins, 'Coins to redeem', 10_000_000);
        const settings = await this.settings(ctx);
        if (!settings.enabled) throw new Error('Coin redemption is currently unavailable');

        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId },
            relations: ['customer', 'customer.user'],
        });
        if (!order || order.type === OrderType.Seller || !order.active) {
            throw new Error('The active checkout could not be found');
        }
        if (!order.customer || String(order.customer.user?.id ?? '') !== userId) throw new ForbiddenError();

        const repository = this.connection.getRepository(ctx, MarketplaceRewardRedemption);
        const existing = await repository.findOne({ where: { orderId: String(order.id) } });
        if (existing?.status === 'RESERVED' && existing.coins === coins) return this.quote(existing, settings);
        if (existing && !['RELEASED', 'REVERSED'].includes(existing.status)) {
            throw new Error('This checkout already has a coin redemption reservation');
        }

        const balance = await this.walletBalance(ctx, userId);
        if (balance < settings.minimumWalletBalance) {
            throw new Error(`A wallet balance of ${settings.minimumWalletBalance} coins is required before redemption`);
        }
        if (coins > balance) throw new Error('You do not have enough reward coins');

        const coinValue = rewardCoinValueMinor(settings.coinsPerPkr);
        const couponAmount = await this.marketplaceCouponService.reservedAmountForOrder(ctx, String(order.id));
        const maximumCoins = maximumRedeemableCoins(
            balance,
            Math.max(0, order.subTotalWithTax - couponAmount),
            settings.coinsPerPkr,
        );
        if (coins > maximumCoins) throw new Error('Reward coins cannot exceed the products subtotal');

        const redemption = existing ?? repository.create({ orderId: String(order.id) });
        redemption.orderCode = order.code;
        redemption.customerId = String(order.customer.id);
        redemption.customerUserId = userId;
        redemption.customerName = `${order.customer.firstName} ${order.customer.lastName}`.trim() || 'Customer';
        redemption.coins = coins;
        redemption.amount = coins * coinValue;
        redemption.currencyCode = String(order.currencyCode);
        redemption.status = 'RESERVED';
        redemption.reservedAt = new Date();
        redemption.appliedAt = undefined;
        redemption.reversedAt = undefined;
        redemption.reversalReason = undefined;
        redemption.allocations = undefined;
        const saved = await repository.save(redemption);
        await this.walletTransaction(
            ctx,
            saved,
            -coins,
            'DEBIT',
            `${coins} coins reserved for checkout`,
            `reservation-debit:${saved.reservedAt.getTime()}`,
        );
        return this.quote(saved, settings);
    }

    async release(ctx: RequestContext, orderId: string, reason = 'Checkout was not completed') {
        const userId = this.requireUser(ctx);
        const repository = this.connection.getRepository(ctx, MarketplaceRewardRedemption);
        const redemption = await repository.findOne({ where: { orderId: String(orderId) } });
        if (!redemption) return { success: true, message: 'No coin reservation was present' };
        if (redemption.customerUserId !== userId) throw new ForbiddenError();
        if (redemption.status !== 'RESERVED') return { success: true, message: 'Coin reservation was already finalized' };
        redemption.status = 'RELEASED';
        redemption.reversedAt = new Date();
        redemption.reversalReason = this.cleanReason(reason);
        await repository.save(redemption, { reload: false });
        await this.walletTransaction(
            ctx,
            redemption,
            redemption.coins,
            'CREDIT',
            'Checkout coin reservation returned',
            `reservation-return:${redemption.reservedAt.getTime()}`,
        );
        return { success: true, message: `${redemption.coins} coins returned to the wallet` };
    }

    async completeForSellerOrders(ctx: RequestContext, aggregateOrder: Order, sellerOrders: Order[]) {
        const repository = this.connection.getRepository(ctx, MarketplaceRewardRedemption);
        const redemption = await repository.findOne({ where: { orderId: String(aggregateOrder.id) } });
        if (!redemption || redemption.status !== 'RESERVED') return;
        if (!sellerOrders.length) throw new Error('Reward funding could not be allocated without seller orders');

        const vendors = await this.connection.getRepository(ctx, VendorProfile).find();
        const vendorByChannel = new Map(vendors.flatMap(vendor => vendor.channelId
            ? [[String(vendor.channelId), vendor] as const]
            : []));
        const sellerProductSubTotals = sellerOrders.map(order => order.lines.reduce(
            (total, line) => total + Math.max(0, line.discountedLinePriceWithTax),
            0,
        ));
        const totalWeight = sellerProductSubTotals.reduce((total, amount) => total + amount, 0);
        if (totalWeight <= 0) throw new Error('Reward funding requires a positive products subtotal');

        const coinAllocations = allocateCoinsByWeight(
            redemption.coins,
            sellerProductSubTotals,
        );
        const allocations: MarketplaceRewardRedemptionAllocation[] = sellerOrders.map((sellerOrder, index) => {
            const coins = coinAllocations[index]!;
            const vendorGrossAmount = sellerProductSubTotals[index]!;
            const vendor = sellerOrder.channels
                .map(channel => vendorByChannel.get(String(channel.id)))
                .find(Boolean);
            if (!vendor) throw new Error(`Reward funding could not identify the vendor for seller order ${sellerOrder.code}`);
            const amount = coins * (redemption.amount / redemption.coins);
            return {
                sellerOrderId: String(sellerOrder.id),
                sellerOrderCode: sellerOrder.code,
                vendorId: String(vendor.id),
                vendorName: vendor.shopName,
                coins,
                amount,
                vendorGrossAmount,
                customerFundedAmount: customerFundedProductAmount(vendorGrossAmount, amount),
            };
        });
        const allocatedAmount = allocations.reduce((total, allocation) => total + allocation.amount, 0);
        allocations[allocations.length - 1]!.amount += redemption.amount - allocatedAmount;
        allocations[allocations.length - 1]!.customerFundedAmount = customerFundedProductAmount(
            allocations[allocations.length - 1]!.vendorGrossAmount,
            allocations[allocations.length - 1]!.amount,
        );

        redemption.allocations = allocations;
        redemption.status = 'APPLIED';
        redemption.appliedAt = new Date();
        await repository.save(redemption, { reload: false });

        const ledgerRepository = this.connection.getRepository(ctx, PayoutLedgerEntry);
        for (const allocation of allocations.filter(item => item.amount > 0)) {
            const existingEntries = await ledgerRepository.find({
                where: { beneficiaryType: 'VENDOR', beneficiaryId: allocation.vendorId, orderId: allocation.sellerOrderId },
            });
            const alreadyRecorded = existingEntries.some(entry => entry.kind === 'REWARD_FUNDING'
                && entry.metadata?.rewardRedemptionId === String(redemption.id));
            if (alreadyRecorded) continue;
            await ledgerRepository.save(new PayoutLedgerEntry({
                beneficiaryType: 'VENDOR',
                beneficiaryId: allocation.vendorId,
                orderId: allocation.sellerOrderId,
                kind: 'REWARD_FUNDING',
                amount: allocation.amount,
                currencyCode: redemption.currencyCode,
                status: 'AVAILABLE',
                availableAt: new Date(),
                reason: `${allocation.coins} customer reward coins funded by the marketplace`,
                metadata: {
                    accountingEffect: 'INFORMATIONAL',
                    source: 'CUSTOMER_REWARD_REDEMPTION',
                    rewardRedemptionId: String(redemption.id),
                    rewardCoins: allocation.coins,
                    customerFundedAmount: allocation.customerFundedAmount,
                    vendorGrossAmount: allocation.vendorGrossAmount,
                    aggregateOrderId: String(aggregateOrder.id),
                    aggregateOrderCode: aggregateOrder.code,
                },
            }));
        }
    }

    async reverseForSellerOrder(ctx: RequestContext, sellerOrder: Pick<Order, 'id' | 'code'>, reason: string) {
        const repository = this.connection.getRepository(ctx, MarketplaceRewardRedemption);
        const redemptions = await repository.find();
        const redemption = redemptions.find(item => (item.allocations ?? [])
            .some(allocation => allocation.sellerOrderId === String(sellerOrder.id)));
        if (!redemption || !['APPLIED', 'PARTIALLY_REVERSED'].includes(redemption.status)) return;
        const allocation = redemption.allocations?.find(item => item.sellerOrderId === String(sellerOrder.id));
        if (!allocation || allocation.reversedAt) return;

        const alreadyReturned = await this.partiallyReturnedCoins(ctx, redemption, String(sellerOrder.id));

        allocation.reversedAt = new Date().toISOString();
        const remaining = (redemption.allocations ?? []).some(item => !item.reversedAt);
        redemption.status = remaining ? 'PARTIALLY_REVERSED' : 'REVERSED';
        redemption.reversedAt = remaining ? undefined : new Date();
        redemption.reversalReason = this.cleanReason(reason);
        await repository.save(redemption, { reload: false });
        const coinsToReturn = Math.max(0, allocation.coins - alreadyReturned);
        if (coinsToReturn > 0) {
            await this.walletTransaction(
                ctx,
                redemption,
                coinsToReturn,
                'CREDIT',
                `${coinsToReturn} redeemed coins returned after order ${sellerOrder.code} was ${reason.toLowerCase()}`,
                `seller-return:${sellerOrder.id}`,
            );
        }
        const fundingEntries = await this.connection.getRepository(ctx, PayoutLedgerEntry).find({
            where: { beneficiaryType: 'VENDOR', beneficiaryId: allocation.vendorId, orderId: allocation.sellerOrderId },
        });
        for (const entry of fundingEntries.filter(item => item.kind === 'REWARD_FUNDING'
            && item.metadata?.rewardRedemptionId === String(redemption.id)
            && item.status !== 'REVERSED')) {
            entry.status = 'REVERSED';
            entry.reason = `${entry.reason}; reversed after order became ${reason}`;
            await this.connection.getRepository(ctx, PayoutLedgerEntry).save(entry, { reload: false });
        }
    }

    async restoreForReturnedItems(
        ctx: RequestContext,
        sellerOrder: Pick<Order, 'id' | 'code'>,
        supportCaseId: string,
        coins: number,
    ) {
        if (!coins) return;
        const repository = this.connection.getRepository(ctx, MarketplaceRewardRedemption);
        const redemptions = await repository.find();
        const redemption = redemptions.find(item => (item.allocations ?? [])
            .some(allocation => allocation.sellerOrderId === String(sellerOrder.id)));
        const allocation = redemption?.allocations?.find(item => item.sellerOrderId === String(sellerOrder.id));
        const eventKey = redemption
            ? `reward-redemption:${redemption.id}:partial-return:${sellerOrder.id}:${supportCaseId}`
            : undefined;
        if (eventKey && await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction)
            .findOne({ where: { eventKey } })) return;
        if (!redemption || !allocation || allocation.reversedAt) {
            throw new Error('The original redeemed coins cannot be restored for this return');
        }
        const alreadyReturned = await this.partiallyReturnedCoins(ctx, redemption, String(sellerOrder.id));
        if (!Number.isSafeInteger(coins) || coins < 0 || alreadyReturned + coins > allocation.coins) {
            throw new Error('Returned coins exceed the original redemption');
        }
        await this.walletTransaction(ctx, redemption, coins, 'CREDIT',
            `${coins} redeemed coins returned for selected items in ${sellerOrder.code}`,
            `partial-return:${sellerOrder.id}:${supportCaseId}`);
        if (alreadyReturned + coins === allocation.coins) {
            allocation.reversedAt = new Date().toISOString();
            const remaining = (redemption.allocations ?? []).some(item => !item.reversedAt);
            redemption.status = remaining ? 'PARTIALLY_REVERSED' : 'REVERSED';
            redemption.reversedAt = remaining ? undefined : new Date();
            redemption.reversalReason = 'Selected-item return';
            await repository.save(redemption, { reload: false });
        }
    }

    private async partiallyReturnedCoins(
        ctx: RequestContext,
        redemption: MarketplaceRewardRedemption,
        sellerOrderId: string,
    ) {
        const transactions = await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).find({
            where: { reviewId: `redemption:${redemption.id}`, type: 'CREDIT' },
        });
        const prefix = `reward-redemption:${redemption.id}:partial-return:${sellerOrderId}:`;
        return transactions.filter(item => item.eventKey.startsWith(prefix))
            .reduce((sum, item) => sum + item.points, 0);
    }

    async fundingByOrderIds(ctx: RequestContext, orderIds: string[]) {
        const requested = new Set(orderIds);
        const result = new Map<string, { coins: number; amount: number; customerFundedAmount: number }>();
        if (!requested.size) return result;
        const redemptions = await this.connection.getRepository(ctx, MarketplaceRewardRedemption).find();
        for (const redemption of redemptions.filter(item => item.status !== 'RELEASED')) {
            const allocations = redemption.allocations ?? [];
            if (requested.has(redemption.orderId)) {
                result.set(redemption.orderId, {
                    coins: allocations.reduce((total, item) => total + item.coins, 0),
                    amount: allocations.reduce((total, item) => total + item.amount, 0),
                    customerFundedAmount: allocations.reduce((total, item) => total + item.customerFundedAmount, 0),
                });
            }
            for (const allocation of allocations) {
                if (!requested.has(allocation.sellerOrderId)) continue;
                result.set(allocation.sellerOrderId, {
                    coins: allocation.coins,
                    amount: allocation.amount,
                    customerFundedAmount: allocation.customerFundedAmount,
                });
            }
        }
        return result;
    }

    async dashboard(ctx: RequestContext) {
        const redemptions = await this.connection.getRepository(ctx, MarketplaceRewardRedemption).find({
            order: { createdAt: 'DESC' },
        });
        const activeAllocations = redemptions.flatMap(redemption => (redemption.allocations ?? [])
            .filter(allocation => !allocation.reversedAt));
        return {
            redemptionSettings: await this.settings(ctx),
            totalCoinsRedeemed: activeAllocations.reduce((total, item) => total + item.coins, 0),
            totalRewardFunding: activeAllocations.reduce((total, item) => total + item.amount, 0),
            recentRedemptions: redemptions.slice(0, 100),
        };
    }

    private async walletBalance(ctx: RequestContext, customerUserId: string) {
        const transactions = await this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction).find({
            where: { customerUserId },
        });
        return transactions.reduce((total, item) => total + item.points, 0);
    }

    private async walletTransaction(
        ctx: RequestContext,
        redemption: MarketplaceRewardRedemption,
        points: number,
        type: MarketplaceRewardWalletTransaction['type'],
        reason: string,
        suffix = '',
    ) {
        const repository = this.connection.getRepository(ctx, MarketplaceRewardWalletTransaction);
        const eventKey = `reward-redemption:${redemption.id}:${suffix}`;
        const existing = await repository.findOne({ where: { eventKey } });
        if (existing) return existing;
        return repository.save({
            eventKey,
            customerId: redemption.customerId,
            customerUserId: redemption.customerUserId,
            customerName: redemption.customerName,
            reviewId: `redemption:${redemption.id}`,
            orderCode: redemption.orderCode,
            reviewTargetType: 'CHECKOUT',
            component: 'REWARD_REDEMPTION',
            type,
            points,
            reason,
            grantId: `redemption:${redemption.id}${suffix ? `:${suffix}` : ''}`,
        });
    }

    private quote(redemption: MarketplaceRewardRedemption, settings: MarketplaceRewardRedemptionSettings) {
        return {
            id: String(redemption.id),
            orderId: redemption.orderId,
            orderCode: redemption.orderCode,
            coins: redemption.coins,
            amount: redemption.amount,
            customerPayableAmount: 0,
            currencyCode: redemption.currencyCode,
            status: redemption.status,
            minimumWalletBalance: settings.minimumWalletBalance,
            coinsPerPkr: settings.coinsPerPkr,
        };
    }

    private coinRate(value: unknown) {
        return validateCoinsPerPkr(value);
    }

    private positiveInteger(value: unknown, label: string, maximum: number) {
        const number = Number(value);
        if (!Number.isInteger(number) || number <= 0 || number > maximum) {
            throw new Error(`${label} must be a whole number from 1 to ${maximum.toLocaleString('en-PK')}`);
        }
        return number;
    }

    private nonNegativeInteger(value: unknown, label: string, maximum: number) {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0 || number > maximum) {
            throw new Error(`${label} must be a whole number from 0 to ${maximum.toLocaleString('en-PK')}`);
        }
        return number;
    }

    private cleanReason(value: unknown) {
        return String(value ?? '').replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new ForbiddenError();
        return String(ctx.activeUserId);
    }
}
