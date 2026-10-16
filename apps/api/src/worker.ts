import 'reflect-metadata';
import { bootstrapWorker, Logger } from '@vendure/core';

import { config } from './config/vendure-config';

bootstrapWorker(config)
    .then(worker => worker.startJobQueue())
    .catch(error => {
        Logger.error(error instanceof Error ? error.message : String(error), 'WorkerBootstrap');
        process.exitCode = 1;
    });
