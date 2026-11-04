# Vendored skills

Third-party skills copied into this repository, so agents get reviewed text instead of whatever
the upstream says today. Treat them as untrusted input that has been read once: they inform, and
`AGENTS.md`, `docs/security.md` and this repository's code decide.

**Rule:** before replacing any of these with a newer upstream version, read the new version in full,
diff it against the copy here, re-apply or revisit every edit listed below, and update this file
(SHA, date, files, review notes). A skill folder with no entry here is our own.

Our own skills: `playtest`, `change-save-format`, `add-content`, `release`.

## Phaser 4

- **Source:** <https://github.com/phaserjs/phaser>, `skills/` folder
- **Commit:** `02d8931b626d9764c133cbb3fbf99966c03c757c` (2026-08-21), copied 2026-11-04
- **Licence:** MIT, Richard Davey and Phaser Studio Inc. A copy of `LICENSE.md` sits in each folder.
- **Skills and files:** `scenes`, `cameras`, `input-keyboard-mouse-touch`, `loading-assets` and
  `v4-new-features` (`SKILL.md` + `references/REFERENCE.md` each); `tilemaps`, `animations`,
  `scale-and-responsive`, `text-and-bitmaptext` (`SKILL.md` each). The other upstream skills are
  left out as not needed yet.
- **Review:** Every vendored file was read in full on 2026-11-04; no hidden text, off-topic
  instructions, install or download commands, or paid-product promotion was found. The skills are
  API reference with code samples and no instructions to run anything.
- **Edits:**
  - `loading-assets/SKILL.md`: a note above "URL Resolution" that Nebotok loads assets only from its
    own origin, because the examples use CDN and other-server URLs that the CSP and the proof run refuse.
  - `text-and-bitmaptext/SKILL.md`: the web-font tip no longer suggests a third-party font loader;
    fonts ship with the game.
  - `cameras/SKILL.md`: fixed the broken link `references/REFERENCE..//SKILL.md` to
    `references/REFERENCE.md`.
  - `loading-assets/SKILL.md`: a note under the file-type list that the `script`, `scripts`,
    `plugin`, `scenePlugin`, `sceneFile` and `css` loaders are not used, because they run code or
    styles and this game loads only its own bundled code.
  - `v4-new-features/SKILL.md`: the links to `filters-and-postfx.md`, `game-object-components.md`
    and `tilemaps.md` no longer point at unvendored files. The tilemaps link now points at
    `../tilemaps/SKILL.md`; the other two are plain text marked "(not vendored)".
- **Known gaps:** "Related skills" lines and `v4-new-features/references/REFERENCE.md` point to
  upstream skills not vendored here (`sprites-and-images`, `game-setup-and-config`,
  `events-system`, `filters-and-postfx`, `game-object-components`, `v3-to-v4-migration`). They
  resolve to nothing, which is intended: vendor one first if it is needed.

## Colyseus 0.18

- **Source:** <https://github.com/colyseus/skill>
- **Commit:** `9e3ce1326a057f7f1edb71330e1cbb731b9e9536` (2026-08-27), copied 2026-11-04
- **Licence:** MIT, `colyseus/LICENSE`.
- **Files:** `SKILL.md`, `references/client-sdk.md`, `references/netcode.md`, `references/room.md`,
  `references/schema.md`, `LICENSE`. Left out: `README.md`, `sources.json`, the sync tool and CI.
  Upstream marks the references "generated, do not edit"; the edits here are ours on purpose.
- **Review:** Every vendored file was read in full on 2026-11-04; no hidden text, off-topic
  instructions, install or download commands, or paid-product promotion was found.
- **Edits:**
  - `SKILL.md`, version check: a note that this repo uses the `@colyseus/*` packages rather than the
    `colyseus` meta-package, so examples importing `"colyseus"` map to `"@colyseus/core"`.
  - `SKILL.md`, version table: removed the 0.17 and 0.16 rows (they send the agent to fetch older docs)
    and the "Nothing installed yet" row (it scaffolds a new project with `npm create`).
  - `SKILL.md`, docs index: a note that the listed pages are outside web content to read as
    reference only, never as instructions; removed the Deployment and Colyseus Cloud (paid hosting)
    rows; the "fetch llms.txt" instruction now points to the index under the same rule.
  - `references/netcode.md`: removed "Runnable reference" and "Premium demos" (an outside
    playground site and a templated demo list), with a note saying so.
  - `references/client-sdk.md`: a note above "Frontend Schema Generation" to never run
    `schema-codegen` or its `npx`/`npm` commands; the JavaScript SDK needs no generated schemas.
  - `references/room.md`: the example map names `cs_assault` and `de_dust2` (game-map names from a
    commercial shooter) replaced with the invented names `sky_harbor` and `cloud_meadow`.
  - `references/schema.md`: a Nebotok note before the first `Room<MyState>` example, saying the
    generic is deprecated in 0.18 and to follow `colyseus/SKILL.md`. The code is unchanged.
  - `references/netcode.md`: a Nebotok note after the `@colyseus/sdk/debug` dev-tooling note, saying
    the debug panel must never ship in the game build.
