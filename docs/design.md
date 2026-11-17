# Nebotok design

Nebotok is an original 2D top-down pixel-art adventure about befriending creatures across floating
sky islands, played together in one shared family world. This page is the agreed design. Details
will keep changing as the game is built and as the kids invent things; when a decision changes,
change it here.

## Who plays, and how it should feel

The players are aged 8 to 16, and they include children who can't read yet. The game should feel
like something rated PEGI 7 to 12: battles are cartoon battles where creatures faint and go to
rest, with no blood and no death, but spooky places and real villains are welcome.

- Mostly played on iPhones and iPads, so everything is designed for touch first. A laptop with a
  keyboard and mouse works too.
- Playable without reading. Every message that matters for progress has a picture or animation
  that carries its meaning with the sound off, and text is a bonus for readers.
- Text in English and Slovenian. Characters "talk" in short babble sounds while their words
  appear. Important lines can also be read aloud with "Read to me": a computer voice now, and the
  owner's recorded voice for the main characters later.

## The story

You are a new courier for the Sky Post, carrying letters and parcels between floating islands. As
you deliver, you slowly uncover why a great storm is swallowing the outer islands. The storm
villain's working name is Oblakojed, the cloud-eater. The details of the story will be invented
together with the kids.

## Creatures and battles

Battles are real-time fights in an arena: a round floating sky island seen from above. Turn
battles stay in the game until the arena replaces them (the switch-over, see
[phases.md](phases.md)). The rules and numbers are in [arena.md](arena.md); why turns go is in
[decisions/0001-real-time-arena.md](decisions/0001-real-time-arena.md).

- You carry up to 6 creatures. In a wild fight your lead creature fights one wild creature. Swap
  brings in the next one (every 5 s at most), and a fainted creature is replaced by the next.
- Creatures walk, dash and get knocked about. You win by knocking the other creature out, or off
  the island (a ring-out). A knock pushes further the more health is lost.
- From 20 s a storm eats the island's edge: a 2 s warning, then a step every 10 s, down to a
  quarter of the island.
- There are 6 weather types: Sun, Gale, Rain, Frost, Storm and Bloom. Each is strong against some
  and weak against others, and the weather on the island changes how moves work. Levels and the
  weather chart still matter; dodging, timing and position decide close fights.
- A creature keeps every move it learns. Each move has a kind (quick, about 1 s to cool down;
  special, about 6 s; weather ultimate, about 20 s) and one of 13 shapes (bolt, spray, cone, snare,
  lunge, burst, puddle, shield, strike, wall, freeze, zone, weather). Before a fight the player puts
  one learned move on each button: the loadout.
- Button 1 is there from the start. **Buttons 2 and 3 unlock at levels 7 and 12.**
- Controls: a floating stick on the left, buttons on the right, each at least 64 px; WASD or
  arrows, 1, 2, 3, Space to dash, E for a treat and Q to swap. Abilities go where the creature
  faces, with a little aim help.
- **Befriending:** when the wild creature is worn down, a Treat button appears. Throw it: a hit
  befriends, a miss lies on the ground to be picked up. A favourite or liked treat is easier to hit
  and works sooner; a cooked treat a little sooner still. **A creature knocked off the island cannot
  be befriended:** it floats away, and you win with XP but no new friend.
- **Trainer fights and duels** are best of 3: each side picks 3 creatures, one creature a round.
  **For now there is one placeholder trainer, Vetrinka**, so best of 3 can be built and tested; the
  kids' own trainers replace her on their design day.
- **The turtle setting** makes fights easier for one player: you take less damage, and the
  computer's creatures are slower and gentler. **It is allowed in duels,** where both players see a
  turtle badge on that creature.
- If your whole team faints, you wake at the last shrine you visited with your team healed, and you
  lose nothing. This may change.
- Fights are playable without reading: a picture for every shape, kind and button, and no words
  needed to fight, pick a loadout or answer a duel.

The owner settled the four open questions of the plan (#116, #141) as written above in bold. They
may change later.

## Skills

Skills are inspired by RuneScape and start small: fishing, foraging and cooking first, and building
later, with home islands (Slice D). They feed each other: fishing and foraging give ingredients,
cooking turns them into treats for befriending, and building will shape your home island.

- Each skill has levels with skill XP, 1 to 20 for now, about 2 to 3 hours of play to the top, with
  early levels fast. Levels unlock new spots and recipes.
- Every gather or cook is a tiny game of 3 to 5 seconds: tap when the float dips (fishing), tap the
  shiny bits before they fade (foraging), stop a moving marker in the good zone (cooking). Failing
  only means you try again; nothing is lost. The games work by touch alone and by keyboard, and
  honour reduced motion.
- Each player has their own spots: gathering from one rests it for you only, and others see you
  gathering.
- Cooking uses a recipe book that grows with your cooking level, at a cooking pot on the island.
  Cooked treats make befriending easier; Tobolko's Plain Treats stay as a fallback.
- The Sky Post job board shows 3 jobs, and a new one appears whenever you finish one. Rewards are
  items and skill XP, given the moment a job is done. There is no currency and no shop, and items
  are never discarded: a full stack stops gathering more of that item.

## Together

- One shared world on a server, where everyone sees each other walking around.
- Each player has their own story progress, as in RuneScape, plus occasional shared world events
  everyone takes part in.
- Trading.
- Friendly duels: tap another player to ask, and they accept or decline with one tap. Both go to a
  duel island, and others can watch. No treats, nothing lost, and a little XP for both. An
  even-match setting (on by default) sets every creature to the same level, so a younger and an
  older player can have a fair fight.
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
- **The server** runs on Node 26 with Colyseus 0.18 and decides everything. Profiles and saves go
  to SQLite through Node's built-in `node:sqlite` (no native add-on to install), backed up
  continuously with Litestream, from Phase 1.
- **The game** is built with Vite. Phaser 4 draws the world and the battles; menus, dialogue and the
  inventory are HTML overlays on top, which are easier to make readable, accessible and translated.
- **Maps** are drawn in Tiled with 16×16 pixel tiles.
- **Art** comes from pixel grids drawn in code until the art test, so the game is playable from the
  start and real art replaces images, not rules.
- **Content is data.** Creatures, moves, items, skills, quests, dialogue and maps are data files
  checked against schemas, so the game grows by adding data, not code.
- **Saves carry a version**, and every change to their shape comes with a migration, so old saves
  always load.
- **Deployment:** one Docker image, run with Docker Compose on the family Mac mini and shared on
  the tailnet by the Mac's own `tailscale serve` over HTTPS (a Tailscale sidecar container is an
  option for later). The game installs as an app (a PWA). CI builds
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

- The art method: an art test after Slice F of Phase 2 decides it (see [phases.md](phases.md)).
- Music.
- Offline solo mode.
- Free chat.
- Automatic updates of the Mac mini.
- Automatic login on the Mac mini: FileVault stays on for now.
