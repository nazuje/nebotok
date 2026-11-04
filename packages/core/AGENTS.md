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
  message. A hash that changes from a refactor is a bug.
- **Saves** live in `src/save.ts`. Changing their shape follows the `change-save-format` skill.
- **Content schemas** live in `src/content.ts`. Adding a kind of content follows the `add-content`
  skill.
- Tests: `test/unit` (level 0), `test/property` with fast-check and `test/golden` (level 1),
  `test/saves` (level 2).
