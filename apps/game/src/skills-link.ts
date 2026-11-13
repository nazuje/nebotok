import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  recipeSkill,
  type Language,
  type ProgressMessage,
  type Refused,
  type SkillAttemptMessage,
  type SkillResultMessage,
  type SkillsMessage,
  type StoryContent,
  type Tap,
} from '@nebotok/core';
import { itemName } from './battle-content.ts';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import type { NewsLines, NewsTone } from './quest-toast.ts';
import { createRecipeBook, type TestRecipeBook } from './recipe-book.ts';
import type { RequestPacer } from './request-pacer.ts';
import { createSkillCard, type TestAttempt } from './skill-game.ts';
import { unlockedAt } from './skills-panel.ts';
import { STORY, storyProgress } from './story-content.ts';
import { format, text } from './strings.ts';

/** A screen over the world that skills put up: a tiny game's card, or the recipe book at a pot. */
export type SkillOverlay = 'skillGame' | 'recipeBook';

/** The requests whose refusals are about skills, answered here rather than by the battle screens. */
export const SKILL_REQUESTS: ReadonlySet<string> = new Set([CLIENT_MESSAGES.gatherStart, CLIENT_MESSAGES.cookStart, CLIENT_MESSAGES.skillFinish, CLIENT_MESSAGES.skillCancel]);

/** What a start asked for, so a refusal can name the spot's or dish's item, level and rest. */
export type Started = { readonly spot: string } | { readonly recipe: string; readonly station: string };

const skillName = (skill: string, content: StoryContent, language: Language) => content.skills?.skills.get(skill)?.name[language] ?? skill;

/** The skill, level and item a start is about. */
function startNeeds(started: Started, content: StoryContent): { readonly skill: string; readonly level: number; readonly item: string } | null {
  const skills = content.skills;
  if (!skills) return null;
  if ('spot' in started) {
    const spot = skills.spots.get(started.spot);
    return spot ? { skill: spot.skill, level: spot.level, item: spot.item } : null;
  }
  const recipe = skills.recipes.get(started.recipe);
  const skill = recipeSkill(skills);
  return recipe && skill ? { skill: skill.id, level: recipe.level, item: recipe.makes } : null;
}

/**
 * What a toast says when a start is turned down: how long the spot still rests, the level it
 * needs, the item with no room left, missing ingredients, or the short refusal line otherwise.
 */
export function refusalLines(reason: Refused['reason'], started: Started | null, restMs: number, content: StoryContent): NewsLines {
  const needs = started ? startNeeds(started, content) : null;
  return (language) => {
    if (reason === 'resting' && restMs > 0) return [format('skill.resting', language, { seconds: Math.ceil(restMs / 1_000) })];
    if (reason === 'needsLevel' && needs) return [format('skill.needsLevel', language, { skill: skillName(needs.skill, content, language), level: needs.level })];
    if (reason === 'bagFull' && needs) return [format('skill.bagFull', language, { item: itemName(needs.item, language) })];
    if (reason === 'noItem') return [text('skill.noItem', language)];
    return [text(`refused.${reason}`, language)];
  };
}

/** The toasts a result brings: what went into the bag and what did not fit, then a level up with what it unlocks. */
export function resultNews(result: SkillResultMessage, content: StoryContent): { readonly lines: NewsLines; readonly tone: NewsTone }[] {
  const news: { lines: NewsLines; tone: NewsTone }[] = [];
  if (result.outcome !== 'perfect' && result.outcome !== 'success') return news;
  if (result.items.length > 0 || result.extra.length > 0) {
    news.push({
      tone: 'good',
      lines: (language) => {
        const lines = result.items.length > 0 ? [result.items.map(({ item, count }) => format('skill.gained', language, { item: itemName(item, language), count })).join(', ')] : [];
        for (const { item } of result.extra) lines.push(format('skill.bagFull', language, { item: itemName(item, language) }));
        return lines;
      },
    });
  }
  if (result.levelUp) {
    news.push({
      tone: 'good',
      lines: (language) => {
        const unlocked = unlockedAt(result.skill, result.level, content, language);
        const head = format('skill.levelUp', language, { skill: skillName(result.skill, content, language), level: result.level });
        return unlocked.length > 0 ? [head, unlocked.join(', ')] : [head];
      },
    });
  }
  return news;
}

export type SkillsOptions = {
  language(): Language;
  /** The player's team and bag, as the server last sent them. */
  progress(): ProgressMessage | null;
  /** Something else is in front of the world (a battle, a talk, a story cue): the card and the book close. */
  blocked(): boolean;
  /** Shows news in the quest toast's queue. */
  news(lines: NewsLines, tone: NewsTone): void;
  /** The job board was walked up to. */
  openBoard(station: string): void;
  /** Which overlay is up changed, so the page shows another screen and input may change. */
  changed(): void;
  /** Paces every gather, cook and game request with the page's other requests, under the server's limit. */
  requests: RequestPacer;
};

export type TestSkills = {
  skills: SkillsMessage | null;
  /** The tiny game on screen, if any. */
  attempt: TestAttempt | null;
  /** The spots resting for this player, with the ms each still rests. */
  resting: Record<string, number>;
  recipeBook: TestRecipeBook | null;
};

export type Skills = {
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Called every frame. */
  frame(now: number): void;
  overlay(): SkillOverlay | null;
  /** The player's skills, as the server last sent them. */
  message(): SkillsMessage | null;
  /** Asks to gather at a spot the courier stands beside. */
  gather(spot: string): void;
  /** Uses a station the courier stands beside: a cooking pot opens the recipe book. */
  useStation(station: string): void;
  /** How much longer a spot rests for this player at `now`, in ms; 0 when it is ready. */
  restLeft(spot: string, now: number): number;
  /** Forgets everything, as when the player leaves the world. */
  reset(): void;
  snapshot(now: number): TestSkills;
};

