import 'reflect-metadata';

import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DataSource } from 'typeorm';

async function main() {
    const database = join(tmpdir(), `marketplace-capacity-${randomUUID()}.sqlite`);
    const dataSource = new DataSource({ type: 'better-sqlite3', database });
    await dataSource.initialize();
    try {
        await dataSource.query('CREATE TABLE availability (id varchar PRIMARY KEY, capacity integer NOT NULL, bookedCount integer NOT NULL DEFAULT 0)');
        await dataSource.query('CREATE TABLE tickets (id varchar PRIMARY KEY, quantity integer NOT NULL, soldCount integer NOT NULL DEFAULT 0)');
        await dataSource.query('INSERT INTO availability (id, capacity, bookedCount) VALUES (?, ?, ?)', ['session', 7, 0]);
        await dataSource.query('INSERT INTO tickets (id, quantity, soldCount) VALUES (?, ?, ?)', ['tier', 5, 0]);

        await Promise.all(Array.from({ length: 25 }, () => dataSource.query(
            'UPDATE availability SET bookedCount = bookedCount + 1 WHERE id = ? AND bookedCount + 1 <= capacity',
            ['session'],
        )));
        await Promise.all(Array.from({ length: 25 }, () => dataSource.query(
            'UPDATE tickets SET soldCount = soldCount + 1 WHERE id = ? AND soldCount + 1 <= quantity',
            ['tier'],
        )));

        const [session] = await dataSource.query('SELECT capacity, bookedCount FROM availability WHERE id = ?', ['session']) as Array<{ capacity: number; bookedCount: number }>;
        const [ticket] = await dataSource.query('SELECT quantity, soldCount FROM tickets WHERE id = ?', ['tier']) as Array<{ quantity: number; soldCount: number }>;
        if (!session || session.bookedCount !== session.capacity) throw new Error('Concurrent session reservations exceeded or failed to fill capacity');
        if (!ticket || ticket.soldCount !== ticket.quantity) throw new Error('Concurrent ticket reservations exceeded or failed to fill allocation');

        await dataSource.query('UPDATE availability SET bookedCount = CASE WHEN bookedCount >= 2 THEN bookedCount - 2 ELSE 0 END WHERE id = ?', ['session']);
        await dataSource.query('UPDATE tickets SET soldCount = CASE WHEN soldCount >= 3 THEN soldCount - 3 ELSE 0 END WHERE id = ?', ['tier']);
        const [releasedSession] = await dataSource.query('SELECT bookedCount FROM availability WHERE id = ?', ['session']) as Array<{ bookedCount: number }>;
        const [releasedTicket] = await dataSource.query('SELECT soldCount FROM tickets WHERE id = ?', ['tier']) as Array<{ soldCount: number }>;
        if (releasedSession?.bookedCount !== 5 || releasedTicket?.soldCount !== 2) throw new Error('Cancelled booking capacity was not released correctly');

        process.stdout.write(`${JSON.stringify({
            concurrentSessionRequests: 25,
            sessionCapacity: session.capacity,
            concurrentTicketRequests: 25,
            ticketAllocation: ticket.quantity,
            releaseChecks: 2,
            result: 'PASS',
        }, null, 2)}\n`);
    } finally {
        await dataSource.destroy();
        rmSync(database, { force: true });
    }
}

void main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
});
