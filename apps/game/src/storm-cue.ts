import { SERVER_MESSAGES, spriteFor, type Language, type QuestChanged, type StoryCue, type StoryMessage, type TalkCue } from '@nebotok/core';
import type { GameObjects, Geom } from 'phaser';
import type { WorldRoom } from './connection.ts';
import { button, el, element } from './dom.ts';
import type { Speech } from './speech.ts';
import { animationKey, spriteTexture } from './sprites.ts';
import { beatAt, createCueGate, flagsSetWith, MOVING_BEATS, outward, questCueKey, STILL_BEATS, type Beats, type StormBeat } from './storm-plan.ts';
import { text } from './strings.ts';
import { STORY } from './talk-content.ts';
import type { WorldScene } from './world-scene.ts';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const DIM_COLOUR = 0x1b1b2f;
const DIM_ALPHA = 0.45;
/** The dim reaches past the screen's edges, so a shake never shows an undimmed strip. */
const DIM_MARGIN = 24;
/** Over everything in the world, the storm band included. */
const DIM_DEPTH = 10_000;
/** How far past your courier the camera looks out, as a share of the screen's width. */
const LOOK_SHARE = 0.55;
/** Where the little cloud floats from the middle of the screen it looks at, in world pixels. */
const CLOUD_OFFSET = { x: 0.1, y: -12 } as const;
/** How close the storm drifts before it bites, and how far it lunges, in world pixels from the cloud. */
const STORM_NEAR = 34;
const STORM_BITE = 8;
const SHAKE_INTENSITY = 0.012;
const EASE = 'Sine.easeInOut';

/** A story cue on screen, for the test hook. */
export type TestStorm = {
  cue: { cue: StoryCue; beat: StormBeat; reduced: boolean; caption: string | null } | null;
  /** How many cues this page has played since it loaded. */
  played: number;
  /** The story flags the server last sent this player. */
  flags: readonly string[];
  /** The storm band shows on this player's horizon. */
  band: boolean;
  /** A cue holds the camera away from the courier. */
  cameraHeld: boolean;
};

export type StoryCuesOptions = {
  scene: WorldScene;
  speech: Speech;
  language(): Language;
  /** Nothing but the world is on screen, so a cue can play. */
  free(): boolean;
  /** A cue started or ended, so walking pauses or goes on. */
  changed(): void;
};

export type StoryCues = {
  /** Listens to a joined room for quest cues and the story's flags. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** A cue from a `talk.node`, with its key (`talkCueKey`). */
  fromTalk(cue: TalkCue, key: string): void;
  /** Called every frame: starts a waiting cue once the world is free, and moves the one playing on. */
  frame(now: number): void;
  playing(): boolean;
  /** Forgets everything, as when the player leaves the world. */
  reset(): void;
  snapshot(): TestStorm;
};

type Stage = {
  readonly cue: StoryCue;
  readonly beats: Beats;
  readonly reduced: boolean;
  readonly startedAt: number;
  beat: StormBeat | null;
  readonly side: -1 | 1;
  readonly home: { readonly x: number; readonly y: number };
  readonly spot: { readonly x: number; readonly y: number };
  readonly cloudAt: { readonly x: number; readonly y: number };
  readonly bounds: Geom.Rectangle;
  readonly dim: GameObjects.Rectangle;
  readonly storm: GameObjects.Sprite;
  readonly cloud: GameObjects.Sprite;
};

/**
 * Story cues, the little scenes a quest step or a talk plays: for now only the storm glimpse, seen
 * from the lookout. Each cue the server sends plays once, waiting while a battle or another screen
 * is up. A tap skips it. Every cue also reaches `speech.onCue`. Once the player's story has the flag
 * the storm cue sets, the storm band stays on their horizon.
 */
