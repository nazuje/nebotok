/**
 * The story as the rules read it: the content of npcs.json, dialogue/, quests.json, story.json and
 * inventory.json, with the skill files when given, looked up by id (`loadStoryContent`), a
 * player's empty story, `pruneStory` for saves that name ids the content no longer has, and
 * `storyProblems` / `storyMapProblems`, the links between those files that no single schema can
 * check (with `skillProblems` / `skillMapProblems` in skill-links.ts for the skill files).
 */
import type { ZodType } from 'zod';
import type { BattleContent } from './battle/content.ts';
import type { Item } from './content.ts';
import type { WorldMap } from './map.ts';
import type { StoryProgress } from './save.ts';
import { JobsFile, RecipesFile, SkillsFile, SpotsFile, StationsFile, skillContentOf, type SkillContent, type SkillContentFiles } from './skill-content.ts';
import { skillMapProblems, skillProblems } from './skill-links.ts';
import {
  DialogueFile,
  InventoryFile,
  NARRATOR,
  NpcsFile,
  QuestsFile,
  StoryFile,
  reachableNodes,
  type Chapter,
  type Condition,
  type DialogueNode,
  type Effect,
  type Npc,
  type Quest,
  type QuestStep,
} from './story-content.ts';

/** The story files, raw or parsed. `dialogue` is each `dialogue/<npc>.json` by npc id. */
export type StoryContentFiles = {
  readonly npcs: unknown;
  readonly dialogue: Readonly<Record<string, unknown>>;
  readonly quests: unknown;
  readonly story: unknown;
  readonly inventory: unknown;
  /** skills.json, spots.json, recipes.json, stations.json and jobs.json; without them nothing can be gathered, cooked or delivered. */
  readonly skills?: SkillContentFiles;
};

/** Everything the story rules read, looked up by id, with the battle content they also need. */
export type StoryContent = {
  readonly npcs: ReadonlyMap<string, Npc>;
  readonly dialogue: ReadonlyMap<string, DialogueFile>;
  readonly quests: ReadonlyMap<string, Quest>;
  /** In story order; each chapter lists its quests in journal order. */
  readonly chapters: readonly Chapter[];
  /** Every declared story flag. */
  readonly flags: ReadonlySet<string>;
  readonly inventory: InventoryFile;
  readonly items: ReadonlyMap<string, Item>;
  readonly battle: BattleContent;
  /** The skills, spots, recipes, stations and job templates, or null when the content has none. */
  readonly skills: SkillContent | null;
};

export class StoryContentError extends Error {
  override name = 'StoryContentError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`story content has ${problems.length} problem(s): ${problems.join('; ')}`);
    this.problems = problems;
  }
}

