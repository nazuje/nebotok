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
- **Test hook.** With `?test=1` only, `window.__nebotok` exposes `ready` (true once the island is
  drawn and the connection settled) and `stateAsText()` (JSON from `src/test-hook.ts`). Scripts wait
  on `ready` and read state there; add a field to the snapshot when a test needs to see new state,
  and keep the hook read-only.
- Unit tests for pure helpers go in `test/` (`npx vitest run --project game-unit`); anything that
  needs a page is the browser check at verify level 4.
