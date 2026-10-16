import { RequestContext, TransactionalConnection } from '@vendure/core';
import { MarketplaceAvailabilitySession } from '../catalog/entities/marketplace-availability-session.entity';
import { MarketplaceEventTicketType } from '../catalog/entities/marketplace-event-ticket-type.entity';
import { MarketplaceBooking } from './entities/booking.entity';

/** Call within the same transaction that changes an active booking to a released status. */
export async function releaseBookingCapacity(connection: TransactionalConnection, ctx: RequestContext, booking: MarketplaceBooking) {
    if (booking.availabilitySessionId) {
        const repository = connection.getRepository(ctx, MarketplaceAvailabilitySession);
        const column = repository.manager.connection.driver.escape('bookedCount');
        await repository.createQueryBuilder().update()
            .set({ bookedCount: () => `CASE WHEN ${column} >= :quantity THEN ${column} - :quantity ELSE 0 END` })
            .where('id = :id', { id: booking.availabilitySessionId }).setParameter('quantity', booking.quantity).execute();
    }
    if (booking.eventTicketTypeId) {
        const repository = connection.getRepository(ctx, MarketplaceEventTicketType);
        const column = repository.manager.connection.driver.escape('soldCount');
        await repository.createQueryBuilder().update()
            .set({ soldCount: () => `CASE WHEN ${column} >= :quantity THEN ${column} - :quantity ELSE 0 END` })
            .where('id = :id', { id: booking.eventTicketTypeId }).setParameter('quantity', booking.quantity).execute();
    }
}
