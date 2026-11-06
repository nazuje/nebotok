# packages/core

Every game rule lives here, and it must give the same answer anywhere it runs: on the server now,
in the browser later.

- **Determinism contract.** Same seed and same commands, same result, on every machine. Randomness
  comes only from an RNG passed in (`createRng` / `rngFromState` in `src/rng.ts`); the current time
  comes in as an argument. Iterate in a fixed order (sort keys before hashing or looping when order
  matters). `Math.sin`, `Math.exp` and similar may differ between JavaScript engines; keep them out
  of rules, and prefer integer maths.
- **Boundary.** The only package core may import is `zod`; `npm run core:boundary` enforces it. The
  tsconfig has no DOM or Node types, so a stray `window` or `process` fails the type check.
- **Golden replays** (`fixtures/golden/*.json`) record the hash that a seed and a list of commands
  must produce. A changed hash means rule behaviour moved. Before running `npm run golden:update`,
  find which rule changed and why, confirm the change was intended, and say so in the commit
  message. A hash that changes from a refactor is a bug. Battle goldens (`fixtures/golden/battle/`)
  replay against a frozen copy of the creature content in `fixtures/golden/battle/content/` (with
  `items.json` and `befriending.json`), not `content/`, so editing the real creatures never moves them. Change the frozen copy only
  to exercise new rules, and re-record the goldens with it. The property tests in `test/property`
  battle on the live `content/creatures/`, so every new creature is still played.
- **Battles** live in `src/battle/`: `battleStep(state, actions, rng, content)` is a pure step that
  returns the next state and the events the client animates. Bots in `bots.ts` drive the tests, and
  `node scripts/battle-sim.mjs` prints how greedy and random bots fare against each other, and how
  each species and weather type fares one on one (`roundRobin` in `simulate.ts`).
- **Wild creatures and progress:** `rollEncounter` (`src/encounter.ts`), `befriendChance`
  (`src/befriend.ts`), team, storage, treat and shrine rules (`src/creatures.ts`, pure functions on a
  `Progress`) and experience (`src/growth.ts`). The payloads of the battle and team messages, and
  `battleView`, are in `src/messages.ts`; `docs/protocol.md` explains the flow.
- **Saves** live in `src/save.ts`. Changing their shape follows the `change-save-format` skill.
- **Content schemas** live in `src/content.ts`. Adding a kind of content follows the `add-content`
  skill.
- Tests: `test/unit` (level 0), `test/property` with fast-check and `test/golden` (level 1),
  `test/saves` (level 2).
