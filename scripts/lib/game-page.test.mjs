import { describe, expect, it } from 'vitest';
import { testBase } from './game-page.mjs';

describe('testBase', () => {
  it('takes a game on this computer, as its origin', () => {
    expect(testBase('http://127.0.0.1:5173/?test=1', {})).toBe('http://127.0.0.1:5173');
    expect(testBase('http://localhost:41000', {})).toBe('http://localhost:41000');
  });

  it('refuses anywhere but 127.0.0.1 and localhost', () => {
    for (const url of ['https://mini.example.ts.net:8445', 'http://192.168.1.20:5173', 'http://127.0.0.2:5173', 'http://[::1]:5173', 'http://127.0.0.1.example.com:5173', 'http://0.0.0.0:5173']) {
      expect(() => testBase(url, {})).toThrow(/not on this computer/);
    }
  });

  it('refuses the live game\'s port, 8567 or NEBOTOK_PORT', () => {
    expect(() => testBase('http://127.0.0.1:8567', {})).toThrow(/live game/);
    expect(() => testBase('http://localhost:8567/', {})).toThrow(/live game/);
    expect(() => testBase('http://127.0.0.1:9100', { NEBOTOK_PORT: '9100' })).toThrow(/live game/);
    expect(() => testBase('http://localhost', { NEBOTOK_PORT: '80' })).toThrow(/live game/);
    expect(testBase('http://127.0.0.1:9100', { NEBOTOK_PORT: '9200' })).toBe('http://127.0.0.1:9100');
  });
});
