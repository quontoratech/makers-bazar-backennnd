import { ScheduledTask } from '@vendure/core';

import { MarketplaceCartReservationService } from '../services/marketplace-cart-reservation.service';

export const releaseExpiredCartReservationsTask = new ScheduledTask({
    id: 'release-expired-marketplace-cart-reservations',
    description: 'Releases marketplace cart stock reservations after 30 minutes',
    schedule: '*/1 * * * *',
    async execute({ injector, scheduledContext }) {
        const reservationService = injector.get(MarketplaceCartReservationService);
        const released = await reservationService.releaseExpired(scheduledContext);
        return { released };
    },
});
