# Scenes

A scene is a short script of several players playing at once, for a quick try-and-look loop:
`npm run scene -- scripts/scenes/<name>.json` plays it against this worktree's `npm run dev`
(or `--url http://127.0.0.1:<port>` for a built server, `npm start` after `npm run build`), and
saves what each player sees in `.proof/scenes/<name>/`. Start from one of the examples here.
Scratch scenes can live under `.proof/`, which git ignores. `scripts/lib/scene-file.mjs` is the
schema; the scene is refused, before any browser starts, when it does not fit.

```json
{
  "name": "my-scene",
  "about": "What the scene shows, in a sentence.",
  "players": [{ "id": "lan", "name": "Scena Lan", "browser": "chromium", "device": "iphone-portrait", "language": "en" }],
  "steps": [{ "do": "join", "player": "lan", "shot": "joined" }]
}
```

`name` matches the file name. **Players** are invented test profiles, made the first time a scene
runs and logged in by `name` after that. `avatar` is an id from `content/avatars.json` and `pin`
four digits; both are optional. `browser` is `chromium` or `webkit`, `device` is `iphone-portrait`
or `ipad-landscape`, and `language` is `en` or `sl`; each defaults to the first.

**Steps** run in order, each finished before the next starts. A player's first step is their `join`.

| Step | What it does |
| --- | --- |
| `{ "do": "join", "player": "lan" }` | Opens the player's page signed in, and waits until their courier stands in the world. A player with no creature yet first walks to the character the page points them to, talks until the starters are offered, and takes the first. |
| `{ "do": "walk", "player": "lan", "to": { "x": 19, "y": 10 } }` | Taps the on-screen tile nearest the target on foot, waits for the courier to stop, and repeats until it stands there. |
| `{ "do": "tap", "player": "lan", "tile": { "x": 19, "y": 17 } }` | One tap on a tile that is on screen, without waiting for the walk. The tile may be one no courier can stand on, to see the refusal. |
| `{ "do": "hold", "player": "lan", "direction": "right", "ms": 600 }` | Holds an arrow key that long. |
| `{ "do": "wait", "ms": 1000 }` | Waits. |
| `{ "do": "waitFor", "player": "lan", "until": { ... }, "ms": 15000 }` | Waits until the player's page shows everything in `until`, and fails after `ms` (15 s when left out). |
| `{ "do": "reload", "player": "lan" }` | Reloads the page and waits until the player is back in the world. |
| `{ "do": "drop", "player": "lan", "ms": 3000 }` | Cuts the page's game connection and refuses new ones for `ms`; then the page reconnects by itself. Returns at once, so the next steps run during the outage. |
| `{ "do": "meet", "player": "lan" }` | Walks to the tall grass nearest the spawn and steps about in it until the server sends a wild creature, then waits until the battle offers a choice, tapping the field to move its lines on. |
| `{ "do": "fight", "player": "lan", "slot": 3 }` | In a battle, taps the move in `slot` (0 to 3, the first when left out) and waits until the turn has played, tapping the field to move its lines on. Slot 3 is each starter's weather call, which does no damage, so the battle goes on. |
| `{ "do": "run", "player": "lan" }` | Runs from the battle (or plays on when running is not allowed), continues past the result and waits until the player is back in the world. |
| `{ "do": "talk", "player": "lan", "npc": "bavko" }` | Taps the character (an id from `content/npcs.json`; the page walks up to them, walking closer by taps first when they are off screen) and plays the talk to its end: each line is waited for until it is typed out, then a tap goes on, taking the first choice. With `"open": true` it stops once the first line is typed out and leaves the talk open; a later `talk` to the same character goes on from there. |

`until` takes any of these:

- `"connection": "connected"`, or another status of the page's badge.
- `"settled": true`: the player's own courier stands still.
- `"at": { "x": 19, "y": 10 }`: it stands still there.
- `"sees": ["zarja"]` / `"away": ["zarja"]`: those players are shown connected / dimmed as away.
- `"seesAt": { "zarja": { "x": 20, "y": 10 } }`: those players are shown standing on those tiles.
- `"tagsApart": true`: no name tag on the page covers another.
- `"unmarked": true`: no walk marker is shown.
- `"welcome": ["together", "hidden"]`: the welcome line at the bottom says one of these (`"alone"`,
  `"together"`) or is `"hidden"`.
- `"toast": "blocked"`: the short message at the bottom says the tapped tile cannot be reached
  (`walk.blocked`), or `"hidden"`: no short message shows.
- `"hint": "tap"` / `"joystick"`: the first-visit walking hint shows for those controls, or
  `"hidden"`: it does not. Each scene browser starts with fresh storage, so a player sees it until
  their first walk.
- `"battle": "menu"`: the player's own battle waits for a choice, or `"none"`: no battle shows.
- `"sameBattle": true`: the battle shown is the one their last `meet` started, as after a reconnect.
- `"battling": ["zarja"]` / `"calm": ["zarja"]`: those players' name tags carry the battle mark /
  do not.
- `"talking": ["zarja"]` / `"quiet": ["zarja"]`: those players' name tags carry the speech mark of
  someone talking to a character / do not.
- `"talk": "open"` / `"none"`: the player's own talk box is open / closed.

A wild battle that starts outside a `meet` is run from and noted, so a scene about walking is not
stopped by the tall grass. A `waitFor` with `battle` or `sameBattle` waits in the battle instead.

Any step may add `"shot": "<label>"`: after it, every joined player's screenshot and
`stateAsText()` are saved as `<step>-<label>-<player>.png` and `.json`. The run ends with each
player signed out, and fails on any console error, page error, failed or outside request.

Gotchas:

- The page reconnects after a drop only once its room has been up for 5 seconds (the SDK's
  `minUptime`), so `wait` 5000 after the last `join` before a `drop`.
- Tiles are map coordinates (`content/maps/<id>.tmj`); a `walk` to a tile no courier can stand on
  is refused.
- Test players' positions are saved like anyone's, so a second run starts them where the first
  ended. Begin with a `walk` to put each one where the scene needs them.
- `npm run dev`'s database is `.local-data/`, so test players stay in its profile list. The game
  allows 20 profiles; reuse the example names rather than inventing new ones each run.
