import { OrderType } from '@vendure/common/lib/generated-types';
import { EntityHydrator, OrderStateTransitionEvent } from '@vendure/core';
import { EmailEventListener, shippingLinesWithMethod } from '@vendure/email-plugin';

import { RoleApplicationApprovedEvent, RoleApplicationStatusEvent } from '../plugins/marketplace/modules/applications/events/role-application.event';
import { CustomerOtpRequestedEvent } from '../plugins/marketplace/modules/identity/events/customer-otp-requested.event';
import { MarketplaceOrderStatusEvent } from '../plugins/marketplace/modules/order/events/marketplace-order-status.event';
import {
    MarketplaceSubscriptionCancellationEvent,
    MarketplaceSubscriptionRenewalEvent,
} from '../plugins/marketplace/modules/booking/events/subscription-renewal.event';
import {
    MarketplaceOrderFulfillmentType,
    marketplaceOrderUsesShipping,
    resolveMarketplaceOrderFulfillmentType,
} from '../plugins/marketplace/modules/order/order-workflow-policy';

interface OrderConfirmationContent {
    subject: string;
    label: string;
    title: string;
    message: string;
    deliveryTitle: string;
    deliveryMessage: string;
    showShipping: boolean;
    steps: Array<{ title: string; description: string }>;
}

const confirmationContent: Record<MarketplaceOrderFulfillmentType, OrderConfirmationContent> = {
    PHYSICAL: {
        subject: 'The Makers Bazar: your order is confirmed',
        label: 'Product order',
        title: 'Thanks, your order is confirmed',
        message: 'We have received your payment and sent the order to the vendor for confirmation and preparation.',
        deliveryTitle: 'Shipping and delivery',
        deliveryMessage: 'The vendor will share dispatch and tracking updates as your parcel moves through delivery.',
        showShipping: true,
        steps: [
            { title: 'Vendor confirmation', description: 'The vendor reviews and accepts your order.' },
            { title: 'Dispatch update', description: 'You receive an email when the parcel is dispatched.' },
            { title: 'Delivery', description: 'Track progress from your customer Orders page.' },
        ],
    },
    FOOD: {
        subject: 'The Makers Bazar: your food order is confirmed',
        label: 'Food order',
        title: 'Your food order is in',
        message: 'We have received your payment and sent your order to the vendor for preparation.',
        deliveryTitle: 'Delivery details',
        deliveryMessage: 'The vendor will keep you updated as the order is prepared and sent for delivery.',
        showShipping: true,
        steps: [
            { title: 'Vendor confirmation', description: 'The vendor confirms availability and timing.' },
            { title: 'Preparation', description: 'Your order is prepared for delivery.' },
            { title: 'Delivery update', description: 'You receive an email when the order is on its way.' },
        ],
    },
    DIGITAL: {
        subject: 'The Makers Bazar: your digital order is confirmed',
        label: 'Digital purchase',
        title: 'Your digital order is confirmed',
        message: 'We have received your payment. This is an online delivery, so no shipping is required.',
        deliveryTitle: 'Secure online delivery',
        deliveryMessage: 'When the vendor marks your digital item as delivered, we will email you and the secure download will appear in your customer Orders page.',
        showShipping: false,
        steps: [
            { title: 'Payment received', description: 'Your purchase has been recorded securely.' },
            { title: 'Access prepared', description: 'The vendor prepares your ebook or digital file.' },
            { title: 'Download available', description: 'Open My Orders to request your secure download link.' },
        ],
    },
    SERVICE: {
        subject: 'The Makers Bazar: your service order is confirmed',
        label: 'Service order',
        title: 'Your service request is confirmed',
        message: 'We have received your payment and sent the service details to the provider.',
        deliveryTitle: 'Service fulfilment',
        deliveryMessage: 'The provider will confirm the next steps and share service updates through your order.',
        showShipping: false,
        steps: [
            { title: 'Provider confirmation', description: 'The provider reviews your requirements.' },
            { title: 'Service coordination', description: 'Timing and fulfilment details are confirmed.' },
            { title: 'Completion', description: 'Follow the service status from My Orders.' },
        ],
    },
    WORKSHOP: {
        subject: 'The Makers Bazar: your workshop booking is confirmed',
        label: 'Workshop booking',
        title: 'Your workshop booking is received',
        message: 'We have received your payment and sent the booking to the workshop organizer.',
        deliveryTitle: 'Session access',
        deliveryMessage: 'The organizer will confirm the session details and provide any attendance instructions.',
        showShipping: false,
        steps: [
            { title: 'Booking review', description: 'The organizer confirms your place.' },
            { title: 'Session details', description: 'You receive schedule and access information.' },
            { title: 'Attend', description: 'Keep your order reference available for the session.' },
        ],
    },
    EVENT: {
        subject: 'The Makers Bazar: your event booking is confirmed',
        label: 'Event booking',
        title: 'Your event booking is received',
        message: 'We have received your payment and sent the booking to the event organizer.',
        deliveryTitle: 'Event access',
        deliveryMessage: 'The organizer will confirm your booking and share ticket or attendance information.',
        showShipping: false,
        steps: [
            { title: 'Booking review', description: 'The organizer confirms your booking.' },
            { title: 'Access details', description: 'Ticket or attendance instructions are provided.' },
            { title: 'Attend', description: 'Use your order reference if you need support.' },
        ],
    },
    MIXED: {
        subject: 'The Makers Bazar: your order is confirmed',
        label: 'Mixed order',
        title: 'Thanks, your order is confirmed',
        message: 'Your order contains items with different delivery methods. Each vendor will update its part separately.',
        deliveryTitle: 'Shipping and online delivery',
        deliveryMessage: 'Physical items use the shipping details below. Digital items become available securely from your customer Orders page.',
        showShipping: true,
        steps: [
            { title: 'Vendor confirmation', description: 'Each vendor confirms its part of the order.' },
            { title: 'Separate updates', description: 'You receive fulfilment updates for each vendor.' },
            { title: 'Track and download', description: 'Use My Orders for parcel tracking and digital access.' },
        ],
    },
};

