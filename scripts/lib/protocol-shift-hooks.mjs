// Test only: `node --import <this file>` with NEBOTOK_TEST_PROTOCOL=<n> runs the server speaking
// protocol n. See protocol-shift.mjs.
import { registerHooks } from 'node:module';
import { PROTOCOL_FILE, shiftProtocol } from './protocol-shift.mjs';

const version = Number(process.env.NEBOTOK_TEST_PROTOCOL);
if (!Number.isInteger(version)) throw new Error(`NEBOTOK_TEST_PROTOCOL must be a whole number, got "${process.env.NEBOTOK_TEST_PROTOCOL}"`);

registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.endsWith(PROTOCOL_FILE)) return loaded;
    return { ...loaded, source: shiftProtocol(String(loaded.source), version) };
  },
});
