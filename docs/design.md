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
  the island (a ring-out). A knock pushes further the more health is lost, and only a creature
  below half its health can be knocked off; the storm can still drop anyone.
- Losing a wild fight sends your team home rested: every creature is back to full health. A won
  fight keeps the health it left.
- From 20 s a storm eats the island's edge: a 2 s warning, then a step every 10 s, down to a
  quarter of the island.
- There are 6 weather types: Sun, Gale, Rain, Frost, Storm and Bloom. Each is strong against some
  and weak against others, and the weather on the island changes how moves work. Levels and the
  weather chart still matter; dodging, timing and position decide close fights.
- In the arena the weather chart is softer: a strong hit does 1.5 times the damage and a weak one
  0.75 times (2 and 0.5 times in turn battles), so skill decides more.
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
  duel island, and others can watch. No treats, nothing lost, and a little XP for both, except
  for a player who gives up in the first round. An even-match setting (on by default) sets every
  creature to the same level, so a younger and an older player can have a fair fight.
- Talking with preset phrases and emotes in both languages. Free chat may come later.
- Each player owns a home island that others can visit when invited.

## Real world

Some quests happen away from the screen, in the real world. They are optional bonus content: the
main story never needs one, and there are no streaks, no daily pressure and no "you missed it".
Their rewards are special, never raw power: unique looks, decorations and your own drawn creature.
Why proof works this way, and what the build must do to keep photos safe, is in
[decisions/0002-real-world-proof.md](decisions/0002-real-world-proof.md).

- **The mailbox.** Real-world quests arrive as "letters from below" in a mailbox at the Sky Post.
  Each one is a picture card, read aloud. A quest you take shows in the journal with its own
  picture.
- **Where quests come from.** A fixed list in the game's content, written with the kids at the
  island design session before Slice D, plus custom quests a grown-up writes on the grown-up
  screen. The screen gently reminds the grown-up to make them adventures, not chores.
- **Proof.** When a quest is done, the player sends a photo, from the camera or the photo library,
  or a grown-up approves it with "I saw it" and no photo. There is no video for now. Each player can
  have up to 3 proofs waiting at once, and there is no daily limit.
- **A grown-up approves every proof.** One family grown-up PIN, set with `scripts/admin.sh`, opens
  a grown-up screen on any device. Nothing a player sends counts, or is seen by anyone else, until a
  grown-up approves it. A badge on the grown-up button shows how many proofs are waiting; there are
  no emails and no other outside notifications. While a proof waits, the quest card shows a clock
  picture: "waiting for a grown-up".
- **Not yet.** A grown-up who says "not yet" picks one of three pictures, which is read aloud: take
  the photo again, not finished yet, or come and show me. The player can send again any time.
- **Together.** The sender taps the faces of the players who helped, and everyone tagged gets the
  reward. Some quests need two or more players.
- **Making things.** When the photo is of a drawing, the server turns it into pixel art by itself:
  it crops the picture, removes the paper, uses fewer colours and makes the game's sizes. The
  player picks one of two or three versions before it goes to a grown-up.
  - First: island decorations and stickers, and a drawn badge or flag for the courier.
  - Next: your own drawn creature. It belongs to its artist first, with a "drawn by you" mark, and
    a grown-up can release it into the wild so brothers and sisters can meet it. The artist picks
    a body kind by picture (sturdy, quick or balanced), a weather type, and moves from that
    weather's moves. A fair stats template makes it exactly as strong as any other creature at its
    level. A grown-up types the name the artist says, and its cry plays instead of a spoken name.
    It can fight and duel like any creature.
  - Later: mounts, with gliding (Slice E), and whole courier outfits, after the courier designer
    (#96).
- **Decorations** on a home island are seen by family visitors, and a grown-up can remove any of
  them.
- **Photos stay at home.** Photos stay only on the family's own server, with the location and
  camera details removed. Only family profiles see anything, and a grown-up can delete any picture.
  Once a grown-up decides, the original photo is deleted and only the pixel item made from it stays.
  Photos are never put in this repository or sent to an outside service. An AI polish of a picture
  happens only with the owner's OK, picture by picture.

Still open: the quest list (the kids write it), where decorations sit (the home island design), and
which pixel versions to offer (a photo-to-pixel test on a home computer is running now).

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
