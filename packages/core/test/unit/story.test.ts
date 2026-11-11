import { describe, expect, it } from 'vitest';
import {
  DialogueFile,
  InventoryFile,
  NpcsFile,
  QuestsFile,
  StoryFile,
  advanceConversation,
  bagView,
  checkContentFile,
  chooseStarter,
  conversationView,
  emptyProgress,
  giveItems,
  mapFromRows,
  nextGoal,
  npcMarks,
  offersStarter,
  openConversation,
  pruneStory,
  questEvent,
  questLog,
  stackLimit,
  storyContentProblems,
  storyMapProblems,
  takeItems,
  type Progress,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { goldenStory, liveStory, liveStoryFiles, storyContent } from '../support/story-content.ts';

type Json = Record<string, unknown>;
const copy = <T>(value: T): T => structuredClone(value);
const say = { en: 'Hello.', sl: 'Živjo.' };

/** A player who chose the sun starter, with the given bag. */
function courier(inventory: Progress['inventory'] = []): Progress {
  const chosen = chooseStarter(emptyProgress(), liveStory.starters.species[0]!, liveStory.starters, battleContent);
  if (!chosen) throw new Error('no starter');
  return { ...chosen, inventory };
}

/** Plays a talk from its start with these answers: where it ended up, the nodes it passed and every quest change. */
function talk(npc: string, answers: readonly (number | null)[], progress: Progress) {
  const opened = openConversation(npc, progress, storyContent);
  if (!opened) throw new Error(`${npc} has no dialogue`);
  let step = opened;
  const nodes = [opened.conversation?.node];
  const changes = [...opened.changes];
  for (const answer of answers) {
    if (!step.conversation) throw new Error('the talk already ended');
    const next = advanceConversation(step.conversation, answer, step.progress, storyContent);
    if (!next) throw new Error(`answer ${String(answer)} refused at ${step.conversation.node}`);
    step = next;
    nodes.push(step.conversation?.node);
    changes.push(...next.changes);
  }
  return { ...step, nodes, changes };
}

const dialogueIssues = (raw: unknown) => issuesOf(DialogueFile.safeParse(raw));
const questIssues = (quests: readonly unknown[]) => issuesOf(QuestsFile.safeParse({ quests }));

/** The messages of a failed parse; none for a good one. */
function issuesOf(result: { success: boolean; error?: { issues: readonly { message: string }[] } }): string[] {
  return result.error?.issues.map((issue) => issue.message) ?? [];
}

type DialogueJson = Json & { nodes: Record<string, Json>; entries: Json[] };

/** The problems of the real story with one character's dialogue changed. */
function withDialogue(npc: string, change: (file: DialogueJson) => void) {
  const files = copy(liveStoryFiles);
  change(files.dialogue[npc] as DialogueJson);
  return storyContentProblems(files, battleContent);
}

/** A 4 by 1 open map with these characters and marks. */
function rowMap(id: string, npcs: Record<string, { x: number; y: number }>, marks = {}) {
  return { ...mapFromRows(id, ['....']), npcs, marks };
}

/** A courier with the first quest done and one quest active at this step. */
function questAt(quest: string, step: number, count = 0): Progress {
  return { ...courier(), story: { active: [{ quest, step, count }], done: ['first-round'], flags: [] } };
}

describe('story content files', () => {
  it('accepts the real story files', () => {
    expect(storyContentProblems(liveStoryFiles, battleContent)).toEqual([]);
    for (const name of ['npcs.json', 'quests.json', 'story.json', 'inventory.json']) {
      const key = name.replace('.json', '') as 'npcs' | 'quests' | 'story' | 'inventory';
      expect(checkContentFile(name, liveStoryFiles[key])).toEqual({ ok: true });
    }
    for (const [npc, file] of Object.entries(liveStoryFiles.dialogue)) expect(checkContentFile(`dialogue/${npc}.json`, file)).toEqual({ ok: true });
  });

  it('refuses a dialogue file named for another character', () => {
    expect(checkContentFile('dialogue/tobolko.json', liveStoryFiles.dialogue['bavko'])).toMatchObject({ ok: false });
    expect(checkContentFile('dialogue/Bavko.json', liveStoryFiles.dialogue['bavko'])).toMatchObject({ ok: false });
  });

  it('refuses a repeated character and one without both languages', () => {
    const npcs = copy(liveStoryFiles.npcs) as { npcs: Json[] };
    expect(NpcsFile.safeParse({ npcs: [npcs.npcs[0], npcs.npcs[0]] }).success).toBe(false);
    expect(NpcsFile.safeParse({ npcs: [{ ...npcs.npcs[0], name: { en: 'Bavko' } }] }).success).toBe(false);
  });

  it('refuses dialogue that leads nowhere, that cannot be reached, or that never opens', () => {
    const nodes = { hi: { say, next: 'gone' }, lost: { say } };
    expect(dialogueIssues({ npc: 'bavko', entries: [{ node: 'hi' }], nodes })).toEqual(['node "hi" leads to "gone", which is not a node', 'node "lost" cannot be reached from any entry']);
    expect(dialogueIssues({ npc: 'bavko', entries: [{ node: 'hi' }, { node: 'hi' }], nodes: { hi: { say } } })).toContain('only the last entry may have no "if"; the entries after it could never open');
    expect(dialogueIssues({ npc: 'bavko', entries: [{ if: [{ needsStarter: true }], node: 'hi' }], nodes: { hi: { say } } })).toEqual(['the last entry has no "if", so every talk opens somewhere']);
    expect(dialogueIssues({ npc: 'bavko', entries: [{ node: 'hi' }], nodes: { hi: { say, next: 'hi', choices: [{ say, next: 'hi' }] } } })).not.toEqual([]);
    const fourChoices = Array.from({ length: 4 }, () => ({ say, next: 'hi' }));
    expect(dialogueIssues({ npc: 'bavko', entries: [{ node: 'hi' }], nodes: { hi: { say, choices: fourChoices } } })).not.toEqual([]);
    const twoCues = { say, cue: 'storm-glimpse', effects: [{ offerStarter: true }] };
    expect(dialogueIssues({ npc: 'bavko', entries: [{ node: 'hi' }], nodes: { hi: twoCues } })).not.toEqual([]);
  });

  it('refuses quests that require themselves, an unknown quest, or each other in a circle', () => {
    const [quest] = (copy(liveStoryFiles.quests) as { quests: Json[] }).quests;
    expect(questIssues([{ ...quest, requires: ['first-round'] }])).toEqual(['a quest cannot require itself', '"first-round" requires itself through other quests']);
    expect(questIssues([{ ...quest, requires: ['moon-round'] }])).toEqual(['"first-round" requires "moon-round", which is not a quest']);
    const a = { ...quest, id: 'a', requires: ['b'] };
    const b = { ...quest, id: 'b', requires: ['a'] };
    expect(questIssues([a, b])).toEqual(['"a" requires itself through other quests']);
    expect(questIssues([{ ...quest, steps: [] }])).not.toEqual([]);
  });

  it('refuses a quest in two chapters, and a bag without every kind', () => {
    const story = copy(liveStoryFiles.story) as { chapters: Json[]; flags: Json[] };
    expect(StoryFile.safeParse({ ...story, chapters: [story.chapters[0], { ...story.chapters[0], id: 'again' }] }).success).toBe(false);
    expect(InventoryFile.safeParse({ kinds: { quest: { stack: 1 }, treat: { stack: 99 } }, order: ['quest', 'treat'] }).success).toBe(false);
    expect(InventoryFile.safeParse({ kinds: { quest: { stack: 1 }, treat: { stack: 99 }, material: { stack: 99 } }, order: ['quest', 'treat', 'treat'] }).success).toBe(false);
  });

  it('accepts a quest item and refuses one with no quest', () => {
    const note = battleContent.items.get('hello-note');
    expect(note).toMatchObject({ kind: 'quest', quest: 'first-round' });
    const items = [...battleContent.items.values()];
    expect(checkContentFile('items.json', { items })).toEqual({ ok: true });
    expect(checkContentFile('items.json', { items: [...items.filter((item) => item.id !== 'hello-note'), { ...note, quest: undefined }] })).toMatchObject({ ok: false });
  });
});

describe('links between the story files', () => {
  it('needs a node that offers the starter', () => {
    expect(withDialogue('bavko', (file) => void delete file.nodes['first-friend']!['effects'])).toEqual(['dialogue/: no node offers the starter ({ "offerStarter": true }), so new players could never get a creature']);
  });

  it('needs every take guarded by a check that the player has the item', () => {
    expect(withDialogue('tobolko', (file) => void (file.entries[0]!['if'] = [{ quest: 'first-round', at: 'deliver-note' }]))).toEqual([
      'dialogue/tobolko.json node "note": takes 1 "hello-note", so entry 0 must lead here only with { "has": "hello-note", "count": 1 } (a "next" cannot check it)',
    ]);
  });

  it('starts a quest only from its giver, and completes a delivery only at its recipient', () => {
    const problems = withDialogue('mehurka', (file) => {
      file.nodes['idle']!['effects'] = [{ startQuest: 'first-round' }, { completeStep: 'first-round', step: 'deliver-note' }];
    });
    expect(problems).toEqual([
      'dialogue/mehurka.json node "idle": starts "first-round", whose giver is "bavko", not "mehurka"',
      'dialogue/mehurka.json node "idle": step "deliver-note" of "first-round" is completed by "tobolko", not "mehurka"',
    ]);
  });

  it('names unknown ids, undeclared flags and a gift bigger than a stack', () => {
    const problems = withDialogue('vetrinka', (file) => {
      file.entries = [{ if: [{ flag: 'moon-seen', set: true }, { has: 'moon-cake' }], node: 'idle' }, ...file.entries];
      file.nodes['idle']!['effects'] = [{ give: 'hello-note', count: 2 }];
    });
    expect(problems).toEqual([
      'dialogue/vetrinka.json entry 0: flag "moon-seen" is not declared in story.json',
      'dialogue/vetrinka.json entry 0: item "moon-cake" is not in items.json',
      'dialogue/vetrinka.json node "idle": gives 2 "hello-note", more than one stack of 1 (inventory.json)',
    ]);
  });

  it('needs a dialogue file for every character', () => {
    const files = copy(liveStoryFiles);
    const { mehurka: _gone, ...dialogue } = files.dialogue;
    expect(storyContentProblems({ ...files, dialogue }, battleContent)).toEqual([
      'npcs.json "mehurka": has no dialogue/mehurka.json',
      'quests.json "bell-for-the-shrine" step "deliver-bell": no node of dialogue/mehurka.json completes it ({ "completeStep": "bell-for-the-shrine", "step": "deliver-bell" })',
      'jobs.json "fish-for-friends": dialogue/mehurka.json has no entry with { "jobReady": true } to take the delivery',
      'jobs.json "minty-errand": dialogue/mehurka.json has no entry with { "jobReady": true } to take the delivery',
    ]);
  });

  it('places each character on one map once any is placed, and finds quest marks, zones and shrines', () => {
    const world = { zones: ['post-meadow', 'windy-rise'], shrines: ['post-shrine'] };
    const lookout = { lookout: { x: 3, y: 0 } };
    expect(storyMapProblems(storyContent, { ...world, maps: [rowMap('a', {}, lookout)] })).toEqual([]);
    expect(storyMapProblems(storyContent, { ...world, maps: [rowMap('a', { bavko: { x: 0, y: 0 }, moon: { x: 1, y: 0 } }, lookout), rowMap('b', { bavko: { x: 2, y: 0 } })] })).toEqual([
      'maps/b.tmj: npc "bavko" is also on another map, or twice',
      'maps/a.tmj: npc "moon" is not in npcs.json',
      'npcs.json "tobolko": is on no map\'s "npcs" layer',
      'npcs.json "mehurka": is on no map\'s "npcs" layer',
      'npcs.json "vetrinka": is on no map\'s "npcs" layer',
    ]);
    const golden = goldenStory.content;
    expect(storyMapProblems(golden, { maps: [], zones: [], shrines: [] })).toEqual([
      'quests.json "restless-grass" step "win-two": zone "meadow" is not in encounters.json',
      'quests.json "bell" step "rest": shrine "shrine" is not in shrines.json',
      'quests.json "wind-readings" step "gale-win": zone "rise" is not in encounters.json',
      'quests.json "grey-letter" step "lookout": mark "lookout" is on no map\'s "marks" layer',
    ]);
  });
});

describe('the bag', () => {
  it('fills each item only to its kind\'s stack and reports the rest as extra', () => {
    expect([stackLimit('hello-note', storyContent), stackLimit('plain-treat', storyContent), stackLimit('moon-cake', storyContent)]).toEqual([1, 99, 0]);
    const gift = giveItems(courier([{ item: 'plain-treat', count: 98 }]), [{ item: 'plain-treat', count: 3 }, { item: 'hello-note', count: 2 }, { item: 'moon-cake', count: 1 }], storyContent);
    expect(gift.progress.inventory).toEqual([{ item: 'plain-treat', count: 99 }, { item: 'hello-note', count: 1 }]);
    expect(gift.given).toEqual([{ item: 'plain-treat', count: 1 }, { item: 'hello-note', count: 1 }]);
    expect(gift.extra).toEqual([{ item: 'plain-treat', count: 2 }, { item: 'hello-note', count: 1 }, { item: 'moon-cake', count: 1 }]);
    expect(() => giveItems(courier(), [{ item: 'plain-treat', count: 0 }], storyContent)).toThrow(RangeError);
  });

  it('keeps a bag that holds more than a stack from before, and takes only what is there', () => {
    const full = courier([{ item: 'plain-treat', count: 150 }]);
    expect(giveItems(full, [{ item: 'plain-treat', count: 1 }], storyContent).progress.inventory).toEqual([{ item: 'plain-treat', count: 150 }]);
    expect(takeItems(full, 'plain-treat', 150)?.inventory).toEqual([]);
    expect(takeItems(full, 'plain-treat', 151)).toBeNull();
    expect(takeItems(full, 'hello-note', 1)).toBeNull();
  });

  it('shows a section per kind in inventory.json order, each in items.json order', () => {
    const view = bagView(courier([{ item: 'plain-treat', count: 2 }, { item: 'gone-item', count: 1 }, { item: 'hello-note', count: 1 }]), storyContent);
    expect(view.map((section) => section.kind)).toEqual(storyContent.inventory.order);
    expect(view.flatMap((section) => section.items)).toEqual([
      { item: 'hello-note', count: 1, limit: 1 },
      { item: 'plain-treat', count: 2, limit: 99 },
    ]);
  });
});

describe('talking to Bavko and Tobolko', () => {
  it('offers a new player the starter, and only them', () => {
    const fresh = talk('bavko', [null], emptyProgress());
    expect(fresh.nodes).toEqual(['welcome', 'first-friend']);
    expect(conversationView(fresh.conversation!, fresh.progress, storyContent)).toEqual({ npc: 'bavko', node: 'first-friend', speaker: 'bavko', choices: [], cue: 'offerStarter', ends: true });
    expect(offersStarter(fresh.conversation!, storyContent)).toBe(true);
    expect(offersStarter({ npc: 'bavko', node: 'welcome' }, storyContent)).toBe(false);
    expect(advanceConversation(fresh.conversation!, null, fresh.progress, storyContent)).toEqual({ conversation: null, progress: fresh.progress, changes: [], jobs: [], extra: [] });
    expect(openConversation('bavko', courier(), storyContent)?.conversation?.node).toBe('offer');
  });

  it('ends the talk and changes nothing when a node\'s effect cannot happen', () => {
    expect(advanceConversation({ npc: 'bavko', node: 'welcome' }, null, courier(), storyContent)).toEqual({ conversation: null, progress: courier(), changes: [], jobs: [], extra: [] });
    const busy = talk('bavko', [0], courier());
    expect(advanceConversation({ npc: 'bavko', node: 'offer' }, 0, busy.progress, storyContent)).toEqual({ conversation: null, progress: busy.progress, changes: [], jobs: [], extra: [] });
  });

  it('refuses an answer the node does not take', () => {
    const at = { npc: 'bavko', node: 'offer' };
    expect(advanceConversation(at, null, courier(), storyContent)).toBeNull();
    expect(advanceConversation(at, 2, courier(), storyContent)).toBeNull();
    expect(advanceConversation({ npc: 'bavko', node: 'welcome' }, 0, emptyProgress(), storyContent)).toBeNull();
    expect(advanceConversation({ npc: 'bavko', node: 'toString' }, null, courier(), storyContent)).toBeNull();
    expect(advanceConversation({ npc: 'moon', node: 'idle' }, null, courier(), storyContent)).toBeNull();
    expect(openConversation('moon', courier(), storyContent)).toBeNull();
  });

  it('plays the first round: accept, carry the note, deliver it, get the treats', () => {
    const accepted = talk('bavko', [0], courier());
    expect(accepted.nodes).toEqual(['offer', 'accept']);
    expect(accepted.changes).toEqual([{ quest: 'first-round', change: 'started', step: 0, rewards: null, cue: null }]);
    expect(accepted.progress.inventory).toEqual([{ item: 'hello-note', count: 1 }]);
    expect(npcMarks(accepted.progress, storyContent)).toEqual([{ npc: 'tobolko', mark: 'turnIn' }]);
    expect(nextGoal(accepted.progress, storyContent)).toMatchObject({ kind: 'step', quest: 'first-round', left: 1 });
    expect(openConversation('bavko', accepted.progress, storyContent)?.conversation?.node).toBe('remind');

    const delivered = talk('tobolko', [null], accepted.progress);
    expect(delivered.nodes).toEqual(['note', 'bag']);
    expect(delivered.progress.inventory).toEqual([{ item: 'plain-treat', count: 3 }]);
    expect(delivered.progress.story).toEqual({ active: [], done: ['first-round'], flags: [] });
    expect(delivered.changes).toEqual([{ quest: 'first-round', change: 'done', step: 1, rewards: { items: [{ item: 'plain-treat', count: 3 }], extra: [], xp: 0, creatures: [], skills: [] }, cue: null }]);
    expect(questLog(delivered.progress, storyContent)).toEqual({
      chapters: [{ chapter: 'post-training', done: false, quests: [{ quest: 'first-round', state: 'done', step: 1, count: 0, of: 0 }] }],
      next: { kind: 'newQuest', quest: 'restless-grass', npc: 'tobolko' },
    });
    expect(npcMarks(delivered.progress, storyContent)).toEqual([
      { npc: 'bavko', mark: 'newQuest' },
      { npc: 'tobolko', mark: 'newQuest' },
    ]);
    expect(openConversation('tobolko', delivered.progress, storyContent)?.conversation?.node).toBe('grass-offer');
  });

  it('marks no new quest and asks for the starter while the player has no creature', () => {
    expect(npcMarks(emptyProgress(), storyContent)).toEqual([]);
    expect(nextGoal(emptyProgress(), storyContent)).toEqual({ kind: 'starter', npc: 'bavko' });
    expect(npcMarks(courier(), storyContent)).toEqual([{ npc: 'bavko', mark: 'newQuest' }]);
    expect(nextGoal(courier(), storyContent)).toEqual({ kind: 'newQuest', quest: 'first-round', npc: 'bavko' });
  });
});

describe('quest events', () => {
  const golden = goldenStory.content;

  it('counts battles in the step\'s zone only, and finishes the step at its count', () => {
    const once = questEvent(questAt('restless-grass', 0), { kind: 'battleWon', zone: 'meadow' }, golden);
    expect(once.progress.story.active).toEqual([{ quest: 'restless-grass', step: 0, count: 1 }]);
    expect(questEvent(questAt('restless-grass', 0), { kind: 'battleWon', zone: 'rise' }, golden).progress.story.active).toEqual([{ quest: 'restless-grass', step: 0, count: 0 }]);
    const step = golden.quests.get('restless-grass')!.steps[0]!;
    if (step.kind !== 'winBattles') throw new Error('restless-grass starts with battles');
    const last = questEvent(questAt('restless-grass', 0, step.count - 1), { kind: 'battleWon', zone: 'meadow' }, golden);
    expect(last.changes[0]).toMatchObject({ quest: 'restless-grass' });
    expect(last.progress.story.active.find((entry) => entry.quest === 'restless-grass')?.count ?? 0).toBe(0);
  });

  it('counts nothing for a talk step, an unknown quest, or a player with nothing active', () => {
    const talkStep = questAt('first-round', 0);
    expect(questEvent(talkStep, { kind: 'reached', mark: 'lookout' }, golden)).toEqual({ progress: talkStep, changes: [], extra: [] });
    const unknown = { ...courier(), story: { active: [{ quest: 'moon-round', step: 0, count: 0 }], done: [], flags: [] } };
    expect(questEvent(unknown, { kind: 'rested', shrine: 'shrine' }, golden).changes).toEqual([]);
    expect(questEvent(courier(), { kind: 'befriended', species: 'sun-blob' }, golden).changes).toEqual([]);
  });
});

describe('pruning a saved story', () => {
  it('drops quests and flags the content no longer has, and quests past their last step', () => {
    const saved = { active: [{ quest: 'first-round', step: 0, count: 0 }, { quest: 'moon-round', step: 0, count: 0 }], done: ['old-round'], flags: ['moon-seen'] };
    expect(pruneStory(saved, storyContent)).toEqual({ active: [{ quest: 'first-round', step: 0, count: 0 }], done: [], flags: [] });
    expect(pruneStory({ active: [{ quest: 'first-round', step: 1, count: 0 }], done: [], flags: [] }, storyContent)).toEqual({ active: [], done: [], flags: [] });
    const golden = goldenStory.content;
    const kept = { active: [], done: ['first-round'], flags: [...golden.flags] };
    expect(pruneStory(kept, golden)).toEqual(kept);
  });
});
