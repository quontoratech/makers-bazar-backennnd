import { spawn } from 'node:child_process';
import { createDecipheriv } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer, request as createProxyRequest, type ServerResponse } from 'node:http';
import { connect as connectSocket } from 'node:net';
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
    const internalPort = Number(process.env.INTERNAL_API_PORT ?? port + 1);
    let lastProxyErrorAt = 0;
    const sendStarting = (response: ServerResponse) => {
        if (response.headersSent) return response.end();
        response.writeHead(503, {
            'content-type': 'application/json; charset=utf-8',
            'retry-after': '5',
        });
        response.end(JSON.stringify({ status: 'starting' }));
    };
    const publicServer = createServer((request, response) => {
        const proxyRequest = createProxyRequest({
            host: '127.0.0.1',
            port: internalPort,
            path: request.url,
            method: request.method,
            headers: request.headers,
        }, proxyResponse => {
            response.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.statusMessage, proxyResponse.headers);
            proxyResponse.pipe(response);
        });
        proxyRequest.once('error', (error: NodeJS.ErrnoException) => {
            const now = Date.now();
            if (now - lastProxyErrorAt >= 30_000) {
                lastProxyErrorAt = now;
                writeRuntimeLog('WARN', `Internal API proxy connection failed (${error.code ?? 'unknown'})`);
            }
            sendStarting(response);
        });
        request.once('aborted', () => proxyRequest.destroy());
        request.pipe(proxyRequest);
    });
    publicServer.on('upgrade', (request, socket, head) => {
        const upstream = connectSocket(internalPort, '127.0.0.1');
        upstream.once('connect', () => {
            upstream.write(`${request.method ?? 'GET'} ${request.url ?? '/'} HTTP/${request.httpVersion}\r\n`);
            for (let index = 0; index < request.rawHeaders.length; index += 2) {
                upstream.write(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}\r\n`);
            }
            upstream.write('\r\n');
            if (head.length) upstream.write(head);
            socket.pipe(upstream).pipe(socket);
        });
        upstream.once('error', () => socket.destroy());
        socket.once('error', () => upstream.destroy());
    });
    await new Promise<void>((resolve, reject) => {
        publicServer.once('error', reject);
        publicServer.listen(port, resolve);
    });

    await prepareRuntimeData();
    const childEnvironment = {
        ...process.env,
        PORT: String(internalPort),
        API_PORT: String(internalPort),
        API_HOSTNAME: '127.0.0.1',
        NODE_OPTIONS: '',
    };
    const api = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
        env: childEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const worker = spawn(process.execPath, [path.join(__dirname, 'worker.js')], {
        env: childEnvironment,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    forwardChildOutput(api.stdout, 'API', 'INFO');
    forwardChildOutput(api.stderr, 'API', 'ERROR');
    forwardChildOutput(worker.stdout, 'WORKER', 'INFO');
    forwardChildOutput(worker.stderr, 'WORKER', 'ERROR');
    let shuttingDown = false;
    const stopChildren = (signal: NodeJS.Signals) => {
        if (shuttingDown) return;
        shuttingDown = true;
        publicServer.close();
        if (!api.killed) api.kill(signal);
        if (!worker.killed) worker.kill(signal);
    };
    process.once('SIGINT', () => stopChildren('SIGINT'));
    process.once('SIGTERM', () => stopChildren('SIGTERM'));
    const handleUnexpectedExit = (name: string, code: number | null, signal: NodeJS.Signals | null) => {
        if (shuttingDown) return;
        writeRuntimeLog('ERROR', `${name} stopped unexpectedly (${signal ?? code ?? 'unknown'})`);
        process.exit(1);
    };
    api.once('exit', (code, signal) => handleUnexpectedExit('API', code, signal));
    worker.once('exit', (code, signal) => handleUnexpectedExit('Background worker', code, signal));
    writeRuntimeLog('INFO', `Public proxy is listening on ${port}; API and worker use internal port ${internalPort}`);
}

startProduction().catch(error => {
    writeRuntimeLog('ERROR', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
});
