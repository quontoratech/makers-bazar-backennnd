import { MarketplacePayoutSchedule } from './entities/marketplace-payout-settings.entity';

/** Batch preparation periods use UTC; this never authorizes or initiates a bank transfer. */
export function payoutSchedulePeriod(schedule: MarketplacePayoutSchedule, now = new Date()): string | undefined {
    if (schedule === 'MANUAL') return undefined;
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (schedule === 'MONTHLY') start.setUTCDate(1);
    if (schedule === 'WEEKLY' || schedule === 'BIWEEKLY') {
        const days = schedule === 'BIWEEKLY' ? 14 : 7;
        const anchor = Date.UTC(1970, 0, 5); // Monday
        start.setTime(anchor + Math.floor((start.getTime() - anchor) / (days * 86400000)) * days * 86400000);
    }
    return `${schedule}-${start.toISOString().slice(0, 10)}`;
}