function analyse(files: StoryContentFiles, battle: BattleContent): { content: StoryContent | null; problems: string[] } {
  const problems: string[] = [];
  const parse = <T>(label: string, schema: ZodType<T>, raw: unknown): T | null => {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    for (const issue of result.error.issues) problems.push(`${label} ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    return null;
  };
  const npcs = parse('npcs.json', NpcsFile, files.npcs);
  const quests = parse('quests.json', QuestsFile, files.quests);
  const story = parse('story.json', StoryFile, files.story);
  const inventory = parse('inventory.json', InventoryFile, files.inventory);
  const dialogue = new Map<string, DialogueFile>();
  for (const npc of Object.keys(files.dialogue).toSorted()) {
    const parsed = parse(`dialogue/${npc}.json`, DialogueFile, files.dialogue[npc]);
    if (parsed && parsed.npc !== npc) problems.push(`dialogue/${npc}.json: its npc must be "${npc}"`);
    if (parsed) dialogue.set(npc, parsed);
  }
  const skillFiles = files.skills;
  const skills = skillFiles
    ? {
        skills: parse('skills.json', SkillsFile, skillFiles.skills),
        spots: parse('spots.json', SpotsFile, skillFiles.spots),
        recipes: parse('recipes.json', RecipesFile, skillFiles.recipes),
        stations: parse('stations.json', StationsFile, skillFiles.stations),
        jobs: parse('jobs.json', JobsFile, skillFiles.jobs),
      }
    : null;
  if (!npcs || !quests || !story || !inventory || problems.length > 0) return { content: null, problems };
  const content: StoryContent = {
    npcs: new Map(npcs.npcs.map((npc) => [npc.id, npc])),
    dialogue,
    quests: new Map(quests.quests.map((quest) => [quest.id, quest])),
    chapters: story.chapters,
    flags: new Set(story.flags.map((flag) => flag.id)),
    inventory,
    items: battle.items,
    battle,
    skills: skills && skills.skills && skills.spots && skills.recipes && skills.stations && skills.jobs ? skillContentOf({ skills: skills.skills, spots: skills.spots, recipes: skills.recipes, stations: skills.stations, jobs: skills.jobs }) : null,
  };
  return { content, problems: [...storyProblems(content), ...skillProblems(content)] };
}

/** Every problem in the story content: each file's own, then the links between them. Empty means valid. */
export function storyContentProblems(files: StoryContentFiles, battle: BattleContent): readonly string[] {
  return analyse(files, battle).problems;
}

export function loadStoryContent(files: StoryContentFiles, battle: BattleContent): StoryContent {
  const { content, problems } = analyse(files, battle);
  if (!content || problems.length > 0) throw new StoryContentError(problems);
  return content;
}

/** The story of a player who has started nothing. */
export function emptyStory(): StoryProgress {
  return { active: [], done: [], flags: [] };
}

/**
 * A saved story with every id the content no longer has dropped, as when a save is loaded (like
 * creatures/renamed.json does for species): quests that are gone, quests whose saved step is past
 * their steps now (they can be started again), and flags no longer declared.
 */
export function pruneStory(story: StoryProgress, content: Pick<StoryContent, 'quests' | 'flags'>): StoryProgress {
  return {
    active: story.active.filter((entry) => entry.step < (content.quests.get(entry.quest)?.steps.length ?? 0)),
    done: story.done.filter((id) => content.quests.has(id)),
    flags: story.flags.filter((id) => content.flags.has(id)),
  };
}

/** The step a dialogue's `completeStep` effect, or a condition's `at`, names, if it exists. */
function stepOf(content: StoryContent, quest: string, step: string): QuestStep | undefined {
  return content.quests.get(quest)?.steps.find((candidate) => candidate.id === step);
}

/** The npc a talk or deliver step is completed by. */
function stepNpc(step: QuestStep): string | null {
  if (step.kind === 'talk') return step.npc;
  if (step.kind === 'deliver') return step.to;
  return null;
}

function itemProblems(label: string, item: string, content: StoryContent): string[] {
  return content.items.has(item) ? [] : [`${label}: item "${item}" is not in items.json`];
}

function stackProblems(label: string, item: string, count: number, content: StoryContent): string[] {
  const kind = content.items.get(item)?.kind;
  const stack = kind ? content.inventory.kinds[kind].stack : count;
  return count > stack ? [`${label}: gives ${count} "${item}", more than one stack of ${stack} (inventory.json)`] : [];
}

function flagProblems(label: string, flag: string, content: StoryContent): string[] {
  return content.flags.has(flag) ? [] : [`${label}: flag "${flag}" is not declared in story.json`];
}

function conditionProblems(label: string, condition: Condition, content: StoryContent): string[] {
  if ('quest' in condition) {
    if (!content.quests.has(condition.quest)) return [`${label}: quest "${condition.quest}" is not in quests.json`];
    if ('at' in condition && !stepOf(content, condition.quest, condition.at)) return [`${label}: quest "${condition.quest}" has no step "${condition.at}"`];
    return [];
  }
  if ('has' in condition) return itemProblems(label, condition.has, content);
  if ('lacks' in condition) return itemProblems(label, condition.lacks, content);
  if ('flag' in condition) return flagProblems(label, condition.flag, content);
  if ('skill' in condition) return skillIdProblems(label, condition.skill, content);
  return [];
}

function skillIdProblems(label: string, skill: string, content: StoryContent): string[] {
  return content.skills?.skills.has(skill) ? [] : [`${label}: skill "${skill}" is not in skills.json`];
}

function effectProblems(label: string, npc: string, effect: Effect, content: StoryContent): string[] {
  if ('startQuest' in effect) {
    const quest = content.quests.get(effect.startQuest);
    if (!quest) return [`${label}: quest "${effect.startQuest}" is not in quests.json`];
    return quest.giver === npc ? [] : [`${label}: starts "${quest.id}", whose giver is "${quest.giver}", not "${npc}"`];
  }
  if ('completeStep' in effect) {
    const step = stepOf(content, effect.completeStep, effect.step);
    if (!step) return [`${label}: quest "${effect.completeStep}" has no step "${effect.step}"`];
    const by = stepNpc(step);
    if (by === null) return [`${label}: step "${effect.step}" of "${effect.completeStep}" is a ${step.kind} step, which counts by itself; only talk and deliver steps are completed in dialogue`];
    return by === npc ? [] : [`${label}: step "${effect.step}" of "${effect.completeStep}" is completed by "${by}", not "${npc}"`];
  }
  if ('give' in effect) return [...itemProblems(label, effect.give, content), ...stackProblems(label, effect.give, effect.count, content)];
  if ('take' in effect) return itemProblems(label, effect.take, content);
  if ('setFlag' in effect) return flagProblems(label, effect.setFlag, content);
  return [];
}

type Arrival = { readonly label: string; readonly if: readonly Condition[] | undefined; readonly byNext: boolean };

/** Every way into each node of a dialogue: an entry, a choice, or another node's `next`. */
function arrivals(dialogue: DialogueFile): Map<string, Arrival[]> {
  const into = new Map<string, Arrival[]>();
  const add = (node: string, arrival: Arrival) => into.set(node, [...(into.get(node) ?? []), arrival]);
  dialogue.entries.forEach((entry, at) => add(entry.node, { label: `entry ${at}`, if: entry.if, byNext: false }));
  for (const [id, node] of Object.entries(dialogue.nodes)) {
    if (node.next !== undefined) add(node.next, { label: `node "${id}"`, if: undefined, byNext: true });
    (node.choices ?? []).forEach((choice, at) => add(choice.next, { label: `node "${id}" choice ${at}`, if: choice.if, byNext: false }));
  }
  return into;
}

/**
 * A node that takes an item is only reached by an entry or choice that checks the player has enough
 * of it, and a node that delivers a job only by one that checks a delivery is ready.
 */
function takeGuardProblems(label: string, id: string, node: DialogueNode, into: readonly Arrival[]): string[] {
  const problems: string[] = [];
  for (const effect of node.effects ?? []) {
    for (const arrival of into) {
      if ('take' in effect) {
        const guarded = (arrival.if ?? []).some((condition) => 'has' in condition && condition.has === effect.take && (condition.count ?? 1) >= effect.count);
        if (!guarded) problems.push(`${label} node "${id}": takes ${effect.count} "${effect.take}", so ${arrival.label} must lead here only with { "has": "${effect.take}", "count": ${effect.count} } (a "next" cannot check it)`);
      }
      if ('deliverJob' in effect && !(arrival.if ?? []).some((condition) => 'jobReady' in condition)) {
        problems.push(`${label} node "${id}": delivers a job, so ${arrival.label} must lead here only with { "jobReady": true } (a "next" cannot check it)`);
      }
    }
  }
  return problems;
}

/**
 * A ready delivery passes over `reminder` entries, so a reminder leads to no effect, and an entry
 * before the job entry that only reminds of an active quest (no effect anywhere it leads) is marked
 * `reminder`, or the delivery would wait behind it while the character shows the turn-in mark.
 */
function reminderProblems(label: string, dialogue: DialogueFile): string[] {
  const jobEntry = dialogue.entries.findIndex((entry) => (entry.if ?? []).some((condition) => 'jobReady' in condition));
  return dialogue.entries.flatMap((entry, at) => {
    const effects = [...reachableNodes({ entries: [entry], nodes: dialogue.nodes })].some((id) => (dialogue.nodes[id]?.effects ?? []).length > 0);
    if (entry.reminder) return effects ? [`${label} entry ${at}: is a "reminder", so a ready delivery skips it, but it leads to effects`] : [];
    const remindsOfQuest = (entry.if ?? []).some((condition) => 'at' in condition || ('is' in condition && condition.is === 'active'));
    return remindsOfQuest && !effects && at < jobEntry ? [`${label} entry ${at}: only reminds of a quest and comes before the job entry, so mark it "reminder": true`] : [];
  });
}

function dialogueProblems(npc: string, dialogue: DialogueFile, content: StoryContent): string[] {
  const label = `dialogue/${npc}.json`;
  const into = arrivals(dialogue);
  const problems: string[] = [];
  if (!content.npcs.has(npc)) problems.push(`${label}: "${npc}" is not in npcs.json`);
  dialogue.entries.forEach((entry, at) => {
    for (const condition of entry.if ?? []) problems.push(...conditionProblems(`${label} entry ${at}`, condition, content));
  });
  problems.push(...reminderProblems(label, dialogue));
  for (const [id, node] of Object.entries(dialogue.nodes)) {
    const at = `${label} node "${id}"`;
    if (node.speaker !== undefined && node.speaker !== NARRATOR && !content.npcs.has(node.speaker)) problems.push(`${at}: speaker "${node.speaker}" is not in npcs.json`);
    for (const choice of node.choices ?? []) for (const condition of choice.if ?? []) problems.push(...conditionProblems(at, condition, content));
    for (const effect of node.effects ?? []) problems.push(...effectProblems(at, npc, effect, content));
    problems.push(...takeGuardProblems(label, id, node, into.get(id) ?? []));
  }
  return problems;
}

/** Every effect of every dialogue node, with the npc whose file it is in. */
function allEffects(content: StoryContent): { readonly npc: string; readonly effect: Effect }[] {
  return [...content.dialogue].flatMap(([npc, dialogue]) => Object.values(dialogue.nodes).flatMap((node) => (node.effects ?? []).map((effect) => ({ npc, effect }))));
}

function stepProblems(quest: Quest, step: QuestStep, content: StoryContent, effects: ReturnType<typeof allEffects>): string[] {
  const label = `quests.json "${quest.id}" step "${step.id}"`;
  const problems = (step.effects ?? []).flatMap((effect) => ('setFlag' in effect ? flagProblems(label, effect.setFlag, content) : []));
  const by = stepNpc(step);
  if (by !== null) {
    if (!content.npcs.has(by)) problems.push(`${label}: "${by}" is not in npcs.json`);
    const done = effects.some(({ npc, effect }) => npc === by && 'completeStep' in effect && effect.completeStep === quest.id && effect.step === step.id);
    if (!done) problems.push(`${label}: no node of dialogue/${by}.json completes it ({ "completeStep": "${quest.id}", "step": "${step.id}" })`);
  }
  if (step.kind === 'deliver') {
    problems.push(...itemProblems(label, step.item, content));
    const given = effects.some(({ effect }) => 'give' in effect && effect.give === step.item) || [...content.quests.values()].some((other) => other.rewards.items.some((reward) => reward.item === step.item));
    if (!given) problems.push(`${label}: nothing gives "${step.item}" to deliver: give it in a dialogue node`);
  }
  if (step.kind === 'befriend' && step.species !== undefined && !content.battle.species.has(step.species)) problems.push(`${label}: species "${step.species}" is not in species.json`);
  if (step.kind === 'befriend' && step.type !== undefined && !content.battle.weather.has(step.type)) problems.push(`${label}: type "${step.type}" is not a weather type`);
  if (step.kind === 'gather' && ![...(content.skills?.spots.values() ?? [])].some((spot) => spot.item === step.item)) problems.push(`${label}: no spot in spots.json gives "${step.item}"`);
  if (step.kind === 'cook' && ![...(content.skills?.recipes.values() ?? [])].some((recipe) => recipe.makes === step.treat)) problems.push(`${label}: no recipe in recipes.json makes "${step.treat}"`);
  if (step.kind === 'finishJobs' && (content.skills?.templates.size ?? 0) === 0) problems.push(`${label}: jobs.json has no jobs to finish`);
  return problems;
}

function questProblems(quest: Quest, content: StoryContent, effects: ReturnType<typeof allEffects>): string[] {
  const label = `quests.json "${quest.id}"`;
  const problems: string[] = [];
  const chapter = content.chapters.find((candidate) => candidate.quests.includes(quest.id));
  if (!chapter) problems.push(`${label}: is in no chapter of story.json`);
  else if (chapter.id !== quest.chapter) problems.push(`${label}: its chapter is "${quest.chapter}", but story.json lists it in "${chapter.id}"`);
  if (!content.npcs.has(quest.giver)) problems.push(`${label}: giver "${quest.giver}" is not in npcs.json`);
  else if (!effects.some(({ npc, effect }) => npc === quest.giver && 'startQuest' in effect && effect.startQuest === quest.id)) {
    problems.push(`${label}: no node of dialogue/${quest.giver}.json starts it ({ "startQuest": "${quest.id}" })`);
  }
  for (const step of quest.steps) problems.push(...stepProblems(quest, step, content, effects));
  for (const { item, count } of quest.rewards.items) problems.push(...itemProblems(`${label} rewards`, item, content), ...stackProblems(`${label} rewards`, item, count, content));
  for (const { skill } of quest.rewards.skills ?? []) problems.push(...skillIdProblems(`${label} rewards`, skill, content));
  for (const effect of quest.effects) if ('setFlag' in effect) problems.push(...flagProblems(label, effect.setFlag, content));
  const last = quest.steps.at(-1);
  if (quest.effects.some((effect) => 'cue' in effect) && (last?.effects ?? []).some((effect) => 'cue' in effect)) problems.push(`${label}: its last step and the quest both play a cue; finishing a quest plays one`);
  return problems;
}

/**
 * The links between the story files, and to the items, species and weather of the battle content:
 * every npc has a dialogue file; every id a condition or effect names exists; every quest is
 * started by its giver's dialogue and sits in the chapter it names; each talk or deliver step is
 * completed by a node of its npc's file; a node that takes an item is only reached after checking
 * the player has it; reminders before a job entry are marked and lead to no effect; delivered items are given somewhere; quest items belong to a quest; every
 * flag is declared and every chapter's closing flag is set; no gift is more than one stack; and
 * some node offers a new player their starter.
 */
export function storyProblems(content: StoryContent): string[] {
  const effects = allEffects(content);
  const problems: string[] = [];
  for (const id of content.npcs.keys()) if (!content.dialogue.has(id)) problems.push(`npcs.json "${id}": has no dialogue/${id}.json`);
  for (const [npc, dialogue] of content.dialogue) problems.push(...dialogueProblems(npc, dialogue, content));
  for (const quest of content.quests.values()) problems.push(...questProblems(quest, content, effects));
  for (const chapter of content.chapters) {
    for (const id of chapter.quests) if (!content.quests.has(id)) problems.push(`story.json chapter "${chapter.id}": quest "${id}" is not in quests.json`);
    if (chapter.endsWith === undefined) continue;
    problems.push(...flagProblems(`story.json chapter "${chapter.id}"`, chapter.endsWith, content));
    const flag = chapter.endsWith;
    const sets = (effect: object) => 'setFlag' in effect && effect.setFlag === flag;
    const set = effects.some(({ effect }) => sets(effect)) || [...content.quests.values()].some((quest) => quest.effects.some(sets) || quest.steps.some((step) => (step.effects ?? []).some(sets)));
    if (!set) problems.push(`story.json chapter "${chapter.id}": nothing sets its closing flag "${flag}"`);
  }
  for (const item of content.items.values()) {
    if (item.kind === 'quest' && !content.quests.has(item.quest)) problems.push(`items.json "${item.id}": quest "${item.quest}" is not in quests.json`);
  }
  if (!effects.some(({ effect }) => 'offerStarter' in effect)) problems.push('dialogue/: no node offers the starter ({ "offerStarter": true }), so new players could never get a creature');
  return problems;
}

/** What the story's map links are checked against: every map, and the zone and shrine ids. Spots and stations are checked by `skillMapProblems`. */
export type StoryWorld = { readonly maps: readonly WorldMap[]; readonly zones: readonly string[]; readonly shrines: readonly string[] };

/**
 * The links between the story and the maps: every character and mark a map places is known and on
 * one map only; once any map has characters, every npc stands on one; every mark a quest sends the
 * player to is on a map; and the zones and shrines of quest steps exist.
 */
export function storyMapProblems(content: StoryContent, world: StoryWorld): string[] {
  const problems: string[] = [];
  const placed = (key: 'npcs' | 'marks') => world.maps.flatMap((map) => Object.keys(map[key]).toSorted().map((id) => ({ id, map: map.id })));
  const npcs = placed('npcs');
  const marks = placed('marks');
  for (const [label, points] of [['npc', npcs], ['mark', marks]] as const) {
    points.forEach(({ id, map }, at) => {
      if (points.findIndex((other) => other.id === id) !== at) problems.push(`maps/${map}.tmj: ${label} "${id}" is also on another map, or twice`);
    });
  }
  for (const { id, map } of npcs) if (!content.npcs.has(id)) problems.push(`maps/${map}.tmj: npc "${id}" is not in npcs.json`);
  if (npcs.length > 0) for (const id of content.npcs.keys()) if (!npcs.some((point) => point.id === id)) problems.push(`npcs.json "${id}": is on no map's "npcs" layer`);
  for (const quest of content.quests.values()) {
    for (const step of quest.steps) {
      const label = `quests.json "${quest.id}" step "${step.id}"`;
      if (step.kind === 'reach' && !marks.some((point) => point.id === step.mark)) problems.push(`${label}: mark "${step.mark}" is on no map's "marks" layer`);
      if (step.kind === 'winBattles' && step.zone !== undefined && !world.zones.includes(step.zone)) problems.push(`${label}: zone "${step.zone}" is not in encounters.json`);
      if (step.kind === 'visitShrine' && !world.shrines.includes(step.shrine)) problems.push(`${label}: shrine "${step.shrine}" is not in shrines.json`);
    }
  }
  return [...problems, ...skillMapProblems(content, world.maps)];
}
