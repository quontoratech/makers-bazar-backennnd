import 'reflect-metadata';
import { bootstrap, Logger } from '@vendure/core';

import { config } from './config/vendure-config';

bootstrap(config).catch(error => {
    Logger.error(error instanceof Error ? error.message : String(error), 'Bootstrap');
    process.exitCode = 1;
});
