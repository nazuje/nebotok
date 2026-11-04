---
name: change-save-format
description: Change the shape of saved player or world data in Nebotok. Use when adding, removing, renaming or retyping any field a save holds (packages/core/src/save.ts), or when a save test or fixture fails.
---

# Change the save format

Saves outlive code: a child's progress from last month must load in every later version. Any change
to the shape of saved data is a new **version** with a **migration** and a **fixture**. Old versions
and their fixtures are permanent; they are history, not drafts.

Everything lives in `packages/core/src/save.ts`, its fixtures in `packages/core/fixtures/saves/`
and its tests in `packages/core/test/saves/saves.test.ts`.

1. Copy the current schema to `SaveDataV<N+1>` and make the change there. `SaveDataV<N>` stays
   exactly as it was.
2. Raise `SAVE_VERSION` to N+1, point `SaveData` at the new schema and add `N+1` to `SAVE_SCHEMAS`.
3. Add `migrations[N]`: a pure function from version N data to version N+1 data. It fills new
   fields with a sensible default, never asks the player, and never reads the clock or `Math.random`
   (pass anything like that in as data).
4. Add `packages/core/fixtures/saves/v<N+1>/` with at least one realistic save, including one with
   Slovenian characters (č, š, ž) in the name. Fixture names are invented; never a real child's name.
5. Run `npm run verify -- --level 2`. The save tests load every fixture of every version through
   `migrateSave` and check that each version has its directory, schema and migration. Done when the
   level passes with every older fixture still loading.
6. When a change cannot be migrated (data would be lost), stop and ask the owner before going on.

The commit message says what changed in the save and why, for example "Save each player's home
island position (save v2)".
