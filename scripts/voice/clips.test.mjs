import { describe, expect, it } from 'vitest';
import { buildManifest } from './lib.mjs';
import { checkClips, clipProblems, plannedClips } from './clips.mjs';
import { voiceLines } from './lines.mjs';

const say = (en, sl) => ({ en, sl });
const STORY = {
  npcs: { npcs: [{ id: 'oli', voice: { pitch: 4, pace: 1 } }] },
  dialogue: {
    oli: {
      nodes: {
        hello: { say: say('Hello!', 'Živjo!'), choices: [{ say: say('Hi.', 'Živjo.'), next: 'bye' }] },
        bye: { say: say('Bye, {name}.', 'Adijo, {name}.') },
        told: { say: say('Hello!', 'Živjo!'), speaker: 'narrator' },
      },
    },
  },
  quests: { quests: [{ id: 'walk', name: say('A walk', 'Sprehod'), summary: say('Go for a walk.', 'Pojdi na sprehod.'), steps: [{ id: 'go', hint: say('Hi.', 'Živjo.') }] }] },
};

describe('voiceLines', () => {
  it('voices talk lines as their speaker, and choices and quest text as the narrator', () => {
    const { lines } = voiceLines(STORY);
    const en = lines.filter((line) => line.language === 'en');
    expect(en.map(({ voice, text }) => [voice, text])).toEqual([
      [{ pitch: 4, pace: 1 }, 'Hello!'],
      [null, 'Hi.'],
      [null, 'Hello!'],
      [null, 'A walk'],
      [null, 'Go for a walk.'],
      [null, 'Hi.'],
    ]);
  });

  it('skips lines with a placeholder and says where they are', () => {
    expect(voiceLines(STORY).skipped).toEqual([
      { language: 'en', voice: { pitch: 4, pace: 1 }, text: 'Bye, {name}.', from: 'dialogue/oli.json bye' },
      { language: 'sl', voice: { pitch: 4, pace: 1 }, text: 'Adijo, {name}.', from: 'dialogue/oli.json bye' },
    ]);
  });

  it('voices each form of a Slovenian line written for boys and girls apart', () => {
    const story = { ...STORY, quests: { quests: [{ ...STORY.quests.quests[0], name: say('Done', { m: 'Prišel si', f: 'Prišla si' }) }] } };
    const sl = voiceLines(story).lines.filter((line) => line.language === 'sl').map(({ text }) => text);
    expect(sl).toEqual(expect.arrayContaining(['Prišel si', 'Prišla si']));
  });
});

describe('plannedClips', () => {
  const fixes = { en: {}, sl: { živjo: 'ʒˈiːʋjɔ' } };

  it('makes one clip per language, voice and line', () => {
    const clips = plannedClips(voiceLines(STORY).lines, fixes);
    expect(clips.filter((clip) => clip.language === 'en').map(({ voiceKey, text }) => `${voiceKey} ${text}`)).toEqual([
      'pitch4-pace1 Hello!',
      'narrator Hi.',
      'narrator Hello!',
      'narrator A walk',
      'narrator Go for a walk.',
    ]);
    const hello = clips.filter((clip) => clip.text === 'Hello!');
    expect(hello[0].file).not.toBe(hello[1].file);
  });

  it('renames only the clips whose words got a new fix', () => {
    const before = plannedClips(voiceLines(STORY).lines, fixes);
    const after = plannedClips(voiceLines(STORY).lines, { ...fixes, sl: { ...fixes.sl, sprehod: 'sprˈɛːxɔt' } });
    const changed = after.filter((clip, index) => clip.file !== before[index].file).map(({ text }) => text);
    expect(changed).toEqual(['Sprehod', 'Pojdi na sprehod.']);
  });
});

describe('clipProblems', () => {
  const clips = plannedClips(voiceLines(STORY).lines, { en: {}, sl: {} });
  const manifest = buildManifest(clips, ['en', 'sl']);
  const files = (language) => clips.filter((clip) => clip.language === language).map(({ file }) => file);
  const plan = { clips, manifest };

  it('finds nothing when every clip and the manifest are in place', () => {
    expect(clipProblems(plan, manifest, { en: files('en'), sl: files('sl') })).toEqual([]);
  });

  it('finds a missing clip, a stale clip and an old manifest', () => {
    const problems = clipProblems(plan, { en: {}, sl: {} }, { en: files('en').slice(1), sl: [...files('sl'), 'old.mp3'] });
    expect(problems[0]).toMatch(/voice-clips\.json is out of date/);
    expect(problems).toContain('1 line(s) have no clip:');
    expect(problems).toContain('1 clip(s) in apps/game/public/voice/sl/ that no line uses:');
    expect(problems.at(-1)).toMatch(/npm run voice/);
  });
});

describe('the committed clips', () => {
  it('match content/ exactly', () => {
    expect(checkClips().problems).toEqual([]);
  });
});
