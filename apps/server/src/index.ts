import { join } from 'node:path';
import { PROTOCOL_VERSION } from '@nebotok/core';
import { createGameServer } from './app.ts';
import { readConfig } from './config.ts';
import { SERVER_VERSION } from './http.ts';
import { createLog } from './log.ts';
import { createServices } from './services.ts';
import { SNAPSHOT_DIR, startSnapshots } from './snapshots.ts';

const config = readConfig(process.env);
const log = createLog(config.logLevel);
let services;
try {
  services = createServices(config, Date.now, log);
} catch (error) {
  log.error('could not open the world', { error });
  process.exit(1);
}
const server = createGameServer(config, log, services);
const snapshots = startSnapshots({ db: services.db, dir: join(config.dataDir, SNAPSHOT_DIR), log });

// Colyseus itself catches SIGTERM and SIGINT, closes every room, then exits.
server.onBeforeShutdown(() => log.info('shutting down'));
server.onShutdown(() => {
  // Rooms have saved every player by now; closing checkpoints the write-ahead log into the file.
  snapshots.stop();
  services.close();
  log.info('shutdown complete');
});

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
