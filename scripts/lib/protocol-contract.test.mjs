import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as core from '../../packages/core/src/index.ts';
import { PROTOCOL_CONTRACTS } from '../../packages/core/src/protocol.ts';
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
};

const contract = {
  clientMessages: core.CLIENT_MESSAGES,
  serverMessages: core.SERVER_MESSAGES,
  closeCodes: core.CLOSE_CODES,
  welcomeKeys: core.WELCOME_MESSAGE_KEYS,
  refusalReasons: core.REFUSAL_REASONS,
  schemas: Object.fromEntries(Object.entries(CLIENT_SCHEMAS).map(([name, schema]) => [name, z.toJSONSchema(schema)])),
  server: { STARTER_NEEDS_TALK },
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
