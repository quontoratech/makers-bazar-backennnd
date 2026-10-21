import { spawn } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import type { Readable } from 'node:stream';

async function pathExists(filePath: string) {
    return fs.access(filePath).then(() => true, () => false);
}

async function prepareDirectory(directory: string | undefined) {
    if (directory) await fs.mkdir(path.resolve(directory), { recursive: true });
}

async function prepareSqliteDatabase() {
    if (process.env.DB === 'postgres' || !process.env.DB_PATH) return;

    const databasePath = path.resolve(process.env.DB_PATH);
    await fs.mkdir(path.dirname(databasePath), { recursive: true });
    const seedPath = process.env.DB_SEED_PATH && path.resolve(process.env.DB_SEED_PATH);
    if (await pathExists(databasePath)) {
        if (seedPath) await fs.rm(seedPath, { force: true });
        return;
    }

    if (!seedPath || !(await pathExists(seedPath))) return;

    const temporaryPath = `${databasePath}.import-${process.pid}`;
    if (seedPath.endsWith('.enc')) {
        const key = Buffer.from(process.env.DB_SEED_KEY ?? '', 'base64');
        if (key.length !== 32) throw new Error('DB_SEED_KEY must contain a base64-encoded 32-byte key');

        const encrypted = await fs.readFile(seedPath);
        if (encrypted.length < 29) throw new Error('Encrypted database seed is invalid');
        const nonce = encrypted.subarray(0, 12);
        const authTag = encrypted.subarray(12, 28);
        const decipher = createDecipheriv('aes-256-gcm', key, nonce);
        decipher.setAuthTag(authTag);
        await fs.writeFile(temporaryPath, Buffer.concat([
            decipher.update(encrypted.subarray(28)),
            decipher.final(),
        ]), { mode: 0o600 });
    } else {
        await fs.copyFile(seedPath, temporaryPath);
        await fs.chmod(temporaryPath, 0o600);
    }
    await fs.rename(temporaryPath, databasePath);
    await fs.rm(seedPath, { force: true });
}

async function prepareAssetLibrary() {
    if (!process.env.ASSET_UPLOAD_DIR) return;
    const target = path.resolve(process.env.ASSET_UPLOAD_DIR);
    await fs.mkdir(target, { recursive: true });

    const seed = process.env.ASSET_SEED_DIR && path.resolve(process.env.ASSET_SEED_DIR);
    if (!seed || !(await pathExists(seed))) return;
    const marker = path.join(target, '.seed-complete-v1');
    if (!(await pathExists(marker))) {
        await fs.cp(seed, target, { recursive: true, force: true });
        await fs.writeFile(marker, new Date().toISOString(), { mode: 0o600 });
    }
    await fs.rm(seed, { recursive: true, force: true });
}

async function prepareRuntimeData() {
    await Promise.all([
        prepareDirectory(process.env.ASSET_UPLOAD_DIR),
        prepareDirectory(process.env.CHAT_ATTACHMENT_DIR),
        prepareDirectory(process.env.PRIVATE_DIGITAL_ASSET_DIR),
        prepareDirectory(process.env.VENDOR_ONBOARDING_DIR),
    ]);
    await prepareSqliteDatabase();
    await prepareAssetLibrary();
}

function writeRuntimeLog(level: 'INFO' | 'WARN' | 'ERROR', message: string) {
    process.stdout.write(`${JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        message,
    })}\n`);
}

function forwardChildOutput(stream: Readable | null, label: string, level: 'INFO' | 'ERROR') {
    if (!stream) return;
    let buffered = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        buffered += chunk;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            if (line.trim()) writeRuntimeLog(level, `[${label}] ${line}`);
        }
    });
    stream.once('end', () => {
        if (buffered.trim()) writeRuntimeLog(level, `[${label}] ${buffered}`);
    });
}

async function startProduction() {
    const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
    const sendStarting = (response: ServerResponse) => {
        if (response.headersSent) return response.end();
        response.writeHead(503, {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': '5',
        });
        response.end(JSON.stringify({ status: 'starting' }));
    };
    const warmupHandler = (_request: IncomingMessage, response: ServerResponse) => sendStarting(response);
    const publicServer = createServer(warmupHandler);
    await new Promise<void>((resolve, reject) => {
        publicServer.once('error', reject);
        publicServer.listen(port, resolve);
    });

    await prepareRuntimeData();
    await import('reflect-metadata');
    const { bootstrap } = await import('@vendure/core');
    const { config } = await import('./config/vendure-config.js');
    await bootstrap(config, {
        onBeforeAppListen: async app => {
            const adapter = app.getHttpAdapter() as unknown as {
                getInstance: () => typeof warmupHandler;
                listen: (port: number, ...args: unknown[]) => typeof publicServer;
                setHttpServer: (server: typeof publicServer) => void;
            };
            const applicationHandler = adapter.getInstance();
            adapter.setHttpServer(publicServer);
            (app as unknown as { httpServer: typeof publicServer }).httpServer = publicServer;
            publicServer.removeListener('request', warmupHandler);
            publicServer.on('request', applicationHandler);
            const { IoAdapter } = await import('@nestjs/platform-socket.io');
            app.useWebSocketAdapter(new IoAdapter(publicServer));
            adapter.listen = (_port: number, ...args: unknown[]) => {
                const callback = [...args].reverse().find((argument: unknown) => typeof argument === 'function') as (() => void) | undefined;
                callback?.();
                return publicServer;
            };
        },
    });

    const worker = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
        env: { ...process.env, NODE_OPTIONS: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    forwardChildOutput(worker.stdout, 'WORKER', 'INFO');
    forwardChildOutput(worker.stderr, 'WORKER', 'ERROR');
    let shuttingDown = false;
    const stopWorker = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        if (!worker.killed) worker.kill(signal);
    };
    process.once('SIGINT', () => stopWorker('SIGINT'));
    process.once('SIGTERM', () => stopWorker('SIGTERM'));
    worker.once('exit', (code, signal) => {
        if (shuttingDown) return;
        writeRuntimeLog('ERROR', `Background worker stopped unexpectedly (${signal ?? code ?? 'unknown'})`);
        process.exit(1);
    });
    writeRuntimeLog('INFO', `Vendure API is attached to the existing public listener on ${port}`);
}

startProduction().catch(error => {
    writeRuntimeLog('ERROR', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
