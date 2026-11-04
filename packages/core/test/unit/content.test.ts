import { describe, expect, it } from 'vitest';
import strings from '../../../../content/strings.json' with { type: 'json' };
import { REQUIRED_STRING_IDS, WELCOME_MESSAGE_KEYS, checkContentFile, parseStrings } from '../../src/index.ts';

describe('content schemas', () => {
  it('accepts the real strings file', () => {
    expect(checkContentFile('strings.json', strings)).toEqual({ ok: true });
  });

  it('has a line for every welcome the server can send', () => {
    const parsed = parseStrings(strings);
    for (const key of WELCOME_MESSAGE_KEYS) expect(parsed[key]).toBeDefined();
  });

  it('writes Slovenian with its own letters', () => {
    const slovenian = Object.values(parseStrings(strings)).map(({ sl }) => sl).join(' ');
    expect(slovenian).toMatch(/č/);
    expect(slovenian).toMatch(/š/);
    expect(slovenian).toMatch(/ž/);
  });

  it('reports a missing language', () => {
    const broken = { ...strings, 'game.title': { en: 'Nebotok' } };
    const result = checkContentFile('strings.json', broken);
    expect(result.ok).toBe(false);
  });

  it('reports a missing required id', () => {
    const { 'connection.connected': _dropped, ...rest } = strings;
    const result = checkContentFile('strings.json', rest);
    expect(result).toEqual({ ok: false, problems: ['connection.connected: missing string "connection.connected"'] });
  });

  it('reports a file it has no schema for', () => {
    expect(checkContentFile('monsters.json', {}).ok).toBe(false);
  });

  it('requires ids in area.name form', () => {
    expect(checkContentFile('strings.json', { ...strings, Title: { en: 'x', sl: 'y' } }).ok).toBe(false);
    expect(REQUIRED_STRING_IDS.length).toBeGreaterThan(0);
  });
});