export const marketplaceOrderConfirmationHandler = new EmailEventListener('order-confirmation')
    .on(OrderStateTransitionEvent)
    .filter(event =>
        event.toState === 'PaymentSettled'
        && event.fromState !== 'Modifying'
        && event.order.type !== OrderType.Seller
        && !!event.order.customer,
    )
    .loadData(async ({ event, injector }) => {
        const entityHydrator = injector.get(EntityHydrator);
        await entityHydrator.hydrate(event.ctx, event.order, {
            relations: ['lines.productVariant.product', 'shippingLines.shippingMethod'],
        });
        const fulfillmentType = resolveMarketplaceOrderFulfillmentType(event.order.lines.map(line =>
            (line.productVariant.product?.customFields as Record<string, unknown> | undefined)?.marketplaceType,
        ));
        const content = confirmationContent[fulfillmentType];
        return {
            confirmation: content,
            fulfillmentType,
            shippingLines: marketplaceOrderUsesShipping(fulfillmentType)
                ? shippingLinesWithMethod(event.order)
                : [],
        };
    })
    .setRecipient(event => event.order.customer!.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('{{ confirmation.subject }} - #{{ order.code }}')
    .setTemplateVars(event => ({
        order: event.order,
        confirmation: event.data.confirmation,
        fulfillmentType: event.data.fulfillmentType,
        shippingLines: event.data.shippingLines,
    }));

export const customerOtpHandler = new EmailEventListener('customer-verification-otp')
    .on(CustomerOtpRequestedEvent)
    .setRecipient(event => event.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Your Makers Bazar verification code')
    .setTemplateVars(event => ({
        firstName: event.firstName,
        code: event.code,
        expiresAt: event.expiresAt,
    }));

export const roleApplicationStatusHandler = new EmailEventListener('role-application-status')
    .on(RoleApplicationStatusEvent)
    .setRecipient(event => event.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('The Makers Bazar application {{ reference }}: {{ status }}')
    .setTemplateVars(event => ({
        firstName: event.firstName,
        displayName: event.displayName,
        reference: event.reference,
        role: event.role,
        status: event.status,
        reviewNote: event.reviewNote,
    }));

export const roleApplicationApprovedHandler = new EmailEventListener('role-application-approved')
    .on(RoleApplicationApprovedEvent)
    .setRecipient(event => event.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Your Makers Bazar {{ role }} application is approved')
    .setTemplateVars(event => ({
        firstName: event.firstName,
        displayName: event.displayName,
        reference: event.reference,
        role: event.role,
        emailAddress: event.emailAddress,
        temporaryPassword: event.temporaryPassword,
    }));

export const marketplaceOrderStatusHandler = new EmailEventListener('marketplace-order-status')
    .on(MarketplaceOrderStatusEvent)
    .setRecipient(event => event.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Order {{ orderCode }}: {{ statusLabel }}')
    .setTemplateVars(event => ({
        customerFirstName: event.customerFirstName,
        orderCode: event.orderCode,
        sellerOrderCode: event.sellerOrderCode,
        vendorName: event.vendorName,
        status: event.status,
        statusLabel: event.statusLabel,
        statusMessage: event.statusMessage,
        trackingCode: event.trackingCode,
        statusNote: event.statusNote,
        products: event.products,
        downloadReady: event.downloadReady,
    }));

export const marketplaceSubscriptionRenewalHandler = new EmailEventListener('marketplace-subscription-renewal')
    .on(MarketplaceSubscriptionRenewalEvent)
    .setRecipient(event => event.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Renew your {{ productName }} class pass')
    .setTemplateVars(event => ({
        productName: event.productName,
        className: event.className,
        accessEndsAt: event.accessEndsAt,
        graceEndsAt: event.graceEndsAt,
        renewalToken: event.renewalToken,
    }));

export const marketplaceSubscriptionCancellationHandler = new EmailEventListener('marketplace-subscription-cancellation')
    .on(MarketplaceSubscriptionCancellationEvent)
    .setRecipient(event => event.emailAddress)
    .setFrom('{{ fromAddress }}')
    .setSubject('Cancellation request for {{ productName }}')
    .setTemplateVars(event => ({
        vendorName: event.vendorName,
        customerName: event.customerName,
        productName: event.productName,
        className: event.className,
        reason: event.reason,
    }));

export const marketplaceEmailHandlers = [
    marketplaceOrderConfirmationHandler,
    customerOtpHandler,
    roleApplicationStatusHandler,
    roleApplicationApprovedHandler,
    marketplaceOrderStatusHandler,
    marketplaceSubscriptionRenewalHandler,
    marketplaceSubscriptionCancellationHandler,
];
