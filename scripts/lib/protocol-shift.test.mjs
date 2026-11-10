import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { protocolPlugin, shiftProtocol } from './protocol-shift.mjs';
import { ROOT } from './server-process.mjs';

const source = readFileSync(join(ROOT, 'packages/core/src/protocol.ts'), 'utf8');

describe('shiftProtocol', () => {
  it('changes only the protocol version', () => {
    const shifted = shiftProtocol(source, 99);
    expect(shifted).toContain('export const PROTOCOL_VERSION = 99;');
    expect(shifted.length).toBe(source.replace(/PROTOCOL_VERSION = \d+;/, 'PROTOCOL_VERSION = 99;').length);
  });

  it('refuses a source without the line, so a moved constant fails loudly', () => {
    expect(() => shiftProtocol('export const OTHER = 1;', 7)).toThrow(/PROTOCOL_VERSION/);
  });

  it('shifts protocol.ts in a build and leaves every other file alone', () => {
    const plugin = protocolPlugin(42);
    expect(plugin.transform(source, join(ROOT, 'packages/core/src/protocol.ts')).code).toContain('PROTOCOL_VERSION = 42;');
    expect(plugin.transform('const x = 1;', join(ROOT, 'packages/core/src/grid.ts'))).toBeNull();
  });
});
