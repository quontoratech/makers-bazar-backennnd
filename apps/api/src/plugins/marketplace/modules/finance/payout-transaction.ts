import { RequestContext, TransactionalConnection } from '@vendure/core';

import { MarketplacePayoutSettings } from './entities/marketplace-payout-settings.entity';

/** Serialize balance reservations and reversals across API/worker instances, not just one process. */
export function withPayoutTransaction<T>(
    connection: TransactionalConnection,
    ctx: RequestContext,
    work: (transactionCtx: RequestContext) => Promise<T>,
): Promise<T> {
    return connection.withTransaction(ctx, async transactionCtx => {
        // A no-op write obtains a transaction-scoped row lock on PostgreSQL and a write lock on SQLite.
        // Settings are initialized at application bootstrap before orders or scheduled batches run.
        const repository = connection.getRepository(transactionCtx, MarketplacePayoutSettings);
        const column = repository.metadata.findColumnWithPropertyName('holdingPeriodDays')!;
        const escaped = repository.manager.connection.driver.escape(column.databaseName);
        await repository.createQueryBuilder().update().set({ holdingPeriodDays: () => escaped }).execute();
        return work(transactionCtx);
    });
}
