/**
 * The links between the skill files, and to the items, characters, dialogue and maps, that no
 * single schema can check (`skillProblems`, `skillMapProblems`).
 */
import type { WorldMap } from './map.ts';
import type { StoryContent } from './story.ts';
import type { JobTemplate, SkillContent } from './skill-content.ts';

/** A problem when `item` is missing or not of the kind wanted. */
function kindProblems(label: string, item: string, kind: 'ingredient' | 'treat', content: StoryContent): string[] {
  const found = content.items.get(item);
  if (!found) return [`${label}: item "${item}" is not in items.json`];
  return found.kind === kind ? [] : [`${label}: item "${item}" is a ${found.kind}, not ${kind === 'treat' ? 'a' : 'an'} ${kind}`];
}

function levelProblems(label: string, skill: string, level: number, skills: SkillContent): string[] {
  if (!skills.skills.has(skill)) return [`${label}: skill "${skill}" is not in skills.json`];
  return level > skills.maxLevel ? [`${label}: level ${level} is above maxLevel ${skills.maxLevel}`] : [];
}

/** The most of an item one bag stack holds, or null when the item is unknown. */
function stackOf(item: string, content: StoryContent): number | null {
  const kind = content.items.get(item)?.kind;
  return kind ? content.inventory.kinds[kind].stack : null;
}

function spotProblems(skills: SkillContent, content: StoryContent): string[] {
  const problems: string[] = [];
  for (const spot of skills.spots.values()) {
    const label = `spots.json "${spot.id}"`;
    problems.push(...levelProblems(label, spot.skill, spot.level, skills), ...kindProblems(label, spot.item, 'ingredient', content));
    if (skills.skills.get(spot.skill)?.uses === 'recipes') problems.push(`${label}: skill "${spot.skill}" cooks recipes; it has no spots`);
  }
  return problems;
}

function recipeProblems(skills: SkillContent, content: StoryContent): string[] {
  const cook = [...skills.skills.values()].find((skill) => skill.uses === 'recipes');
  const problems: string[] = [];
  if (skills.recipes.size > 0 && !cook) problems.push('recipes.json: no skill in skills.json uses recipes');
  for (const recipe of skills.recipes.values()) {
    const label = `recipes.json "${recipe.id}"`;
    if (cook) problems.push(...levelProblems(label, cook.id, recipe.level, skills));
    problems.push(...kindProblems(label, recipe.makes, 'treat', content));
    for (const { item, count } of recipe.ingredients) {
      problems.push(...kindProblems(`${label} ingredients`, item, 'ingredient', content));
      const stack = stackOf(item, content);
      if (stack !== null && count > stack) problems.push(`${label}: needs ${count} "${item}", more than one stack of ${stack}`);
    }
  }
  return problems;
}

function stationProblems(skills: SkillContent): string[] {
  const kinds = new Set([...skills.stations.values()].map((station) => station.kind));
  const problems: string[] = [];
  if (skills.recipes.size > 0 && !kinds.has('cookingPot')) problems.push('stations.json: recipes need a station of kind "cookingPot"');
  if (skills.templates.size > 0 && !kinds.has('jobBoard')) problems.push('stations.json: jobs need a station of kind "jobBoard"');
  return problems;
}

/** Whether a player at `level` of `skill` can get `item`: a spot of that skill gives it, or that skill cooks it, at or below that level. */
function obtainable(item: string, skill: string, level: number, skills: SkillContent): boolean {
  const gathered = [...skills.spots.values()].some((spot) => spot.item === item && spot.skill === skill && spot.level <= level);
  const cook = skills.skills.get(skill)?.uses === 'recipes';
  return gathered || (cook && [...skills.recipes.values()].some((recipe) => recipe.makes === item && recipe.level <= level));
}

/** The npcs whose dialogue has an entry that opens on `{ jobReady: true }`. */
function readyNpcs(content: StoryContent): Set<string> {
  return new Set([...content.dialogue].filter(([, dialogue]) => dialogue.entries.some((entry) => (entry.if ?? []).some((condition) => 'jobReady' in condition))).map(([npc]) => npc));
}

