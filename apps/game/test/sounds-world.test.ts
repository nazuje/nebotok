import { SoundsFile, soundMs } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import sounds from '../../../content/sounds.json' with { type: 'json' };
import { battleEndSound, jobSound, questSound, skillSound, talkSound } from '../src/sounds-world.ts';
import { createPanelSounds, panelSound, tapSoundOf, toastSound } from '../src/sounds-ui.ts';
import { STORY } from '../src/talk-content.ts';
import { wildBattle } from './support/battle-messages.ts';

const FILE = SoundsFile.parse(sounds);
const IDS = new Set(FILE.sounds.map((sound) => sound.id));
/** The celebrations, which may last up to 2 s; every other sound is over within a second. */
const FANFARES = new Set(['quest.done', 'world.level-up', 'world.befriend', 'world.job-done', 'ui.login']);

describe('the interface sounds', () => {
  it('plays ui.back for a button that closes or goes back, and ui.tap for any other', () => {
    for (const name of ['bag-close', 'battle-back primary', 'skill-done', 'talk-close', 'pin-back']) expect(tapSoundOf(name)).toBe('ui.back');
    for (const name of ['', 'sounds', 'settings-button', 'closet', 'job-board-open', 'backpack']) expect(tapSoundOf(name)).toBe('ui.tap');
  });

  it('opens and closes a panel over the world, and leaves fights, talks and tiny games to their own sounds', () => {
    expect(panelSound('world', 'bag')).toBe('ui.open');
    expect(panelSound('journal', 'world')).toBe('ui.close');
    expect(panelSound('world', 'battle')).toBeNull();
    expect(panelSound('battle', 'world')).toBeNull();
    expect(panelSound('team', 'loadout')).toBeNull();
    expect(panelSound('loading', 'world')).toBeNull();
  });

  it('is silent for the first screen, and for a tiny game over the recipe book', () => {
    const played: string[] = [];
    const show = createPanelSounds((id) => played.push(id));
    for (const screen of ['world', 'recipeBook', 'skillGame', 'recipeBook', 'world'] as const) show(screen);
    show('world');
    expect(played).toEqual(['ui.open', 'ui.close']);
  });

  it('gives a toast its own news sound or ui.toast', () => {
    expect(toastSound('shrine.rested')).toBe('world.shrine-rest');
    expect(toastSound('duel.no')).toBe('world.duel.declined');
    expect(toastSound('battle.interrupted')).toBe('ui.toast');
  });
});

describe('the world sounds', () => {
  it('hears each quest change', () => {
    expect(questSound({ change: 'started' })).toBe('world.quest.new');
    expect(questSound({ change: 'step' })).toBe('world.quest.step');
    expect(questSound({ change: 'done' })).toBe('quest.done');
  });

  it('hears a tiny game as a hit, a perfect or a miss, and a cancelled one not at all', () => {
    expect(skillSound('dip', 'success')).toBe('skill.dip.hit');
    expect(skillSound('sparkle', 'perfect')).toBe('skill.sparkle.perfect');
    expect(skillSound('marker', 'miss')).toBe('skill.marker.miss');
    expect(skillSound('marker', 'late')).toBe('skill.marker.miss');
    expect(skillSound('dip', 'cancelled')).toBeNull();
  });

  it('hears a trainer\'s challenge and a gift in a talk, and nothing on another line', () => {
    expect(talkSound({ npc: 'vetrinka', node: 'test-go' }, STORY)).toBe('world.trainer.challenge');
    expect(talkSound({ npc: 'vetrinka', node: 'no-storm' }, STORY)).toBe('world.item');
    expect(talkSound({ npc: 'vetrinka', node: 'idle' }, STORY)).toBeNull();
    expect(talkSound({ npc: 'vetrinka', node: 'toString' }, STORY)).toBeNull();
    expect(talkSound({ npc: 'nobody', node: 'idle' }, STORY)).toBeNull();
  });

  it('hears a befriending, else a level up, at a battle\'s end', () => {
    const view = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 }).started.payload.battle;
    const won = (level: number) => ({ battle: view.id, outcome: { winner: 0, reason: 'fainted' }, rewards: [{ index: 0, xp: 22, level }], learned: [], woke: null }) as const;
    expect(battleEndSound(won(6), null, view)).toBe('world.level-up');
    expect(battleEndSound(won(5), null, view)).toBeNull();
    const befriended = { ...won(6), outcome: { winner: 0, reason: 'befriended' } } as const;
    expect(battleEndSound(befriended, { battle: view.id, species: 'pinwhirl', placedIn: 'team' }, view)).toBe('world.befriend');
  });

  it('hears a job done, and not one only further along', () => {
    expect(jobSound({ change: 'done' })).toBe('world.job-done');
    expect(jobSound({ change: 'progress' })).toBeNull();
  });

  it('names only sounds that sounds.json has', () => {
    const named = [
      'ui.back',
      'ui.open',
      'ui.close',
      'ui.toast',
      'ui.login',
      'world.move-learned',
      'world.item',
      'world.level-up',
      'world.storm',
      'world.duel.asked',
      ...(['started', 'step', 'done'] as const).map((change) => questSound({ change })),
      ...(['dip', 'sparkle', 'marker'] as const).flatMap((game) => (['perfect', 'success', 'miss'] as const).map((outcome) => skillSound(game, outcome))),
      toastSound('shrine.rested'),
      toastSound('duel.no'),
      jobSound({ change: 'done' }),
      talkSound({ npc: 'vetrinka', node: 'test-go' }, STORY),
    ];
    expect(named.filter((id) => id === null || !IDS.has(id))).toEqual([]);
  });

  it('keeps every interface, world and skill sound short: under a second, a fanfare under two', () => {
    const ours = FILE.sounds.filter((each) => /^(ui|world|skill)\./.test(each.id) || each.id === 'quest.done');
    const tooLong = ours.filter((sound) => soundMs(sound) >= (FANFARES.has(sound.id) ? 2_000 : 1_000)).map((sound) => `${sound.id}: ${soundMs(sound)} ms`);
    expect(tooLong).toEqual([]);
  });
});
