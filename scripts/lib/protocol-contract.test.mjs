import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as core from '../../packages/core/src/index.ts';
import { PROTOCOL_CONTRACTS } from '../../packages/core/src/protocol.ts';
import { ARENA_MESSAGES_PER_SECOND, ARENA_SUB_STEPS, ARENA_TICK_RATE, PRESSES_PER_SECOND } from '../../apps/server/src/arena-room.ts';
import { ARENA_ROOM } from '../../apps/server/src/fights.ts';
import { SKILLS_NEED_STARTER } from '../../apps/server/src/skills.ts';
import { STARTER_NEEDS_TALK } from '../../apps/server/src/talk.ts';

// What a client relies on from the server. A new client message schema or a server switch that
// changes what a client must do first belongs here too.
const CLIENT_SCHEMAS = {
  WalkToMessage: core.WalkToMessage,
  WalkHoldMessage: core.WalkHoldMessage,
  WalkStopMessage: core.WalkStopMessage,
  BattleMoveMessage: core.BattleMoveMessage,
  BattleSwitchMessage: core.BattleSwitchMessage,
  BattleTreatMessage: core.BattleTreatMessage,
  BattleRunMessage: core.BattleRunMessage,
  TeamReorderMessage: core.TeamReorderMessage,
  StorageSwapMessage: core.StorageSwapMessage,
  StarterChooseMessage: core.StarterChooseMessage,
  MoveChooseMessage: core.MoveChooseMessage,
  TalkStartMessage: core.TalkStartMessage,
  TalkNextMessage: core.TalkNextMessage,
  TalkEndMessage: core.TalkEndMessage,
  GatherStartMessage: core.GatherStartMessage,
  CookStartMessage: core.CookStartMessage,
  SkillFinishMessage: core.SkillFinishMessage,
  SkillCancelMessage: core.SkillCancelMessage,
  BoardOpenMessage: core.BoardOpenMessage,
  SettingsSetMessage: core.SettingsSetMessage,
  SettingsTurtleMessage: core.SettingsTurtleMessage,
  LoadoutSetMessage: core.LoadoutSetMessage,
  DuelAskMessage: core.DuelAskMessage,
  DuelAnswerMessage: core.DuelAnswerMessage,
  DuelCancelMessage: core.DuelCancelMessage,
};

// Who may ask whom for a duel, and how long an ask and a decline last: a client that offers asks
// the server refuses, or keeps an answer card up longer, gets in the way.
const DUEL_RULES = {
  DUEL_TEAM: core.DUEL_TEAM,
  DUEL_REACH: core.DUEL_REACH,
  DUEL_ANSWER_MS: core.DUEL_ANSWER_MS,
  DUEL_PAUSE_MS: core.DUEL_PAUSE_MS,
};

// The timing rules a skill attempt is judged by: a client that times its taps differently is judged wrong.
const ATTEMPT_RULES = {
  MIN_ATTEMPT_MS: core.MIN_ATTEMPT_MS,
  CLOCK_SLACK_MS: core.CLOCK_SLACK_MS,
  FADE_MS: core.FADE_MS,
  LATE_MS: core.LATE_MS,
  SPARKLE_FIRST_MS: core.SPARKLE_FIRST_MS,
  SPARKLE_PLACES: core.SPARKLE_PLACES,
  MAX_TAPS: core.MAX_TAPS,
  MAX_TAP_MS: core.MAX_TAP_MS,
  MARKER_TRACK: core.MARKER_TRACK,
  MARKER_MARGIN: core.MARKER_MARGIN,
  MARKER_HALF_WIDTH: core.MARKER_HALF_WIDTH,
};

const contract = {
  clientMessages: core.CLIENT_MESSAGES,
  serverMessages: core.SERVER_MESSAGES,
  closeCodes: core.CLOSE_CODES,
  welcomeKeys: core.WELCOME_MESSAGE_KEYS,
  refusalReasons: core.REFUSAL_REASONS,
  schemas: Object.fromEntries(Object.entries(CLIENT_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
  attempts: ATTEMPT_RULES,
  duels: DUEL_RULES,
  // The fields of `welcome`, which the page reads before anything else.
  welcome: Object.keys(core.welcome({ name: 'sky' }, 1)).toSorted(),
  server: { STARTER_NEEDS_TALK, SKILLS_NEED_STARTER },
  // The arena room's name, input, messages and pace: a client that streams faster or presses more is cut off or dropped.
  arena: {
    room: ARENA_ROOM,
    messages: core.ARENA_MESSAGES,
    clientMessages: core.ARENA_CLIENT_MESSAGES,
    pick: z.toJSONSchema(core.ArenaPickMessage),
    pickMs: core.ARENA_PICK_MS,
    betweenMs: core.ARENA_BETWEEN_MS,
    input: core.ARENA_INPUT_FIELDS,
    none: core.ARENA_NONE,
    tickRate: ARENA_TICK_RATE,
    subSteps: ARENA_SUB_STEPS,
    messagesPerSecond: ARENA_MESSAGES_PER_SECOND,
    pressesPerSecond: PRESSES_PER_SECOND,
  },
};

describe('the protocol contract', () => {
  it('has a recorded hash for this PROTOCOL_VERSION, so a contract change bumps the protocol', () => {
    const hash = core.stableHash(JSON.parse(JSON.stringify(contract)));
    expect(
      PROTOCOL_CONTRACTS[core.PROTOCOL_VERSION],
      `The client-server contract is now ${hash}. If you changed it, raise PROTOCOL_VERSION and record "${core.PROTOCOL_VERSION + 1}: '${hash}'" in PROTOCOL_CONTRACTS (packages/core/src/protocol.ts)`,
    ).toBe(hash);
  });
});
