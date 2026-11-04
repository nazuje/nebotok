---
name: add-content
description: Add or change Nebotok game content in content/ (strings, creatures, moves, items, islands, dialogue). Use when adding words players see, translating, or adding a new kind of content file.
---

# Add content

Content is data, never code: the rules in `packages/core` read it, and every file in `content/`
is checked against a zod schema in `CONTENT_SCHEMAS` (`packages/core/src/content.ts`).
Read `content/AGENTS.md` first: it holds the writing rules for both languages.

1. **A new entry in an existing file:** add it with both `en` and `sl` text (`LocalizedText`).
   A string the game needs at startup also goes in `REQUIRED_STRING_IDS`.
2. **A new kind of content:** write its schema in `packages/core/src/content.ts` with
   `z.strictObject`, bounded strings and numbers, and `LocalizedText` for anything a player reads.
   Register it in `CONTENT_SCHEMAS` under its file name, add a unit test in `packages/core/test/unit/`
   with one good and one bad example, then add the file.
3. Names, creatures and art are original: never a name, character or look taken from a commercial
   game. Nothing refers to real people.
4. Run `npm run content:validate`, then `npm run verify -- --level 1` (golden replays show whether
   rule behaviour moved). When text the player sees changed, run the `playtest` skill and look at the
   Slovenian screenshots for text that overflows its box. Done when both pass and the screenshots
   show the new text fitting in both languages.
5. Report every Slovenian line you wrote: a native speaker must still read them.