export function createStoryCues(options: StoryCuesOptions): StoryCues {
  const { scene } = options;
  const gate = createCueGate();
  const bandFlags = flagsSetWith('storm-glimpse', STORY);
  const waiting: StoryCue[] = [];
  let stage: Stage | null = null;
  let played = 0;
  let flags: readonly string[] = [];

  const root = element<HTMLElement>('#storm-cue');
  const caption = el('p', { className: 'storm-cue-caption', attrs: { 'aria-live': 'polite' } });
  const skip = button('storm-cue-skip', '', () => finish());
  root.replaceChildren(skip, caption);

  function heard(cue: TalkCue, key: string) {
    if (!gate.first(key)) return;
    options.speech.onCue(cue);
    if (cue !== 'offerStarter') waiting.push(cue);
  }

  function start(cue: StoryCue, now: number) {
    const camera = scene.cameras.main;
    const reduced = REDUCED_MOTION.matches;
    const bounds = camera.getBounds();
    const home = { x: camera.midPoint.x, y: camera.midPoint.y };
    const side = outward(home.x - bounds.x, bounds.width);
    const view = camera.worldView;
    const spot = { x: home.x + side * view.width * LOOK_SHARE, y: home.y };
    const cloudAt = { x: spot.x + side * view.width * CLOUD_OFFSET.x, y: spot.y + CLOUD_OFFSET.y };
    // The sky past the map's edge is the camera's own background; the cue may look out over it.
    camera.setBounds(bounds.x - view.width, bounds.y, bounds.width + view.width * 2, bounds.height);
    scene.holdCamera(true);
    const picture = spriteFor.cue(cue);
    const dim = scene.add
      .rectangle(-DIM_MARGIN, -DIM_MARGIN, camera.width + DIM_MARGIN * 2, camera.height + DIM_MARGIN * 2, DIM_COLOUR, 1)
      .setOrigin(0)
      .setScrollFactor(0)
      .setDepth(DIM_DEPTH)
      .setAlpha(0);
    const cloud = scene.add.sprite(cloudAt.x, cloudAt.y, spriteTexture(scene, `${picture}-cloud`), 'puff').setDepth(DIM_DEPTH + 1).setFlipX(side < 0);
    const stormFrom = { x: cloudAt.x + side * (view.width / 2 + 48), y: cloudAt.y - 4 };
    const storm = scene.add.sprite(stormFrom.x, stormFrom.y, spriteTexture(scene, picture), 'still').setDepth(DIM_DEPTH + 2).setFlipX(side < 0);
    stage = { cue, beats: reduced ? STILL_BEATS : MOVING_BEATS, reduced, startedAt: now, beat: null, side, home, spot, cloudAt, bounds, dim, storm, cloud };
    root.hidden = false;
    skip.setAttribute('aria-label', text('storm.skip', options.language()));
    caption.textContent = reduced ? text('storm.caption', options.language()) : '';
    caption.hidden = !reduced;
    played += 1;
    options.changed();
  }

  function enter(current: Stage, beat: StormBeat) {
    const camera = scene.cameras.main;
    const { side, cloudAt, storm, cloud, dim } = current;
    const tween = (targets: object, props: Record<string, unknown>, ms: number, delay = 0) => scene.tweens.add({ targets, ...props, duration: ms, delay, ease: EASE });
    const ms = current.beats.find((each) => each.beat === beat)?.ms ?? 0;
    if (beat === 'still') {
      camera.centerOn(current.spot.x, current.spot.y);
      dim.setAlpha(DIM_ALPHA);
      cloud.setFrame('bitten');
      storm.setPosition(cloudAt.x + side * STORM_NEAR, cloudAt.y - 4);
    } else if (beat === 'look') {
      camera.pan(current.spot.x, current.spot.y, ms, EASE, true);
      tween(dim, { alpha: DIM_ALPHA }, ms / 2);
    } else if (beat === 'drift') {
      storm.play(animationKey(spriteFor.cue(current.cue), 'loom'));
      tween(storm, { x: cloudAt.x + side * STORM_NEAR }, ms);
    } else if (beat === 'bite') {
      tween(storm, { x: cloudAt.x + side * STORM_BITE }, ms / 3);
      scene.time.delayedCall(ms / 3, () => cloud.setFrame('bitten'));
      tween(cloud, { scale: 0, alpha: 0 }, ms / 2, ms / 2);
    } else if (beat === 'shake') {
      camera.shake(ms, SHAKE_INTENSITY, true);
    } else if (beat === 'back') {
      tween(storm, { alpha: 0, x: storm.x + side * STORM_NEAR }, ms * 0.6);
      tween(dim, { alpha: 0 }, ms, 0);
      camera.pan(current.home.x, current.home.y, ms, EASE, true);
    }
  }

  /** Ends the cue at once, as when it plays out or a tap skips it: the camera glides back to the courier. */
  function finish() {
    const ending = stage;
    if (!ending) return;
    stage = null;
    const camera = scene.cameras.main;
    camera.panEffect.reset();
    camera.shakeEffect.reset();
    for (const made of [ending.dim, ending.storm, ending.cloud]) {
      scene.tweens.killTweensOf(made);
      made.destroy();
    }
    const { x, y, width, height } = ending.bounds;
    camera.setBounds(x, y, width, height);
    scene.holdCamera(false);
    root.hidden = true;
    caption.textContent = '';
    options.changed();
  }

  // While a cue plays, its keys skip it and reach nothing else, such as an open talk.
  window.addEventListener(
    'keydown',
    (event) => {
      if (!stage) return;
      if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'Escape') {
        if (!event.repeat) finish();
        event.preventDefault();
      }
      event.stopImmediatePropagation();
    },
    { capture: true },
  );

  return {
    joined: (room) => {
      // The gate is kept across reconnections: the server sends an open talk's node again then.
      const stops = [
        room.onMessage(SERVER_MESSAGES.questChanged, (change: QuestChanged) => {
          if (change.cue !== null) heard(change.cue, questCueKey(change));
        }),
        room.onMessage(SERVER_MESSAGES.story, (story: StoryMessage) => {
          flags = story.flags;
          scene.showStormBand(flags.some((flag) => bandFlags.has(flag)));
        }),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    fromTalk: heard,
    frame: (now) => {
      if (stage && !options.free()) finish();
      if (!stage) {
        const next = options.free() && scene.mapId !== null ? waiting.shift() : undefined;
        if (next === undefined) return;
        start(next, now);
      }
      const current = stage;
      if (!current) return;
      const beat = beatAt(current.beats, now - current.startedAt);
      if (beat === null) {
        finish();
        return;
      }
      if (beat !== current.beat) {
        current.beat = beat;
        enter(current, beat);
      }
    },
    playing: () => stage !== null,
    reset: () => {
      waiting.length = 0;
      finish();
      gate.clear();
      flags = [];
      scene.showStormBand(false);
    },
    snapshot: () => ({
      cue: stage ? { cue: stage.cue, beat: stage.beat ?? stage.beats[0]!.beat, reduced: stage.reduced, caption: stage.reduced ? caption.textContent : null } : null,
      played,
      flags,
      band: scene.stormBandShown,
      cameraHeld: scene.cameraHeld,
    }),
  };
}
