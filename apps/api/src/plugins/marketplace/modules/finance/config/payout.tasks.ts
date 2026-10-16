import { ScheduledTask } from '@vendure/core';

import { FinanceService } from '../services/finance.service';

export const prepareMarketplacePayoutsTask = new ScheduledTask({
    id: 'prepare-marketplace-payout-batches',
    description: 'Releases matured earnings and prepares payout batches for manual approval and transfer',
    schedule: '*/15 * * * *',
    async execute({ injector, scheduledContext }) {
        return injector.get(FinanceService).prepareScheduledPayouts(scheduledContext);
    },
});
