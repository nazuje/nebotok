// Test only: a server or a build that speaks another protocol than this checkout, as the next
// release would, without any switch in the game's own code. scripts/update-check.mjs uses it to
// serve a build B with a bumped protocol after build A.
export const PROTOCOL_FILE = '/packages/core/src/protocol.ts';
const PROTOCOL_LINE = /export const PROTOCOL_VERSION = \d+;/;

/** protocol.ts's source with PROTOCOL_VERSION set to `version`. Throws when the line has moved. */
export function shiftProtocol(source, version) {
  if (!Number.isInteger(version)) throw new Error(`shiftProtocol needs a whole number, got ${version}`);
  if (!PROTOCOL_LINE.test(source)) throw new Error(`${PROTOCOL_FILE} no longer declares "export const PROTOCOL_VERSION = <n>;"`);
  return source.replace(PROTOCOL_LINE, `export const PROTOCOL_VERSION = ${version};`);
}

/** A Vite plugin that builds the game speaking protocol `version`. */
export function protocolPlugin(version) {
  return {
    name: 'nebotok-test-protocol',
    enforce: 'pre',
    transform(code, id) {
      return id.split('?')[0].endsWith(PROTOCOL_FILE) ? { code: shiftProtocol(code, version), map: null } : null;
    },
  };
}
