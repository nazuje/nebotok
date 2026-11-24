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
  A new message or screen that matters for progress needs a picture, not only words.
- **Text** comes only from `content/strings.json` through `text(id, language)` in `src/strings.ts`,
  never a literal in code.
- **Own origin only.** The game loads fonts, images and data from its own server. The
  Content-Security-Policy refuses anything else, and the browser check fails on any outside request.
- **Sound.** Phaser's audio stays off. Effects are recipes in `content/sounds.json`, played by id
  with `sound.play('ui.tap')` from the page's one `createSound()` (`src/sound.ts`); add a recipe
  there rather than code a sound, and never load a sound file or URL. Web Audio starts on the first
  tap or key; every effect and haptic (`sound.vibrate(pattern)`, never `navigator.vibrate` itself)
  plays only while the player's sounds setting is on, and quieter under a voice clip. A button tap
  plays `ui.tap` by itself (`tapSounds`). Sounds made from content are played with
  `sound.playRecipe(label, recipe)`: babble while a talk line types (`src/sounds-talk.ts`, recorded
  as `talk.babble:<speaker>`, silent while "Read to me" reads the line) and creature cries
  (`src/sounds-creatures.ts`, recorded as `cry:<species>`) when a wild creature appears, a starter
  is picked, a creature is befriended and a creature comes onto the arena's island. Arena fights
  play their effects from the frame's events (`src/arena/arena-sounds.ts`), turn battles from
  their steps (`src/battle-sounds.ts`). No more than 6 sounds start in any 100 ms, babble and cries
  included (`src/sound-burst.ts`); `sound.play(id, 'keep')` marks one a burst drops last, such as
  a result. Under `?test=1` or in an automated browser sounds are made but never reach the
  speakers; the test hook's `sounds.played` lists the last 30 played, and `arena.sounds` every
  effect of the fight on screen.
  "Read to me" (`src/speech.ts`) plays the voice clips through one audio element
  (`src/clip-player.ts`), while the player has it on or taps a speaker button.
- **Test hook.** With `?test=1` only, `window.__nebotok` exposes `ready` (true once the map is
  drawn and the connection settled, with your own courier on it when connected), `stateAsText()`
  (JSON from `src/test-hook.ts`, including every player's tile and drawn position) and
  `tileToScreen(x, y)` (a tile's centre in CSS pixels). Scripts wait
  on `ready` and read state there; add a field to the snapshot when a test needs to see new state,
  and keep the hook read-only.
- **Battles and teams** (`src/battles.ts`): the server's messages feed `src/battle-model.ts`,
  which always draws from the latest `BattleView` and uses a turn's events only to animate it
  (`src/battle-playback.ts`). A turn plays at reading pace: each line stays up `LINE_MIN_MS`
  plus `LINE_MS_PER_CHARACTER`, at most `LINE_MAX_MS`, with its animations inside that time. A
  tap moves on to the next line and a second quick tap to the end of the turn; reduced motion
  keeps the timing and drops the movement. The browser check times one turn and taps through the
  rest (`untilTappingThrough` in `scripts/lib/game-page.mjs`). `src/battle-scene.ts` draws the field;
  the battle, team and starter screens are HTML. Creature pictures come only from `creatureTexture` and
  `creaturePortrait` in
  `src/creature-art.ts`; the field's background comes from `src/battle-backdrop.ts`. Every battle
  is the server's: the browser check plays them against the real server (`scripts/lib/battle-check.mjs`).
- **Arena fights** (`src/arena/`, rules in `docs/arena.md`): `arena-link.ts` joins the fight's own
  room and sends the player's input 30 times a second; `arena-scene.ts` draws the room's state
  every frame and uses its events only for flashes. The stick, buttons, keys and Leave are HTML
  (`arena-controls.ts`), each button at least 64px. `scripts/arena-check.mjs` plays a real fight
  in both browsers at verify level 4.
- **World drawing.** `src/world-feed.ts` copies the room's state into the view model
  (`src/world-view.ts`), which `src/world-scene.ts` reads every frame. Others are drawn
  `OTHERS_DELAY_MS` in the past along their `src/track.ts` so each step is smooth; prediction of
  your own courier lives in the view model too (`src/self-walker.ts`), not the scene. Names over
  couriers are HTML (`src/names.ts`).
- **Art** comes from `content/art/`, bundled by `src/sprites.ts`, which makes each sprite a
  Phaser texture with its frames and animations; `src/tileset-art.ts` draws and animates map
  tilesets. Never hard-code pixels or load an image by URL; add a sprite (`docs/art.md`). HTML
  screens show pictures with `pictureIcon(id, sizePx)` (the picture kit, `content/art/pictures/`)
  and `weatherIcon(type, sizePx)` from `src/pictures.ts`, hidden from screen readers unless given
  a `label`.
- **Input** (`src/input.ts`) sends every movement command through `src/outbox.ts`, which keeps
  a page under the server's message limits however fast it is tapped or mashed. Battle, talk,
  skill and board requests go through the page's one `src/request-pacer.ts` for the same reason,
  and a screen waiting on one gives up after its `ANSWER_MS`, since the server drops extras
  without an answer. The browser check taps a talk through 8 times a second (`hurryThrough`).
- Unit tests for pure helpers go in `test/` (`npx vitest run --project game-unit`); anything that
  needs a page is the browser check at verify level 4.
