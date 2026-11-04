import { PROTOCOL_VERSION } from '@nebotok/core';
import { createGameServer } from './app.ts';
import { readConfig } from './config.ts';
import { SERVER_VERSION } from './http.ts';
import { createLog } from './log.ts';

const config = readConfig(process.env);
const log = createLog(config.logLevel);
const server = createGameServer(config, log);

// Colyseus itself catches SIGTERM and SIGINT, closes every room, then exits.
server.onBeforeShutdown(() => log.info('shutting down'));
server.onShutdown(() => log.info('shutdown complete'));

try {
  await server.listen(config.port, config.host);
} catch (error) {
  log.error('could not start', { error });
  process.exit(1);
}
log.info('listening', {
  host: config.host,
  port: config.port,
  production: config.production,
  protocol: PROTOCOL_VERSION,
  version: SERVER_VERSION,
});
