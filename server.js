'use strict';

// cPanel/CloudLinux Node.js Selector starts this file from the application root.
// Load the API environment explicitly because cPanel starts from this directory.
require('dotenv').config({ path: require('node:path').join(__dirname, 'apps/api/.env') });

const { spawn } = require('node:child_process');
const path = require('node:path');

const worker = spawn(process.execPath, [path.join(__dirname, 'apps/api/dist/worker.js')], {
    env: { ...process.env, NODE_OPTIONS: '' },
    stdio: 'inherit',
});

const stopWorker = signal => {
    if (!worker.killed) worker.kill(signal);
};

process.once('SIGINT', () => stopWorker('SIGINT'));
process.once('SIGTERM', () => stopWorker('SIGTERM'));
worker.once('exit', (code, signal) => {
    if (code && !signal) {
        console.error(`Background worker stopped unexpectedly with code ${code}`);
    }
});

require('./apps/api/dist/index.js');
