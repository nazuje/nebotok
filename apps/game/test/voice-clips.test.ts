import { LANGUAGES, jobCounts, type JobView, type Language } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { jobCard } from '../src/job-board.ts';
import { STORY } from '../src/talk-content.ts';
import type { Voice } from '../src/speech.ts';
import { talkLine } from '../src/talk.ts';
import { voiceClip, voiceKey, type VoiceClips } from '../src/voice-clips.ts';

const CLIPS: VoiceClips = {
  en: { narrator: { 'Find the shrine.': 'aaaa.mp3' }, 'pitch2-pace3': { 'Hello!': 'bbbb.mp3' } },
  sl: { narrator: { 'Poišči svetišče.': 'cccc.mp3' } },
};

describe('voiceClip', () => {
  it('finds a line by language, voice and exact text', () => {
    expect(voiceClip('en', null, 'Find the shrine.', CLIPS)).toBe('/voice/en/aaaa.mp3');
    expect(voiceClip('en', { pitch: 2, pace: 3 }, 'Hello!', CLIPS)).toBe('/voice/en/bbbb.mp3');
    expect(voiceClip('sl', null, 'Poišči svetišče.', CLIPS)).toBe('/voice/sl/cccc.mp3');
  });

  it('is null for another voice, language or wording', () => {
    expect(voiceClip('en', { pitch: 2, pace: 2 }, 'Hello!', CLIPS)).toBeNull();
    expect(voiceClip('sl', null, 'Find the shrine.', CLIPS)).toBeNull();
    expect(voiceClip('en', null, 'Find the shrine', CLIPS)).toBeNull();
    expect(voiceClip('en', null, 'Hello {name}!', CLIPS)).toBeNull();
  });

  it('is not fooled by lines that are object built-ins', () => {
    expect(voiceClip('en', null, 'constructor', CLIPS)).toBeNull();
    expect(voiceClip('en', null, '__proto__', CLIPS)).toBeNull();
  });

  it('names voices as the manifest does', () => {
    expect(voiceKey(null)).toBe('narrator');
    expect(voiceKey({ pitch: 4, pace: 1 })).toBe('pitch4-pace1');
  });
});

const CLIP_URL = /^\/voice\/(en|sl)\/[0-9a-f]{16}\.mp3$/;

describe('the committed clips', () => {
  it('cover every talk line in its speaker voice, every choice, and every quest text', () => {
    const problems: string[] = [];
    const check = (language: Language, voice: Voice | null, text: string, where: string) => {
      const url = voiceClip(language, voice, text);
      // A line with a {placeholder} is filled in while playing, so it has no clip.
      const right = /\{[^{}]*\}/.test(text) ? url === null : url !== null && CLIP_URL.test(url);
      if (!right) problems.push(`${language} ${where}: ${text} -> ${url}`);
    };
    for (const language of LANGUAGES) {
      for (const [npc, dialogue] of STORY.dialogue) {
        for (const [node, said] of Object.entries(dialogue.nodes)) {
          const line = talkLine({ npc, node, choices: (said.choices ?? []).map((_, index) => index) }, STORY, language)!;
          // The voice the talk box gives Speech.onLine (src/talks.ts).
          check(language, line.speaker ? (STORY.npcs.get(line.speaker)?.voice ?? null) : null, line.say, `${npc} ${node}`);
          for (const choice of line.choices) check(language, null, choice.say, `${npc} ${node} choice`);
        }
      }
      for (const quest of STORY.quests.values()) {
        for (const text of [quest.name, quest.summary, ...quest.steps.map((step) => step.hint)]) check(language, null, text[language], quest.id);
      }
    }
    expect(STORY.dialogue.size).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  it('cover every sentence a job card can read, at every count and for every character', () => {
    const skills = STORY.skills!;
    const problems: string[] = [];
    let sentences = 0;
    for (const language of LANGUAGES) {
      for (const template of skills.templates.values()) {
        for (const to of template.kind === 'deliver' ? template.to : [null]) {
          for (const count of jobCounts(template, skills)) {
            const view: JobView = { job: 1, template: template.id, kind: template.kind, item: template.item, count, to, progress: 0 };
            const { line } = jobCard(view, [], null, language);
            const url = line === null ? null : voiceClip(language, null, line);
            sentences += 1;
            if (url === null || !CLIP_URL.test(url)) problems.push(`${language} ${template.id} to ${to} × ${count}: ${line} -> ${url}`);
          }
        }
      }
    }
    expect(sentences).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
