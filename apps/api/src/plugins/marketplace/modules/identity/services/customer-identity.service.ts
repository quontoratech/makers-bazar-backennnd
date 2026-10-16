import { Injectable } from '@nestjs/common';
import {
    Customer,
    CustomerService,
    EventBus,
    isGraphQlErrorResult,
    NativeAuthenticationMethod,
    RequestContext,
    TransactionalConnection,
    UserService,
} from '@vendure/core';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

import { MarketplaceCustomerConsentRecord } from '../../customer-management/entities/customer-consent-record.entity';
import {
    RegisterMarketplaceCustomerInput,
    VerifyMarketplaceCustomerOtpInput,
} from '../dto/customer-registration.inputs';
import { EmailVerificationChallenge } from '../entities/email-verification-challenge.entity';
import { CustomerOtpRequestedEvent } from '../events/customer-otp-requested.event';

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_DELAY_SECONDS = 60;

@Injectable()
export class CustomerIdentityService {
    constructor(
        private customerService: CustomerService,
        private userService: UserService,
        private connection: TransactionalConnection,
        private eventBus: EventBus,
    ) {}

    async requestRegistration(ctx: RequestContext, input: RegisterMarketplaceCustomerInput) {
        if (!input.termsAccepted || !input.privacyAccepted) {
            throw new Error('Accept the customer terms and privacy policy to create an account');
        }
        const emailAddress = this.normalizeEmail(input.emailAddress);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)) throw new Error('Enter a valid email address');
        if (
            !input.firstName.trim() ||
            !input.lastName.trim() ||
            input.firstName.length > 250 ||
            input.lastName.length > 250
        )
            throw new Error('Enter your first and last name');
        if (input.password.length < 12 || input.password.length > 256)
            throw new Error('Use a password between 12 and 256 characters');
        const phoneNumber = input.phoneNumber?.trim().replace(/[ ()-]/g, '');
        if (phoneNumber) {
            if (!/^\+?\d{7,15}$/.test(phoneNumber)) throw new Error('Enter a valid mobile number');
            const digits = phoneNumber.replace(/^\+/, '');
            const local = /^(92|0)?3\d{9}$/.test(digits) ? digits.slice(-10) : digits;
            const duplicate = await this.connection
                .getRepository(ctx, Customer)
                .createQueryBuilder('customer')
                .where('customer.deletedAt IS NULL')
                .andWhere(
                    "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(customer.phoneNumber, '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') IN (:...numbers)",
                    { numbers: [...new Set([digits, local, `0${local}`, `92${local}`])] },
                )
                .getOne();
            if (duplicate)
                throw new Error(
                    'This mobile number is already registered. Sign in to your existing account.',
                );
        }
        const result = await this.customerService.registerCustomerAccount(ctx, {
            firstName: input.firstName,
            lastName: input.lastName,
            phoneNumber,
            password: input.password,
            emailAddress,
        });
        if (isGraphQlErrorResult(result)) {
            throw new Error(result.message);
        }
        const user = await this.userService.getUserByEmailAddress(ctx, emailAddress);
        const customer = user ? await this.customerService.findOneByUserId(ctx, user.id) : undefined;
        if (!user || !customer) throw new Error('Unable to record customer registration');
        const consentRepository = this.connection.getRepository(ctx, MarketplaceCustomerConsentRecord);
        const recordedAt = new Date();
        await consentRepository.save([
            new MarketplaceCustomerConsentRecord({
                customerId: String(customer.id),
                userId: String(user.id),
                type: 'TERMS',
                granted: true,
                version: '1.0',
                source: 'CUSTOMER_REGISTRATION',
                recordedAt,
            }),
            new MarketplaceCustomerConsentRecord({
                customerId: String(customer.id),
                userId: String(user.id),
                type: 'PRIVACY',
                granted: true,
                version: '1.0',
                source: 'CUSTOMER_REGISTRATION',
                recordedAt,
            }),
            new MarketplaceCustomerConsentRecord({
                customerId: String(customer.id),
                userId: String(user.id),
                type: 'MARKETING',
                granted: Boolean(input.marketingConsent),
                version: '1.0',
                source: 'CUSTOMER_REGISTRATION',
                recordedAt,
            }),
        ]);
        return this.issueChallenge(ctx, emailAddress, input.firstName, false);
    }

    async resendRegistrationOtp(ctx: RequestContext, emailAddressInput: string) {
        const emailAddress = this.normalizeEmail(emailAddressInput);
        const repository = this.connection.getRepository(ctx, EmailVerificationChallenge);
        const existing = await repository.findOne({ where: { emailAddress } });
        if (existing) {
            const nextSendAt = existing.lastSentAt.getTime() + RESEND_DELAY_SECONDS * 1000;
            if (Date.now() < nextSendAt) {
                throw new Error('Please wait before requesting another verification code');
            }
        }
        await this.customerService.refreshVerificationToken(ctx, emailAddress);
        const user = await this.userService.getUserByEmailAddress(ctx, emailAddress);
        const firstName = user
            ? ((await this.customerService.findOneByUserId(ctx, user.id))?.firstName ?? 'there')
            : 'there';
        return this.issueChallenge(ctx, emailAddress, firstName, true);
    }

    async verifyRegistrationOtp(ctx: RequestContext, input: VerifyMarketplaceCustomerOtpInput) {
        const emailAddress = this.normalizeEmail(input.emailAddress);
        const repository = this.connection.getRepository(ctx, EmailVerificationChallenge);
        const challenge = await repository.findOne({ where: { emailAddress } });
        if (!challenge || challenge.consumedAt) {
            throw new Error('This verification code is invalid or has already been used');
        }
        if (challenge.expiresAt.getTime() <= Date.now()) {
            throw new Error('This verification code has expired. Request a new code');
        }
        if (challenge.attemptCount >= MAX_ATTEMPTS) {
            throw new Error('Too many incorrect attempts. Request a new code');
        }

        const suppliedHash = this.hashCode(emailAddress, input.code.trim());
        const expected = Buffer.from(challenge.codeHash, 'hex');
        const supplied = Buffer.from(suppliedHash, 'hex');
        const matches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
        if (!matches) {
            challenge.attemptCount += 1;
            await repository.save(challenge, { reload: false });
            throw new Error('The verification code is incorrect');
        }

        const result = await this.customerService.verifyCustomerEmailAddress(
            ctx,
            challenge.verificationToken,
        );
        if (isGraphQlErrorResult(result)) {
            throw new Error(result.message);
        }
        challenge.consumedAt = new Date();
        await repository.save(challenge, { reload: false });
        return { success: true, message: 'Email verified. You can now sign in.' };
    }

    private async issueChallenge(
        ctx: RequestContext,
        emailAddress: string,
        firstName: string,
        refreshed: boolean,
    ) {
        const user = await this.userService.getUserByEmailAddress(ctx, emailAddress);
        if (!user) {
            throw new Error('Unable to create the verification challenge');
        }
        if (user.verified) {
            throw new Error('This email address is already verified. Please sign in');
        }
        const nativeMethod = user.authenticationMethods.find(
            method => method instanceof NativeAuthenticationMethod,
        ) as NativeAuthenticationMethod | undefined;
        if (!nativeMethod?.verificationToken) {
            throw new Error('Unable to create the verification challenge');
        }

        const repository = this.connection.getRepository(ctx, EmailVerificationChallenge);
        const existing = await repository.findOne({ where: { emailAddress } });
        const code = String(randomInt(100000, 1000000));
        const now = new Date();
        const expiresAt = new Date(now.getTime() + OTP_TTL_MINUTES * 60 * 1000);
        const challenge = existing ?? new EmailVerificationChallenge({ emailAddress });
        challenge.codeHash = this.hashCode(emailAddress, code);
        challenge.verificationToken = nativeMethod.verificationToken;
        challenge.expiresAt = expiresAt;
        challenge.lastSentAt = now;
        challenge.attemptCount = 0;
        challenge.consumedAt = undefined;
        await repository.save(challenge, { reload: false });
        await this.eventBus.publish(
            new CustomerOtpRequestedEvent(ctx, emailAddress, firstName, code, expiresAt),
        );
        return {
            success: true,
            message: refreshed ? 'A new verification code has been sent' : 'Verification code sent',
            expiresAt,
            maskedEmail: this.maskEmail(emailAddress),
        };
    }

    private normalizeEmail(emailAddress: string) {
        return emailAddress.trim().toLowerCase();
    }

    private hashCode(emailAddress: string, code: string) {
        const secret = process.env.COOKIE_SECRET ?? 'local-development-secret';
        return createHash('sha256').update(`${secret}:${emailAddress}:${code}`).digest('hex');
    }

    private maskEmail(emailAddress: string) {
        const [local = '', domain = ''] = emailAddress.split('@');
        const visible = local.slice(0, Math.min(2, local.length));
        return `${visible}${'*'.repeat(Math.max(2, local.length - visible.length))}@${domain}`;
    }
}
