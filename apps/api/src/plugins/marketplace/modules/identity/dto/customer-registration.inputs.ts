export interface RegisterMarketplaceCustomerInput {
    firstName: string;
    lastName: string;
    emailAddress: string;
    phoneNumber?: string;
    password: string;
    termsAccepted: boolean;
    privacyAccepted: boolean;
    marketingConsent?: boolean;
}

export interface VerifyMarketplaceCustomerOtpInput {
    emailAddress: string;
    code: string;
}
