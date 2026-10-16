import { PayoutLedgerEntry } from './entities/payout-ledger-entry.entity';

export function summarizeVendorLedger(entries: PayoutLedgerEntry[]) {
    const activeEntries = entries.filter(entry => entry.status !== 'REVERSED');
    const sum = (kind: PayoutLedgerEntry['kind']) => activeEntries
        .filter(entry => entry.kind === kind)
        .reduce((total, entry) => total + entry.amount, 0);
    const ledgeredSales = new Set(activeEntries
        .filter(entry => entry.kind === 'SALE' && entry.orderId)
        .map(entry => String(entry.orderId))).size;
    const netEarnings = activeEntries
        .filter(entry => entry.kind !== 'PAYOUT' && entry.metadata?.accountingEffect !== 'INFORMATIONAL')
        .reduce((total, entry) => total + entry.amount, 0);

    return {
        activeEntries,
        grossSales: sum('SALE'),
        ledgeredSales,
        commission: Math.abs(sum('COMMISSION')),
        fees: Math.abs(sum('PAYMENT_FEE')),
        netEarnings,
    };
}