/**
 * Gathering, cooking and the skill levels in the page: the `skills`, `skill.attempt` and
 * `skill.result` messages and skill refusals (docs/protocol.md, "Skills and the job board"), the
 * tiny game's card, the recipe book, the rests of spots, and the toasts results bring.
 */
export function createSkills(options: SkillsOptions): Skills {
  let room: WorldRoom | null = null;
  let message: SkillsMessage | null = null;
  /** Each resting spot and when, on the page's clock, it is ready again. */
  const rests = new Map<string, number>();
  let started: Started | null = null;
  /** The last game the server sent, so its result knows which spot now rests. */
  let lastAttempt: SkillAttemptMessage | null = null;
  let overlay: SkillOverlay | null = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const send = (type: string, payload: unknown) => options.requests.send(() => room?.send(type, payload));
  const start = (next: Started) => {
    started = next;
    if ('spot' in next) send(CLIENT_MESSAGES.gatherStart, { spot: next.spot });
    else send(CLIENT_MESSAGES.cookStart, { recipe: next.recipe, station: next.station });
  };

  const card = createSkillCard(element<HTMLElement>('#skill-game'), {
    language: options.language,
    reducedMotion: () => reducedMotion.matches,
    finish: (attempt: number, taps: readonly Tap[]) => send(CLIENT_MESSAGES.skillFinish, { attempt, taps }),
    cancel: (attempt) => send(CLIENT_MESSAGES.skillCancel, { attempt }),
    again: (attempt: SkillAttemptMessage) => {
      if (attempt.spot !== null) start({ spot: attempt.spot });
      else if (attempt.recipe !== null && started && 'recipe' in started) start({ recipe: attempt.recipe, station: started.station });
      else card.refused();
    },
    closed: () => update(),
  });
  const book = createRecipeBook(element<HTMLElement>('#recipe-book'), {
    language: options.language,
    progress: () => {
      const progress = options.progress();
      return progress ? storyProgress(progress, null, message) : null;
    },
    cook: (recipe, station) => start({ recipe, station }),
    closed: () => update(),
  });

  function update() {
    const next: SkillOverlay | null = card.isOpen() ? 'skillGame' : book.isOpen() ? 'recipeBook' : null;
    if (next === overlay) return;
    // Back from a dish's tiny game, whose card took focus, so keys work in the book again.
    if (overlay === 'skillGame' && next === 'recipeBook') book.focus();
    overlay = next;
    options.changed();
  }

  function receiveSkills(next: SkillsMessage) {
    message = next;
    const now = performance.now();
    rests.clear();
    for (const { spot, ms } of next.resting) rests.set(spot, now + ms);
  }

  function receiveAttempt(attempt: SkillAttemptMessage) {
    lastAttempt = attempt;
    card.open(attempt, performance.now());
    update();
  }

  function receiveResult(result: SkillResultMessage) {
    const now = performance.now();
    card.result(result, now);
    const spot = lastAttempt?.attempt === result.attempt ? lastAttempt.spot : null;
    if (result.restMs > 0 && spot !== null) rests.set(spot, now + result.restMs);
    for (const { lines, tone } of resultNews(result, STORY)) options.news(lines, tone);
    update();
  }

  function receiveRefused(refused: Refused) {
    if (!SKILL_REQUESTS.has(refused.request)) return;
    card.refused();
    if (refused.request === CLIENT_MESSAGES.gatherStart || refused.request === CLIENT_MESSAGES.cookStart) {
      const restMs = started && 'spot' in started ? Math.max(0, (rests.get(started.spot) ?? 0) - performance.now()) : 0;
      options.news(refusalLines(refused.reason, started, restMs, STORY), 'refused');
    }
    update();
  }

  function forget() {
    message = null;
    rests.clear();
    started = null;
    lastAttempt = null;
    card.close();
    book.close();
    update();
  }

  return {
    joined: (joined) => {
      card.close();
      room = joined;
      const stops = [
        joined.onMessage(SERVER_MESSAGES.skills, receiveSkills),
        joined.onMessage(SERVER_MESSAGES.skillAttempt, receiveAttempt),
        joined.onMessage(SERVER_MESSAGES.skillResult, receiveResult),
        joined.onMessage(SERVER_MESSAGES.refused, receiveRefused),
      ];
      return () => {
        for (const stop of stops) stop();
        if (room === joined) room = null;
      };
    },
    frame: (now) => {
      if (overlay !== null && options.blocked()) {
        card.close();
        book.close();
      }
      card.frame(now);
      book.render();
      update();
    },
    overlay: () => overlay,
    message: () => message,
    gather: (spot) => start({ spot }),
    useStation: (station) => {
      const kind = STORY.skills?.stations.get(station)?.kind;
      if (kind === 'jobBoard') options.openBoard(station);
      else if (kind === 'cookingPot') {
        book.open(station);
        update();
      }
    },
    restLeft: (spot, now) => Math.max(0, (rests.get(spot) ?? 0) - now),
    reset: forget,
    snapshot: (now) => ({
      skills: message,
      attempt: card.state(now),
      resting: Object.fromEntries([...rests].flatMap(([spot, until]) => (until > now ? [[spot, Math.round(until - now)]] : []))),
      recipeBook: book.state(),
    }),
  };
}
