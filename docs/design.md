# Nebotok design

Nebotok is an original 2D top-down pixel-art adventure about befriending creatures across floating
sky islands, played together in one shared family world. This page is the agreed design. Details
will keep changing as the game is built and as the kids invent things; when a decision changes,
change it here.

## Who plays, and how it should feel

The players are aged 8 to 16. The game should feel like something rated PEGI 7 to 12: battles are
cartoon battles where creatures faint and go to rest, with no blood and no death, but spooky places
and real villains are welcome.

- Mostly played on iPhones and iPads, so everything is designed for touch first. A laptop with a
  keyboard and mouse works too.
- Text in English and Slovenian. There is no recorded speech; characters "talk" in short babble
  sounds while their words appear.

## The story

You are a new courier for the Sky Post, carrying letters and parcels between floating islands. As
you deliver, you slowly uncover why a great storm is swallowing the outer islands. The storm
villain's working name is Oblakojed, the cloud-eater. The details of the story will be invented
together with the kids.

## Creatures and battles

- You carry up to 6 creatures. They battle one at a time and you can switch freely.
- Each creature knows 4 moves.
- There are 6 weather types: Sun, Gale, Rain, Frost, Storm and Bloom. Each is strong against some
  and weak against others, and the weather on the battlefield changes how moves work.
- A wild creature joins you after a battle when you offer it a treat you cooked or foraged. A tired
  creature, or its favourite treat, raises the chance.
- If your whole team faints, you wake at the last shrine you visited with your team healed, and you
  lose nothing. This may change.

## Skills

Skills are inspired by RuneScape and start small: fishing, foraging, cooking and building. They feed
each other: fishing and foraging give ingredients, cooking turns them into treats for befriending,
and building shapes your home island.

## Together

- One shared world on a server, where everyone sees each other walking around.
- Each player has their own story progress, as in RuneScape, plus occasional shared world events
  everyone takes part in.
- Trading, and friendly duels with an optional even-match setting that scales levels so a younger
  and an older player can have a fair fight.
- Talking with preset phrases and emotes in both languages. Free chat may come later.
- Each player owns a home island that others can visit when invited.

## Identity

Each player has a profile with an avatar, a display name and an optional 4-digit PIN. A parent can
reset a PIN. Names live only in the server's database, never in this repository. Tailscale is the
front door: only devices on the family's tailnet can reach the game at all.

## Technology

- **One repository, npm workspaces.** `packages/core`, `apps/server` and `apps/game`.
- **All rules live in `packages/core`**, in plain TypeScript with no game engine, browser, Node or
  network code. The rules are deterministic, with a seeded random number generator passed in, so the
  same code runs on the server now and in the browser later, for an offline solo mode and for
  prediction. This is the "Minecraft integrated server" model: single player is the same server,
  running locally.
- **The server** runs on Node 26 with Colyseus 0.18 and decides everything. Saves go to SQLite
  (better-sqlite3), backed up continuously with Litestream, from Phase 1.
- **The game** is built with Vite. Phaser 4 draws the world and the battles; menus, dialogue and the
  inventory are HTML overlays on top, which are easier to make readable, accessible and translated.
- **Maps** are drawn in Tiled with 16×16 pixel tiles.
- **Content is data.** Creatures, moves, items, skills, quests, dialogue and maps are data files
  checked against schemas, so the game grows by adding data, not code.
- **Saves carry a version**, and every change to their shape comes with a migration, so old saves
  always load.
- **Deployment:** one Docker image, run with Docker Compose next to a Tailscale sidecar on the
  family Mac mini, with HTTPS from `tailscale serve`. The game installs as an app (a PWA). CI builds
  and signs the image, and one command updates the Mac mini. See [deploy.md](deploy.md) and
  [security.md](security.md).

### Engine rule

If Phaser 4 blocks us with a bug that does not get fixed, or gets no updates for about a year, the
drawing code moves to PixiJS v8. Keeping every rule in `packages/core` and the interface in HTML is
what keeps that move small.

### Why not Go on the server

At family scale Node is plenty fast, and with Node the rules are written once and shared by the
server and the browser. Go would mean writing every rule twice.

## Deferred on purpose

- The art method: an art test in Phase 4 decides it.
- Music.
- Offline solo mode.
- Free chat.
- Automatic updates of the Mac mini.
- Automatic login on the Mac mini: FileVault stays on for now.
