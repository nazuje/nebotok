import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseScene } from './scene-file.mjs';
import { ROOT } from './server-process.mjs';

const SCENES = join(ROOT, 'scripts', 'scenes');
const base = {
  name: 'two',
  about: 'Two players.',
  players: [
    { id: 'lan', name: 'Scena Lan' },
    { id: 'zarja', name: 'Scena Zarja', browser: 'webkit', device: 'ipad-landscape', language: 'sl' },
  ],
  steps: [{ do: 'join', player: 'lan' }],
};
const read = (scene) => parseScene(JSON.stringify(scene));

describe('parseScene', () => {
  it.each(readdirSync(SCENES).filter((file) => file.endsWith('.json')))('reads the example scene %s', (file) => {
    const result = parseScene(readFileSync(join(SCENES, file), 'utf8'));
    expect(result.problems).toBeUndefined();
    expect(result.scene.name).toBe(file.replace(/\.json$/, ''));
  });

  it('fills in the defaults for a player', () => {
    const { scene } = read(base);
    expect(scene.players[0]).toEqual({ id: 'lan', name: 'Scena Lan', avatar: 'blue', browser: 'chromium', device: 'iphone-portrait', language: 'en' });
    expect(scene.players[1]).toMatchObject({ browser: 'webkit', device: 'ipad-landscape', language: 'sl' });
  });

  it('refuses a step for a player who is not in the scene', () => {
    const scene = { ...base, steps: [...base.steps, { do: 'waitFor', player: 'lan', until: { sees: ['mira'] } }] };
    expect(read(scene).problems).toContain('no player "mira"');
    const standing = { ...base, steps: [...base.steps, { do: 'waitFor', player: 'lan', until: { seesAt: { mira: { x: 1, y: 1 } } } }] };
    expect(read(standing).problems).toContain('no player "mira"');
  });

  it('refuses a step before the player has joined', () => {
    expect(read({ ...base, steps: [{ do: 'walk', player: 'zarja', to: { x: 19, y: 10 } }] }).problems).toContain('"zarja" has not joined yet');
  });

  it('refuses joining twice', () => {
    expect(read({ ...base, steps: [...base.steps, { do: 'join', player: 'lan' }] }).problems).toContain('"lan" has already joined');
  });

  it('refuses two players with one name', () => {
    const players = [base.players[0], { ...base.players[1], name: 'Scena Lan' }];
    expect(read({ ...base, players }).problems).toContain('two players share a name');
  });

  it('refuses an unknown step, field, browser or avatar', () => {
    expect(read({ ...base, steps: [{ do: 'fly', player: 'lan' }] }).ok).toBe(false);
    expect(read({ ...base, steps: [{ do: 'join', player: 'lan', speed: 2 }] }).ok).toBe(false);
    expect(read({ ...base, players: [{ ...base.players[0], browser: 'firefox' }] }).ok).toBe(false);
    expect(read({ ...base, players: [{ ...base.players[0], avatar: 'gold' }] }).ok).toBe(false);
  });

  it('refuses a name the game would refuse and a wait with nothing to wait for', () => {
    expect(read({ ...base, players: [{ ...base.players[0], name: 'x'.repeat(17) }] }).ok).toBe(false);
    expect(read({ ...base, steps: [...base.steps, { do: 'waitFor', player: 'lan', until: {} }] }).problems).toContain('say what to wait for');
  });

  it('refuses a talk to a character who is not in the story', () => {
    expect(read({ ...base, steps: [...base.steps, { do: 'talk', player: 'lan', npc: 'bavko', open: true }] }).ok).toBe(true);
    expect(read({ ...base, steps: [...base.steps, { do: 'talk', player: 'lan', npc: 'nobody' }] }).ok).toBe(false);
  });

  it('says when the file is not JSON', () => {
    expect(parseScene('{').problems).toMatch(/^not JSON/);
  });
});
