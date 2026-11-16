import { LANGUAGES, type Language, type QuestChanged } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { questHint } from '../src/quest-toast.ts';
import { createSpeech, type ClipPlayer, type Voice } from '../src/speech.ts';
import { STORY } from '../src/talk-content.ts';
import { talkLine, type TalkLine } from '../src/talk.ts';
import type { VoiceClips } from '../src/voice-clips.ts';

const CLIPS: VoiceClips = {
  en: { narrator: { 'Find the shrine.': 'aaaa.mp3' }, 'pitch2-pace3': { 'Hello!': 'bbbb.mp3' } },
  sl: { narrator: { 'Poišči svetišče.': 'cccc.mp3' } },
};
const PIP: Voice = { pitch: 2, pace: 3 };

/** A player that keeps what it was told instead of making sound. */
function recorder() {
  const heard: (string | 'stop')[] = [];
  const player: ClipPlayer = { play: (url) => heard.push(url), stop: () => heard.push('stop') };
  return { heard, player };
}

/** Speech over the test clips, or with `committed` over the clips the game ships. */
function speechWith(readToMe: boolean, language: Language = 'en', committed = false) {
  const { heard, player } = recorder();
  const setting = { readToMe, language };
  const speech = createSpeech({ language: () => setting.language, readToMe: () => setting.readToMe, player, ...(committed ? {} : { clips: CLIPS }) });
  return { heard, speech, setting };
}

describe('speech', () => {
  it('reads each line in its speaker voice, and the narrator\'s lines in the narrator\'s, while "Read to me" is on', () => {
    const { heard, speech, setting } = speechWith(true);
    speech.onLine(PIP, 'Hello!', 'happy');
    speech.onLine(null, 'Find the shrine.', null);
    setting.language = 'sl';
    speech.onLine(null, 'Poišči svetišče.', null);
    expect(heard).toEqual(['/voice/en/bbbb.mp3', '/voice/en/aaaa.mp3', '/voice/sl/cccc.mp3']);
  });

  it('never takes another voice\'s or language\'s clip, and a line with no clip stops the last one and stays silent', () => {
    const { heard, speech } = speechWith(true);
    speech.onLine(PIP, 'Hello!', null);
    speech.onLine({ pitch: 4, pace: 1 }, 'Hello!', null);
    speech.onLine(null, 'Hello!', null);
    speech.onLine(null, 'Poišči svetišče.', null);
    expect(heard).toEqual(['/voice/en/bbbb.mp3', 'stop', 'stop', 'stop']);
  });

  it('plays nothing with "Read to me" off: no line, no hint, only a stop for any clip a button started', () => {
    const { heard, speech } = speechWith(false);
    speech.onLine(PIP, 'Hello!', 'happy');
    speech.onLine(null, 'Find the shrine.', null);
    speech.onHint('Find the shrine.');
    expect(heard.filter((each) => each !== 'stop')).toEqual([]);
  });

  it('reads a new quest hint in the narrator\'s voice only while "Read to me" is on', () => {
    const on = speechWith(true);
    on.speech.onHint('Find the shrine.');
    on.speech.onHint('No clip for this.');
    expect(on.heard).toEqual(['/voice/en/aaaa.mp3', 'stop']);
  });

  it('plays a speaker button\'s line whatever the setting, and says which lines have a clip', () => {
    const { heard, speech } = speechWith(false);
    speech.say(PIP, 'Hello!');
    speech.say(null, 'Not voiced.');
    expect(heard).toEqual(['/voice/en/bbbb.mp3', 'stop']);
    expect(speech.has(PIP, 'Hello!')).toBe(true);
    expect(speech.has(null, 'Hello!')).toBe(false);
    speech.stop();
    expect(heard.at(-1)).toBe('stop');
  });
});

/** The voice the talk box gives Speech.onLine (src/talks.ts). */
const voiceOf = (line: TalkLine) => (line.speaker ? (STORY.npcs.get(line.speaker)?.voice ?? null) : null);
const lines = (language: Language) =>
  [...STORY.dialogue].flatMap(([npc, dialogue]) => Object.entries(dialogue.nodes).map(([node, said]) => talkLine({ npc, node, choices: (said.choices ?? []).map((_, index) => index) }, STORY, language)!));

describe('speech with the committed clips', () => {
  it('finds a clip for a character\'s line and for a narrator\'s line in both languages, in a different voice', () => {
    for (const language of LANGUAGES) {
      const all = lines(language);
      const character = all.find((line) => line.speaker !== null && voiceOf(line) !== null && !line.say.includes('{'))!;
      const narrator = all.find((line) => line.speaker === null && !line.say.includes('{'))!;
      const { heard, speech } = speechWith(true, language, true);
      speech.onLine(voiceOf(character), character.say, character.mood);
      speech.onLine(null, narrator.say, narrator.mood);
      expect(heard).toHaveLength(2);
      for (const url of heard) expect(url).toMatch(new RegExp(`^/voice/${language}/[0-9a-f]{16}\\.mp3$`));
      expect(heard[0]).not.toBe(heard[1]);
    }
  });

  it('reads the hint of a quest just started and of a step just done, and nothing for a quest done', () => {
    const quest = [...STORY.quests.values()].find((each) => each.steps.length > 1);
    expect(quest).toBeDefined();
    const started: QuestChanged = { quest: quest!.id, change: 'started', step: 0, rewards: null, cue: null };
    const stepped: QuestChanged = { quest: quest!.id, change: 'step', step: 1, rewards: null, cue: null };
    const done: QuestChanged = { quest: quest!.id, change: 'done', step: quest!.steps.length, rewards: null, cue: null };
    for (const language of LANGUAGES) {
      expect(questHint(started, language)).toBe(quest!.steps[0]!.hint[language]);
      expect(questHint(stepped, language)).toBe(quest!.steps[1]!.hint[language]);
      expect(questHint(done, language)).toBeNull();
      const { heard, speech } = speechWith(true, language, true);
      speech.onHint(questHint(started, language)!);
      expect(heard).toEqual([expect.stringMatching(new RegExp(`^/voice/${language}/[0-9a-f]{16}\\.mp3$`))]);
    }
  });
});
