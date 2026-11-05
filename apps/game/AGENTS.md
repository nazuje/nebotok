# apps/game

The browser client: Vite, Phaser 4 for the world and battles, HTML for everything else. Read the
Phaser skills (`scenes`, `input-keyboard-mouse-touch`, `scale-and-responsive` and others) before
changing Phaser code, and use Phaser 4 APIs only.

- **The client predicts and draws; the server decides.** Rules come from `@nebotok/core`. The client
  sends requests and shows what the server's state says.
- **Interface is HTML over the canvas** (`src/hud.ts`, `index.html`, `src/style.css`): menus,
  dialogue, inventory and every piece of text. Phaser draws only the world.
- **Touch first.** Every control is at least 48 by 48 CSS pixels, works by tap alone (no hover, no
  keyboard needed), and nothing scrolls sideways at 360px wide. The browser check fails on either.
- **Text** comes only from `content/strings.json` through `text(id, language)` in `src/strings.ts`,
  never a literal in code.
- **Own origin only.** The game loads fonts, images and data from its own server. The
  Content-Security-Policy refuses anything else, and the browser check fails on any outside request.
- **Sound** never plays unasked: Phaser starts with audio off until sound is designed in.
- **Test hook.** With `?test=1` only, `window.__nebotok` exposes `ready` (true once the map is
  drawn and the connection settled, with your own courier on it when connected), `stateAsText()`
  (JSON from `src/test-hook.ts`, including every player's tile and drawn position) and
  `tileToScreen(x, y)` (a tile's centre in CSS pixels). Scripts wait
  on `ready` and read state there; add a field to the snapshot when a test needs to see new state,
  and keep the hook read-only.
- **World drawing.** `src/world-feed.ts` copies the room's state into the view model
  (`src/world-view.ts`), which `src/world-scene.ts` reads every frame. Others are drawn
  `OTHERS_DELAY_MS` in the past along their `src/track.ts` so each step is smooth; prediction of
  your own courier lives in the view model too (`src/self-walker.ts`), not the scene. Names over
  couriers are HTML (`src/names.ts`).
- **Input** (`src/input.ts`) sends every movement command through `src/outbox.ts`, which keeps
  a page under the server's message limits however fast it is tapped or mashed.
- Unit tests for pure helpers go in `test/` (`npx vitest run --project game-unit`); anything that
  needs a page is the browser check at verify level 4.
