---
name: playtest
description: Play Nebotok in headless, muted browsers and judge what a player sees. Use after changing anything visible or interactive in apps/game, a server change a player would notice, or when asked to playtest or check the game on phone or tablet.
---

# Playtest

Proof that the game works as a player meets it, with screenshots you have actually opened.

1. Run `npm run verify -- --level 4`. It builds, starts the real server, and plays the page in
   Chromium and WebKit on an iPhone in portrait and an iPad in landscape, in English and Slovenian
   (`scripts/browser-check.mjs`). Done when the run exits 0, or each failing step is a finding.
2. Open every screenshot under `.proof/<sha>/screenshots/` with your file-reading tool, and note in
   one line what each shows. Done when you can name each file and say whether it looks right: text
   inside its box, no sideways scroll, touch targets at least 48px, Slovenian with no English left.
3. When the change has behaviour the browser check does not drive (a new control, a new screen, a
   flow across scenes), write a short Playwright script under `.proof/playtest/` (git ignores
   `.proof/`) and drive it the way a player would:
   - Launch only with `chromiumLaunchOptions` / `webkitLaunchOptions` from
     `scripts/lib/launch-options.mjs`: headless, muted, with the WebGL fallback.
   - Start the server with `startServer()` from `scripts/lib/server-process.mjs` after
     `npm run build`, and open `<base>/?test=1`. Pick the language the way `browser-check.mjs`
     does: an init script that sets `localStorage['nebotok:language']` to `"en"` or `"sl"`.
   - Wait for `window.__nebotok.ready`, read state from `window.__nebotok.stateAsText()`, and act
     through real input: `page.touchscreen.tap` with `hasTouch`, pointer and keyboard.
   - Fail on any `pageerror`, console error or request that leaves the page's own origin.
   - Screenshot the moment the change matters, and open each screenshot.
   Done when every new behaviour has been driven once on a phone and once on a tablet, in both
   languages.
4. Report: the `.proof/<sha>/summary.json` step results, each screenshot you opened with what it
   showed, and what no script can check (a real iPad or iPhone, real sound, native Slovenian, game
   feel).

For a new feature or a big change, also hand the game to the fresh-context `game-tester` subagent
(`docs/agents/game-tester.md`) with a note of what changed.
