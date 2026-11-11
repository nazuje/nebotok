import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as core from '../../packages/core/src/index.ts';
import { PROTOCOL_CONTRACTS } from '../../packages/core/src/protocol.ts';
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
};

// The timing rules a skill attempt is judged by: a client that times its taps differently is judged wrong.
const ATTEMPT_RULES = {
  MIN_ATTEMPT_MS: core.MIN_ATTEMPT_MS,
  CLOCK_SLACK_MS: core.CLOCK_SLACK_MS,
  GRACE_MS: core.GRACE_MS,
  LATE_MS: core.LATE_MS,
  SPARKLE_FIRST_MS: core.SPARKLE_FIRST_MS,
  SPARKLE_PLACES: core.SPARKLE_PLACES,
  MAX_TAPS: core.MAX_TAPS,
  MAX_TAP_MS: core.MAX_TAP_MS,
  MARKER_TRACK: core.MARKER_TRACK,
  MARKER_MARGIN: core.MARKER_MARGIN,
};

const contract = {
  clientMessages: core.CLIENT_MESSAGES,
  serverMessages: core.SERVER_MESSAGES,
  closeCodes: core.CLOSE_CODES,
  welcomeKeys: core.WELCOME_MESSAGE_KEYS,
  refusalReasons: core.REFUSAL_REASONS,
  schemas: Object.fromEntries(Object.entries(CLIENT_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
  attempts: ATTEMPT_RULES,
  server: { STARTER_NEEDS_TALK, SKILLS_NEED_STARTER },
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
