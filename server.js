'use strict';

// cPanel/CloudLinux Node.js Selector starts this file from the application root.
// The compiled production entrypoint attaches Vendure and Socket.IO to the
// PORT supplied by the hosting platform and starts the background worker.
require('./apps/api/dist/production.js');
