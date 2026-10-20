import { spawn } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';

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

async function startProduction() {
    const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3000);
    const warmupServer = createServer((_request, response) => {
        response.writeHead(503, {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': '5',
        });
        response.end(JSON.stringify({ status: 'starting' }));
    });
    await new Promise<void>((resolve, reject) => {
        warmupServer.once('error', reject);
        warmupServer.listen(port, resolve);
    });

    await prepareRuntimeData();
    await import('reflect-metadata');
    const { bootstrap, Logger } = await import('@vendure/core');
    const { config } = await import('./config/vendure-config.js');
    await new Promise<void>((resolve, reject) => {
        warmupServer.close(error => error ? reject(error) : resolve());
    });
    await bootstrap(config);

    const worker = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
        env: process.env,
        stdio: 'inherit',
    });
    let shuttingDown = false;
    const stopWorker = (signal: NodeJS.Signals) => {
        shuttingDown = true;
        if (!worker.killed) worker.kill(signal);
    };
    process.once('SIGINT', () => stopWorker('SIGINT'));
    process.once('SIGTERM', () => stopWorker('SIGTERM'));
    worker.once('exit', (code, signal) => {
        if (shuttingDown) return;
        Logger.error(`Background worker stopped unexpectedly (${signal ?? code ?? 'unknown'})`, 'ProductionBootstrap');
        process.exit(1);
    });
    Logger.info('API and supervised background worker are running', 'ProductionBootstrap');
}

startProduction().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
