import { Order, OrderService, ScheduledTask, TransactionalConnection, isGraphQlErrorResult } from '@vendure/core';
import { LessThan } from 'typeorm';

export const releaseStaleCheckoutReservationsTask = new ScheduledTask({
    id: 'release-stale-marketplace-checkout-reservations',
    description: 'Releases stock held by marketplace checkouts which did not complete payment',
    schedule: '*/1 * * * *',
    async execute({ injector, scheduledContext }) {
        const connection = injector.get(TransactionalConnection);
        const orderService = injector.get(OrderService);
        const configuredMinutes = Number(process.env.CHECKOUT_RESERVATION_TIMEOUT_MINUTES ?? 30);
        const timeoutMinutes = Number.isFinite(configuredMinutes) && configuredMinutes >= 1
            ? Math.floor(configuredMinutes)
            : 30;
        const cutoff = new Date(Date.now() - timeoutMinutes * 60_000);
        const staleOrders = await connection.getRepository(scheduledContext, Order).find({
            where: {
                active: true,
                state: 'ArrangingPayment',
                updatedAt: LessThan(cutoff),
            },
            take: 100,
        });

        let released = 0;
        for (const order of staleOrders) {
            const result = await orderService.transitionToState(scheduledContext, order.id, 'Cancelled');
            if (result && !isGraphQlErrorResult(result)) released += 1;
        }
        return { released, timeoutMinutes };
    },
});
