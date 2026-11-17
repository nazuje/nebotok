// The lines players hear: every dialogue node's `say` and choice, and every quest's name, summary
// and step hints, in each language, with the voice that says them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALOGUE_FILE, LANGUAGES, NARRATOR } from '../../packages/core/src/index.ts';
import { hasPlaceholder } from './lib.mjs';

export const CONTENT_DIR = fileURLToPath(new URL('../../content/', import.meta.url));

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** npcs.json, quests.json and every dialogue file, by character, as raw JSON. */
export function readStoryFiles(dir = CONTENT_DIR) {
  const dialogue = Object.fromEntries(
    readdirSync(join(dir, 'dialogue'))
      .toSorted()
      .flatMap((name) => {
        const npc = DIALOGUE_FILE.exec(`dialogue/${name}`)?.[1];
        return npc === undefined ? [] : [[npc, readJson(join(dir, 'dialogue', name))]];
      }),
  );
  return { npcs: readJson(join(dir, 'npcs.json')), quests: readJson(join(dir, 'quests.json')), dialogue };
}

/** A language's text: a plain string, or (once Slovenian speaks to boys and girls apart) each of its forms. */
const formsOf = (text) => (typeof text === 'string' ? [text] : Object.values(text ?? {}).filter((form) => typeof form === 'string'));

/**
 * { lines, skipped }: each line as { language, voice, text, from }, with `voice` the speaker's
 * npcs.json voice or null for the narrator, choices and quest text. Lines with a {placeholder}
 * are in `skipped` instead, because they are filled in while playing.
 */
export function voiceLines({ npcs, quests, dialogue }) {
  const voices = new Map(npcs.npcs.map((npc) => [npc.id, npc.voice]));
  const lines = [];
  const skipped = [];
  const add = (localized, voice, from) => {
    for (const language of LANGUAGES) {
      for (const text of formsOf(localized[language])) (hasPlaceholder(text) ? skipped : lines).push({ language, voice, text, from });
    }
  };
  for (const [npc, file] of Object.entries(dialogue)) {
    for (const [id, node] of Object.entries(file.nodes)) {
      const speaker = node.speaker ?? npc;
      add(node.say, speaker === NARRATOR ? null : (voices.get(speaker) ?? null), `dialogue/${npc}.json ${id}`);
      for (const [index, choice] of (node.choices ?? []).entries()) add(choice.say, null, `dialogue/${npc}.json ${id} choice ${index + 1}`);
    }
  }
  for (const quest of quests.quests) {
    add(quest.name, null, `quests.json ${quest.id} name`);
    add(quest.summary, null, `quests.json ${quest.id} summary`);
    for (const step of quest.steps) add(step.hint, null, `quests.json ${quest.id} ${step.id} hint`);
  }
  return { lines, skipped };
}
