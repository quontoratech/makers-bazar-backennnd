import { OrderType } from '@vendure/common/lib/generated-types';
import {
    Customer,
    CustomerService,
    ID,
    isGraphQlErrorResult,
    Order,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

import { MarketplaceListOptions, normalizeListOptions } from '../../../shared/pagination';
import { MarketplaceReport } from '../../report/entities/marketplace-report.entity';
import { MarketplaceReview } from '../../review/entities/marketplace-review.entity';
import { SupportCase } from '../../support/entities/support-case.entity';
import {
    CreateMarketplaceCustomerDataRequestInput,
    MarketplaceCustomerFilterInput,
    ProcessMarketplaceCustomerDataRequestInput,
} from '../dto/customer-management.inputs';
import { MarketplaceCustomerConsentRecord } from '../entities/customer-consent-record.entity';
import {
    MarketplaceCustomerDataRequest,
    MarketplaceCustomerDataRequestStatus,
    MarketplaceCustomerDataRequestType,
} from '../entities/customer-data-request.entity';

const requestTypes = new Set<MarketplaceCustomerDataRequestType>(['ACCESS', 'CORRECTION', 'EXPORT', 'DELETION']);
const requestStatuses = new Set<MarketplaceCustomerDataRequestStatus>(['UNDER_REVIEW', 'COMPLETED', 'REJECTED']);
const openSupportStatuses = new Set(['OPEN', 'WAITING_FOR_CUSTOMER', 'WAITING_FOR_VENDOR', 'ESCALATED']);
const terminalMarketplaceStatuses = new Set(['REJECTED', 'CANCELLED', 'REFUNDED']);
const failedPaymentStates = new Set(['Error', 'Declined', 'Cancelled']);
const pendingPaymentStates = new Set(['Created', 'Authorized']);

type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface CustomerRiskSignal {
    code: string;
    severity: RiskSeverity;
    title: string;
    description: string;
    evidenceCount: number;
}

@Injectable()
export class CustomerManagementService {
    constructor(
        private connection: TransactionalConnection,
        private customerService: CustomerService,
    ) {}

    async findAll(ctx: RequestContext, options?: MarketplaceListOptions, filter?: MarketplaceCustomerFilterInput) {
        const query = this.customerQuery(ctx).andWhere('customer.deletedAt IS NULL');
        const term = this.cleanOptional(filter?.term, 160)?.toLowerCase();
        if (term) {
            query.andWhere(`(
                LOWER(customer.firstName) LIKE :term OR LOWER(customer.lastName) LIKE :term OR
                LOWER(customer.emailAddress) LIKE :term OR LOWER(customer.phoneNumber) LIKE :term OR
                CAST(customer.id AS TEXT) LIKE :term
            )`, { term: `%${term}%` });
        }
        const customers = await query.orderBy('customer.createdAt', 'DESC').getMany();
        const summaries = await Promise.all(customers.map(customer => this.customerSummary(ctx, customer)));
        const verificationStatus = this.cleanOptional(filter?.verificationStatus, 30)?.toUpperCase();
        const riskLevel = this.cleanOptional(filter?.riskLevel, 30)?.toUpperCase();
        const filtered = summaries.filter(summary => {
            if (verificationStatus === 'VERIFIED' && !summary.verified) return false;
            if (verificationStatus === 'UNVERIFIED' && summary.verified) return false;
            if (riskLevel && riskLevel !== summary.riskLevel) return false;
            return true;
        });
        const { skip, take } = normalizeListOptions(options);
        return {
            items: filtered.slice(skip, skip + take),
            totalItems: filtered.length,
            verifiedCount: summaries.filter(item => item.verified).length,
            attentionCount: summaries.filter(item => ['HIGH', 'CRITICAL'].includes(item.riskLevel)).length,
            openRequestCount: summaries.reduce((total, item) => total + item.openPrivacyRequestCount, 0),
        };
    }

    async findOne(ctx: RequestContext, customerId: ID) {
        const customer = await this.customerQuery(ctx)
            .andWhere('customer.id = :customerId', { customerId })
            .getOne();
        if (!customer) throw new Error('Customer was not found');

        const [orders, reviews, supportCases, reports, consents, privacyRequests] = await Promise.all([
            this.customerOrders(ctx, customer.id),
            this.connection.getRepository(ctx, MarketplaceReview).find({
                where: { customerId: String(customer.id) },
                order: { createdAt: 'DESC' },
            }),
            customer.user ? this.connection.getRepository(ctx, SupportCase).find({
                where: { openedByUserId: String(customer.user.id) },
                order: { updatedAt: 'DESC' },
            }) : [],
            customer.user ? this.connection.getRepository(ctx, MarketplaceReport).find({
                where: { reportedUserId: String(customer.user.id) },
                order: { createdAt: 'DESC' },
            }) : [],
            this.connection.getRepository(ctx, MarketplaceCustomerConsentRecord).find({
                where: { customerId: String(customer.id) },
                order: { recordedAt: 'DESC' },
            }),
            this.connection.getRepository(ctx, MarketplaceCustomerDataRequest).find({
                where: { customerId: String(customer.id) },
                order: { createdAt: 'DESC' },
            }),
        ]);
        const risk = await this.assessRisk(ctx, customer, orders, reports);
        const retention = this.deletionEligibility(orders, supportCases);
        const paymentRows = orders.flatMap(order => (order.payments ?? []).map(payment => ({
            id: String(payment.id),
            createdAt: payment.createdAt,
            orderId: String(order.id),
            orderCode: order.code,
            method: payment.method,
            amount: payment.amount,
            state: payment.state,
            transactionId: payment.transactionId,
            errorMessage: payment.errorMessage,
        })));
        const refundRows = orders.flatMap(order => (order.payments ?? []).flatMap(payment =>
            (payment.refunds ?? []).map(refund => ({
                id: String(refund.id),
                createdAt: refund.createdAt,
                orderId: String(order.id),
                orderCode: order.code,
                paymentId: String(payment.id),
                method: refund.method,
                total: refund.total,
                state: refund.state,
                transactionId: refund.transactionId,
                reason: refund.reason,
            })),
        ));

        return {
            summary: await this.customerSummary(ctx, customer, orders, reports, risk),
            addresses: (customer.addresses ?? []).map(address => ({
                id: String(address.id),
                fullName: address.fullName,
                company: address.company,
                streetLine1: address.streetLine1,
                streetLine2: address.streetLine2,
                city: address.city,
                province: address.province,
                postalCode: address.postalCode,
                countryCode: address.country?.code,
                countryName: address.country?.name ?? address.country?.code,
                phoneNumber: address.phoneNumber,
                defaultShippingAddress: address.defaultShippingAddress,
                defaultBillingAddress: address.defaultBillingAddress,
            })),
            orders: orders.map(order => this.orderResult(order)),
            payments: paymentRows,
            refunds: refundRows,
            reviews,
            supportCases,
            consentRecords: consents,
            policyReports: reports,
            privacyRequests,
            risk,
            retention,
        };
    }

    async createDataRequest(ctx: RequestContext, input: CreateMarketplaceCustomerDataRequestInput) {
        const customer = await this.customerQuery(ctx)
            .andWhere('customer.id = :customerId', { customerId: input.customerId })
            .andWhere('customer.deletedAt IS NULL')
            .getOne();
        if (!customer?.user) throw new Error('An active registered customer is required');
        const type = String(input.type ?? '').trim().toUpperCase() as MarketplaceCustomerDataRequestType;
        if (!requestTypes.has(type)) throw new Error('Choose a valid privacy request type');
        const requestNote = this.cleanRequired(input.requestNote, 2000, 'Request details');
        const correction = type === 'CORRECTION' ? this.cleanCorrection(input.correction) : undefined;
        if (type === 'CORRECTION' && !Object.keys(correction ?? {}).length) {
            throw new Error('Add at least one profile correction');
        }
        const requestedByUserId = this.requireUser(ctx);
        return this.connection.getRepository(ctx, MarketplaceCustomerDataRequest).save(new MarketplaceCustomerDataRequest({
            code: `PRIV-${randomBytes(5).toString('hex').toUpperCase()}`,
            customerId: String(customer.id),
            customerUserId: String(customer.user.id),
            customerEmail: customer.emailAddress,
            type,
            status: 'SUBMITTED',
            requestNote,
            correction,
            requestedByUserId,
            dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        }));
    }

    async processDataRequest(ctx: RequestContext, input: ProcessMarketplaceCustomerDataRequestInput) {
        const repository = this.connection.getRepository(ctx, MarketplaceCustomerDataRequest);
        const request = await repository.findOne({ where: { id: input.id } });
        if (!request) throw new Error('Privacy request was not found');
        if (['COMPLETED', 'REJECTED'].includes(request.status)) {
            throw new Error('This privacy request is already closed');
        }
        const status = String(input.status ?? '').trim().toUpperCase() as MarketplaceCustomerDataRequestStatus;
        if (!requestStatuses.has(status)) throw new Error('Choose a valid privacy request status');
        const adminNote = this.cleanRequired(input.adminNote, 3000, 'Admin note');

        if (status === 'COMPLETED') {
            const customer = await this.customerQuery(ctx)
                .andWhere('customer.id = :customerId', { customerId: request.customerId })
                .getOne();
            if (!customer) throw new Error('Customer was not found');
            if (request.type === 'CORRECTION') {
                const { emailAddress, ...profileCorrection } = request.correction ?? {};
                if (Object.keys(profileCorrection).length) {
                    await this.customerService.update(ctx, { id: customer.id, ...profileCorrection });
                }
                if (emailAddress) {
                    if (!customer.user) throw new Error('A registered customer account is required for email correction');
                    const result = await this.customerService.requestUpdateEmailAddress(ctx, customer.user.id, emailAddress);
                    if (isGraphQlErrorResult(result)) throw new Error(result.message);
                }
            }
            if (request.type === 'DELETION') {
                if (!input.confirmDeletion) throw new Error('Confirm the guarded account deletion');
                const [orders, supportCases] = await Promise.all([
                    this.customerOrders(ctx, customer.id),
                    customer.user ? this.connection.getRepository(ctx, SupportCase).find({
                        where: { openedByUserId: String(customer.user.id) },
                    }) : [],
                ]);
                const retention = this.deletionEligibility(orders, supportCases);
                if (!retention.eligible) {
                    request.retentionReason = retention.reasons.join(' ');
                    await repository.save(request, { reload: false });
                    throw new Error(request.retentionReason);
                }
                await this.customerService.softDelete(ctx, customer.id);
            }
            if (request.type === 'EXPORT' || request.type === 'ACCESS') request.exportGeneratedAt = new Date();
            request.completedAt = new Date();
        }
        request.status = status;
        request.adminNote = adminNote;
        request.handledByUserId = this.requireUser(ctx);
        if (status === 'REJECTED') request.completedAt = new Date();
        await repository.save(request, { reload: false });
        return repository.findOneOrFail({ where: { id: request.id } });
    }

    async exportCustomerData(ctx: RequestContext, customerId: ID) {
        const profile = await this.findOne(ctx, customerId);
        return {
            generatedAt: new Date().toISOString(),
            customer: {
                id: profile.summary.id,
                createdAt: profile.summary.createdAt,
                firstName: profile.summary.firstName,
                lastName: profile.summary.lastName,
                emailAddress: profile.summary.emailAddress,
                phoneNumber: profile.summary.phoneNumber,
                verified: profile.summary.verified,
                addresses: profile.addresses,
            },
            orders: profile.orders,
            payments: profile.payments,
            refunds: profile.refunds,
            reviews: profile.reviews,
            supportHistory: profile.supportCases,
            consentRecords: profile.consentRecords,
        };
    }

    private customerQuery(ctx: RequestContext) {
        return this.connection.getRepository(ctx, Customer).createQueryBuilder('customer')
            .leftJoinAndSelect('customer.user', 'user')
            .leftJoinAndSelect('customer.addresses', 'addresses')
            .leftJoinAndSelect('addresses.country', 'addressCountry');
    }

    private customerOrders(ctx: RequestContext, customerId: ID) {
        return this.connection.getRepository(ctx, Order).createQueryBuilder('order')
            .leftJoinAndSelect('order.lines', 'lines')
            .leftJoinAndSelect('order.surcharges', 'surcharges')
            .leftJoinAndSelect('order.shippingLines', 'shippingLines')
            .leftJoinAndSelect('order.payments', 'payments')
            .leftJoinAndSelect('payments.refunds', 'refunds')
            .leftJoinAndSelect('order.sellerOrders', 'sellerOrders')
            .where('order.customerId = :customerId', { customerId })
            .andWhere('order.active = :active', { active: false })
            .andWhere('order.type IN (:...types)', { types: [OrderType.Aggregate, OrderType.Regular] })
            .orderBy('order.orderPlacedAt', 'DESC')
            .getMany();
    }

    private async customerSummary(
        ctx: RequestContext,
        customer: Customer,
        suppliedOrders?: Order[],
        suppliedReports?: MarketplaceReport[],
        suppliedRisk?: { level: RiskSeverity; score: number; signals: CustomerRiskSignal[] },
    ) {
        const [orders, reports, privacyRequests] = await Promise.all([
            suppliedOrders ?? this.customerOrders(ctx, customer.id),
            suppliedReports ?? (customer.user ? this.connection.getRepository(ctx, MarketplaceReport).find({
                where: { reportedUserId: String(customer.user.id) },
            }) : []),
            this.connection.getRepository(ctx, MarketplaceCustomerDataRequest).find({
                where: { customerId: String(customer.id) },
            }),
        ]);
        const risk = suppliedRisk ?? await this.assessRisk(ctx, customer, orders, reports);
        const refundTotal = orders.reduce((total, order) => total + (order.payments ?? [])
            .flatMap(payment => payment.refunds ?? [])
            .filter(refund => refund.state !== 'Failed')
            .reduce((sum, refund) => sum + refund.total, 0), 0);
        const totalSpent = orders
            .filter(order => !terminalMarketplaceStatuses.has(this.marketplaceOrderStatus(order)))
            .reduce((total, order) => total + order.totalWithTax, 0);
        return {
            id: String(customer.id),
            createdAt: customer.createdAt,
            updatedAt: customer.updatedAt,
            firstName: customer.firstName,
            lastName: customer.lastName,
            displayName: `${customer.firstName} ${customer.lastName}`.trim() || 'Customer',
            emailAddress: customer.emailAddress,
            phoneNumber: customer.phoneNumber,
            verified: Boolean(customer.user?.verified),
            lastLogin: customer.user?.lastLogin,
            status: customer.deletedAt ? 'DELETED' : 'ACTIVE',
            orderCount: orders.length,
            totalSpent,
            refundTotal,
            openSupportCases: customer.user ? (await this.connection.getRepository(ctx, SupportCase).find({
                where: { openedByUserId: String(customer.user.id) },
            })).filter(item => openSupportStatuses.has(item.status)).length : 0,
            riskLevel: risk.level,
            riskScore: risk.score,
            riskSignalCount: risk.signals.length,
            openPrivacyRequestCount: privacyRequests.filter(item => !['COMPLETED', 'REJECTED'].includes(item.status)).length,
        };
    }

    private async assessRisk(ctx: RequestContext, customer: Customer, orders: Order[], reports: MarketplaceReport[]) {
        const signals: CustomerRiskSignal[] = [];
        const statuses = orders.map(order => this.marketplaceOrderStatus(order));
        const cancelled = statuses.filter(status => ['CANCELLED', 'REJECTED'].includes(status)).length;
        const refunded = statuses.filter(status => status === 'REFUNDED').length;
        const payments = orders.flatMap(order => order.payments ?? []);
        const failedPayments = payments.filter(payment => failedPaymentStates.has(String(payment.state))).length;
        const refunds = payments.flatMap(payment => payment.refunds ?? []);
        const chargebacks = refunds.filter(refund => /chargeback|dispute|reversal/i.test(`${refund.reason} ${refund.method} ${JSON.stringify(refund.metadata)}`)).length;
        const promotionTerminals = orders.filter(order => order.couponCodes?.length && terminalMarketplaceStatuses.has(this.marketplaceOrderStatus(order))).length;
        const policyViolations = reports.filter(report => !['DISMISSED'].includes(report.status)).length;
        const orderCount = orders.length;

        if (orderCount >= 3 && (cancelled + refunded) / orderCount >= 0.5) {
            signals.push({ code: 'REPEATED_ORDER_REVERSALS', severity: 'HIGH', title: 'High cancellation or refund rate', description: `${cancelled + refunded} of ${orderCount} orders were cancelled, rejected, or refunded.`, evidenceCount: cancelled + refunded });
        }
        if (failedPayments >= 3) {
            signals.push({ code: 'FAILED_PAYMENT_PATTERN', severity: failedPayments >= 5 ? 'HIGH' : 'MEDIUM', title: 'Repeated failed payments', description: `${failedPayments} failed or declined payment attempts were detected.`, evidenceCount: failedPayments });
        }
        if (chargebacks) {
            signals.push({ code: 'CHARGEBACK_PATTERN', severity: chargebacks >= 2 ? 'CRITICAL' : 'HIGH', title: 'Chargeback activity', description: `${chargebacks} refund record${chargebacks === 1 ? '' : 's'} mention a chargeback, dispute, or reversal.`, evidenceCount: chargebacks });
        }
        if (promotionTerminals >= 2) {
            signals.push({ code: 'PROMOTION_ABUSE_PATTERN', severity: 'HIGH', title: 'Promotion reversal pattern', description: `${promotionTerminals} promotion-backed orders ended in cancellation or refund.`, evidenceCount: promotionTerminals });
        }
        if (policyViolations) {
            signals.push({ code: 'POLICY_REPORTS', severity: policyViolations >= 2 ? 'HIGH' : 'MEDIUM', title: 'Policy reports linked to account', description: `${policyViolations} non-dismissed trust and safety report${policyViolations === 1 ? '' : 's'} are linked to this customer.`, evidenceCount: policyViolations });
        }
        const normalizedPhone = this.normalizePhone(customer.phoneNumber);
        if (normalizedPhone) {
            const customers = await this.connection.getRepository(ctx, Customer).find();
            const duplicateCount = customers.filter(candidate => !candidate.deletedAt && this.normalizePhone(candidate.phoneNumber) === normalizedPhone).length;
            if (duplicateCount > 1) {
                signals.push({ code: 'SHARED_PHONE', severity: 'MEDIUM', title: 'Phone number shared by accounts', description: `This phone number is used by ${duplicateCount} active customer accounts.`, evidenceCount: duplicateCount });
            }
        }
        const weights: Record<RiskSeverity, number> = { LOW: 10, MEDIUM: 20, HIGH: 40, CRITICAL: 60 };
        const score = Math.min(100, signals.reduce((total, signal) => total + weights[signal.severity], 0));
        const level: RiskSeverity = score >= 70 ? 'CRITICAL' : score >= 40 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
        return { level, score, signals, evaluatedAt: new Date() };
    }

    private deletionEligibility(orders: Order[], supportCases: SupportCase[]) {
        const retentionDays = Math.max(0, Number(process.env.CUSTOMER_DATA_RETENTION_DAYS ?? 2555));
        const reasons: string[] = [];
        const latestOrderAt = orders.reduce<Date | undefined>((latest, order) => {
            const value = order.orderPlacedAt ?? order.createdAt;
            return !latest || value > latest ? value : latest;
        }, undefined);
        const retainedUntil = latestOrderAt ? new Date(latestOrderAt.getTime() + retentionDays * 24 * 60 * 60 * 1000) : undefined;
        if (retainedUntil && retainedUntil.getTime() > Date.now()) {
            reasons.push(`Financial transaction records are retained until ${retainedUntil.toISOString().slice(0, 10)} under the marketplace retention policy.`);
        }
        const pendingPayments = orders.flatMap(order => order.payments ?? []).filter(payment => pendingPaymentStates.has(String(payment.state))).length;
        if (pendingPayments) reasons.push(`${pendingPayments} payment transaction${pendingPayments === 1 ? ' is' : 's are'} still unresolved.`);
        const openCases = supportCases.filter(item => openSupportStatuses.has(item.status)).length;
        if (openCases) reasons.push(`${openCases} support case${openCases === 1 ? ' is' : 's are'} still open.`);
        return {
            eligible: reasons.length === 0,
            retentionDays,
            retainedUntil,
            reasons,
            action: reasons.length ? 'RESTRICTED' : 'SOFT_DELETE',
        };
    }

    private orderResult(order: Order) {
        return {
            id: String(order.id),
            code: order.code,
            createdAt: order.createdAt,
            placedAt: order.orderPlacedAt,
            state: order.state,
            marketplaceStatus: this.marketplaceOrderStatus(order),
            subTotal: order.subTotalWithTax,
            shipping: order.shippingWithTax,
            total: order.totalWithTax,
            currencyCode: String(order.currencyCode),
            couponCodes: order.couponCodes ?? [],
            shippingAddress: order.shippingAddress,
        };
    }

    private marketplaceOrderStatus(order: Order) {
        const sellerStatuses = (order.sellerOrders ?? []).map(sellerOrder =>
            String((sellerOrder.customFields as Record<string, unknown>)?.marketplaceStatus ?? sellerOrder.state).toUpperCase(),
        );
        if (sellerStatuses.includes('REFUNDED')) return 'REFUNDED';
        if (sellerStatuses.length && sellerStatuses.every(status => ['CANCELLED', 'REJECTED'].includes(status))) return 'CANCELLED';
        if (sellerStatuses.length && sellerStatuses.every(status => ['DELIVERED', 'FULFILLED'].includes(status))) return 'FULFILLED';
        return String((order.customFields as Record<string, unknown>)?.marketplaceStatus ?? order.state).toUpperCase();
    }

    private cleanCorrection(input?: CreateMarketplaceCustomerDataRequestInput['correction']) {
        if (!input) return undefined;
        const firstName = this.cleanOptional(input.firstName, 80);
        const lastName = this.cleanOptional(input.lastName, 80);
        const phoneNumber = this.cleanOptional(input.phoneNumber, 40);
        const emailAddress = this.cleanOptional(input.emailAddress, 255)?.toLowerCase();
        if (phoneNumber && !/^\+?[0-9 ()-]{7,20}$/.test(phoneNumber)) throw new Error('Enter a valid corrected phone number');
        if (emailAddress && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new Error('Enter a valid corrected email address');
        return {
            ...(firstName ? { firstName } : {}),
            ...(lastName ? { lastName } : {}),
            ...(phoneNumber ? { phoneNumber } : {}),
            ...(emailAddress ? { emailAddress } : {}),
        };
    }

    private normalizePhone(value?: string | null) {
        const digits = String(value ?? '').replace(/\D/g, '');
        return digits.length >= 7 ? digits : '';
    }

    private cleanRequired(value: unknown, maxLength: number, label: string) {
        const clean = this.cleanOptional(value, maxLength);
        if (!clean) throw new Error(`${label} is required`);
        return clean;
    }

    private cleanOptional(value: unknown, maxLength: number) {
        return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, maxLength) || undefined : undefined;
    }

    private requireUser(ctx: RequestContext) {
        if (ctx.activeUserId == null) throw new Error('Authenticated administrator required');
        return String(ctx.activeUserId);
    }

}
