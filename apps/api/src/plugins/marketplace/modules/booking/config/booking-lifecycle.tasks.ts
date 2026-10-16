import { ScheduledTask, TransactionalConnection } from '@vendure/core';

import { BookingService } from '../services/booking.service';

export const releaseExpiredPendingBookingsTask = new ScheduledTask({
    id: 'release-expired-pending-marketplace-bookings',
    description: 'Cancels unpaid workshop reservations after 30 minutes',
    schedule: '*/5 * * * *',
    async execute({ injector, scheduledContext }) {
        const bookingService = injector.get(BookingService);
        return injector.get(TransactionalConnection).withTransaction(scheduledContext, async ctx => ({ released: await bookingService.releaseExpiredPending(ctx) }));
    },
});

export const sendSubscriptionRenewalEmailsTask = new ScheduledTask({
    id: 'send-marketplace-subscription-renewal-emails',
    description: 'Sends class renewal quotations in chat and email, and releases enrollments after grace expires',
    schedule: '*/5 * * * *',
    async execute({ injector, scheduledContext }) {
        const bookingService = injector.get(BookingService);
        return injector.get(TransactionalConnection).withTransaction(scheduledContext, async ctx => ({ sent: await bookingService.processSubscriptionRenewals(ctx) }));
    },
});