function templateProblems(template: JobTemplate, skills: SkillContent, content: StoryContent, ready: ReadonlySet<string>): string[] {
  const label = `jobs.json "${template.id}"`;
  const problems = [...levelProblems(label, template.needs.skill, template.needs.level, skills)];
  if (!content.items.has(template.item)) problems.push(`${label}: item "${template.item}" is not in items.json`);
  if (template.kind === 'gather' && ![...skills.spots.values()].some((spot) => spot.item === template.item)) problems.push(`${label}: no spot in spots.json gives "${template.item}"`);
  if (template.kind === 'cook' && ![...skills.recipes.values()].some((recipe) => recipe.makes === template.item)) problems.push(`${label}: no recipe in recipes.json makes "${template.item}"`);
  if (!obtainable(template.item, template.needs.skill, template.needs.level, skills)) {
    problems.push(`${label}: at ${template.needs.skill} level ${template.needs.level} a player cannot get "${template.item}"; every job the board draws must be doable`);
  }
  if (template.kind === 'deliver') {
    for (const npc of template.to) {
      if (!content.npcs.has(npc)) problems.push(`${label}: "${npc}" is not in npcs.json`);
      else if (!ready.has(npc)) problems.push(`${label}: dialogue/${npc}.json has no entry with { "jobReady": true } to take the delivery`);
    }
  }
  const stack = stackOf(template.item, content);
  if (stack !== null && template.count[1] > stack) problems.push(`${label}: asks for up to ${template.count[1]} "${template.item}", more than one stack of ${stack}`);
  for (const { item, count } of template.rewards.items) {
    const rewardStack = stackOf(item, content);
    if (rewardStack === null) problems.push(`${label} rewards: item "${item}" is not in items.json`);
    else if (count > rewardStack) problems.push(`${label} rewards: gives ${count} "${item}", more than one stack of ${rewardStack}`);
  }
  for (const { skill } of template.rewards.xp) if (!skills.skills.has(skill)) problems.push(`${label} rewards: skill "${skill}" is not in skills.json`);
  return problems;
}

function jobProblems(skills: SkillContent, content: StoryContent): string[] {
  const ready = readyNpcs(content);
  const problems = [...skills.templates.values()].flatMap((template) => templateProblems(template, skills, content, ready));
  const starters = [...skills.templates.values()].filter((template) => template.needs.level === 1).length;
  if (starters < skills.slots) problems.push(`jobs.json: only ${starters} template(s) need level 1; a new board of ${skills.slots} needs at least that many`);
  return problems;
}

/**
 * The links of the skill files: spots give ingredients of a skill that uses spots; recipes make
 * treats from ingredients, within a stack; a cooking pot and a job board exist when recipes and jobs
 * do; every job's item exists, comes from a spot or recipe its \`needs\` reach, fits a stack, and goes
 * to characters whose dialogue takes deliveries; at least \`slots\` jobs need level 1; every level is
 * at most \`maxLevel\`; and the dialogue's job entries and skill conditions have skill content.
 */
export function skillProblems(content: StoryContent): string[] {
  const skills = content.skills;
  if (!skills) {
    const usesJobs = [...content.dialogue.values()].some((dialogue) => Object.values(dialogue.nodes).some((node) => (node.effects ?? []).some((effect) => 'deliverJob' in effect)));
    return usesJobs ? ['dialogue/: a node delivers a job, but there is no jobs.json'] : [];
  }
  return [...spotProblems(skills, content), ...recipeProblems(skills, content), ...stationProblems(skills), ...jobProblems(skills, content)];
}

/**
 * The links between the skill files and the maps: every spot and station a map places is known and
 * on one map only, and once any map has a \`spots\` (or \`stations\`) layer, every spot (or station)
 * stands on one, so new ones can ship before they are placed.
 */
export function skillMapProblems(content: StoryContent, maps: readonly WorldMap[]): string[] {
  const skills = content.skills;
  const problems: string[] = [];
  for (const [key, file, known] of [['spots', 'spots.json', skills?.spots], ['stations', 'stations.json', skills?.stations]] as const) {
    const placed = maps.flatMap((map) => Object.keys(map[key]).toSorted().map((id) => ({ id, map: map.id })));
    const label = key === 'spots' ? 'spot' : 'station';
    placed.forEach(({ id, map }, at) => {
      if (placed.findIndex((other) => other.id === id) !== at) problems.push(`maps/${map}.tmj: ${label} "${id}" is also on another map, or twice`);
      if (!known?.has(id)) problems.push(`maps/${map}.tmj: ${label} "${id}" is not in ${file}`);
    });
    if (placed.length > 0) for (const id of known?.keys() ?? []) if (!placed.some((point) => point.id === id)) problems.push(`${file} "${id}": is on no map's "${key}" layer`);
  }
  return problems;
}
