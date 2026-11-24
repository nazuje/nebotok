// The lines players hear: every dialogue node's `say` and choice, every quest's name, summary
// and step hints, every move's name (read from the loadout picker), the strings.json lines in
// SPOKEN_STRINGS and each job card's sentence at every count it can ask for, in each language,
// with the voice that says them.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIALOGUE_FILE, LANGUAGES, NARRATOR, jobCounts, jobLine } from '../../packages/core/src/index.ts';
import { hasPlaceholder } from './lib.mjs';

export const CONTENT_DIR = fileURLToPath(new URL('../../content/', import.meta.url));

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/**
 * The few strings.json lines the game reads aloud besides the story: the duel card's line, the
 * turtle setting and the loadout picker's "new move". Each is said in the narrator's voice.
 */
export const SPOKEN_STRINGS = ['duel.asked', 'arena.turtle', 'loadout.newMove'];

/** npcs.json, quests.json, creatures/moves.json, strings.json, skills.json and jobs.json (as `skills`), and every dialogue file, by character, as raw JSON. */
export function readStoryFiles(dir = CONTENT_DIR) {
  const dialogue = Object.fromEntries(
    readdirSync(join(dir, 'dialogue'))
      .toSorted()
      .flatMap((name) => {
        const npc = DIALOGUE_FILE.exec(`dialogue/${name}`)?.[1];
        return npc === undefined ? [] : [[npc, readJson(join(dir, 'dialogue', name))]];
      }),
  );
  return {
    npcs: readJson(join(dir, 'npcs.json')),
    quests: readJson(join(dir, 'quests.json')),
    moves: readJson(join(dir, 'creatures', 'moves.json')),
    strings: readJson(join(dir, 'strings.json')),
    skills: { skills: readJson(join(dir, 'skills.json')), jobs: readJson(join(dir, 'jobs.json')) },
    dialogue,
  };
}

/** A language's text: a plain string, or (once Slovenian speaks to boys and girls apart) each of its forms. */
const formsOf = (text) => (typeof text === 'string' ? [text] : Object.values(text ?? {}).filter((form) => typeof form === 'string'));

/**
 * { lines, skipped }: each line as { language, voice, text, from }, with `voice` the speaker's
 * npcs.json voice or null for the narrator, choices, quest text, move names and job sentences.
 * Lines with a {placeholder} are in `skipped` instead, because they are filled in while playing.
 * Without `moves`, no move names; without `strings`, no SPOKEN_STRINGS, and with it, each must be
 * there; without `skills.jobs`, no job sentences.
 */
export function voiceLines({ npcs, quests, dialogue, moves, strings, skills }) {
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
  for (const move of moves?.moves ?? []) add(move.name, null, `creatures/moves.json ${move.id} name`);
  for (const id of strings ? SPOKEN_STRINGS : []) {
    if (!strings[id]) throw new Error(`strings.json has no "${id}", which the game reads aloud (SPOKEN_STRINGS in scripts/voice/lines.mjs)`);
    add(strings[id], null, `strings.json ${id}`);
  }
  for (const { localized, from } of jobSentences(skills)) add(localized, null, from);
  return { lines, skipped };
}

/**
 * Each sentence a job card can read aloud, as { localized, from }: for every template, every
 * character a delivery goes to and every count the board can ask for (core `jobCounts`). A
 * template without a `say` gives null in each language, which `add` passes over.
 */
function jobSentences(skills) {
  const jobs = skills?.jobs;
  if (!jobs) return [];
  const growth = { maxLevel: skills.skills.maxLevel, countGrowth: jobs.countGrowth ?? null, outgrownAfter: jobs.outgrownAfter ?? null };
  return jobs.templates.flatMap((template) =>
    (template.kind === 'deliver' ? template.to : [null]).flatMap((to) =>
      jobCounts(template, growth).map((count) => ({
        localized: Object.fromEntries(LANGUAGES.map((language) => [language, jobLine(template, count, to, language)])),
        from: `jobs.json ${template.id}${to === null ? '' : ` to ${to}`} × ${count}`,
      })),
    ),
  );
}
