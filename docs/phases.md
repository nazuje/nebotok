# Nebotok phases

The game grows one phase at a time. Every phase ends with something playable on the live server
on the Mac mini, not just finished code. The [design](design.md) describes where the phases lead.

## Phase 0: Foundations (done)

The repository, the proof command (`npm run verify`), CI, the sealed container on the Mac mini, and
the agent setup. Playable: one small floating island with the courier on it, in both languages,
saying whether anyone else is on the islands.

## Phase 1: Walk together (done, apart from the real-device check)

- One small placeholder island, drawn in Tiled.
- Moving around by touch, with the server deciding where everyone is.
- Two devices see each other walking.
- Profiles, and each player's position saved between visits.
- Backups of the saves running.
- Phaser checked on a real iPad. **Still open:** only a person with a real iPhone and iPad can do
  this. Check touch feel, the joystick under a thumb, the safe areas, and a tab put to sleep by Safari.

Built and live: the profile picker with optional PINs, tap to walk (hold to keep walking), the
floating joystick and the keyboard, prediction that follows the server's route, spread-out
arrivals and stacked name tags, Litestream backups and nightly snapshots, and host-serve deploys
of signed images. A fresh-context playtest (#7) found four bugs and eight suggestions, and all
of them are fixed or decided.

## Phase 2: The whole game in placeholder slices

Rather than wait for real art and real creatures, Phase 2 builds the game in seven thin slices,
each playable on the live server. Everything a slice adds is data with a schema in `content/`:
creatures, moves, treats, encounter zones, shrines, quests, dialogue, recipes, islands and sounds.
The art test and the creature design day after Slice F then swap new data and images in, and no
rule has to change. Until the art test, the art is pixel grids drawn in code.

### Slice A: First battles

- The battle engine, in `packages/core`. (Built early, with placeholder creatures.)
- Wild encounters in tall grass (encounter zones).
- Treats and befriending.
- A team of up to 6, storage for 200 more, and a first creature chosen from three starters.
- Shrines, where you wake with your team healed after the whole team faints.
- Battle bots and golden replays that prove battles stay fair and repeatable.

Built as three tickets: the contract (#37: protocol v4, save v3, the content files and core rules,
see `docs/protocol.md`), then the server battles (#40) and the battle screens (#41) in parallel.

### Slice B: Story, quests, dialogue and inventory

Sky Post delivery quests, characters to talk to in English and Slovenian, and an inventory screen.

Built as tickets: the contract (#50: protocol 6, save v4, the story content files and core rules
for talks, quests and the bag, see `docs/protocol.md`), then the story server (#51), the talk and
bag screens (#52, #53), the placeholder story itself (#54), its art (#55) and the storm (#56). The
first creature now comes from Bavko, the postmaster: his first talk with a new player opens the
starter screen. There is no job board (it comes in Slice C) and no discarding items. The Slice B story is a
placeholder; when the real one replaces it, every player's quests reset and their creatures,
items and levels stay.

### Slice C: Skills

Foraging, fishing and cooking, each with levels 1 to 20 and a tiny game for every gather or cook,
and the Sky Post job board, feeding quests and befriending. Each player has their own spots, which
rest after a success; cooked dishes are treats that make befriending easier.

Built as tickets: the contract (#82: protocol 8, save v5, the skill content files and core rules
for skills, attempts, spots, recipes and jobs, see "Skills and the job board" in
`docs/protocol.md`), then the skills server (#83), the job board server (#84), the games and skills
screens (#85, after #83), the job board screen (#86, after #84), the placeholder content (#87) and
its art (#88), all in parallel, and a playtest (#89). Building moves to Slice D.

### Playable without reading

Some players can't read yet. Pictures, motion and an optional computer voice carry every message
that matters for progress, and text becomes a bonus for readers (see "Who plays" in the
[design](design.md)).

Built as tickets: these docs (#113), then a picture kit with weather icons (#114) and computer-voice
clips for talks and quests in both languages (#115) in parallel. After #114, the screens turn into
pictures in parallel: quests with a banner, journal cards and a compass button (#117), job board
cards and news (#118), tiny games, results, the recipe book and skills (#119), refusals, level ups,
shrine rests and connection messages (#120), and the treat picker, battle results, learn prompt and
team screen (#121). "Read to me" with speaker buttons (#122) follows #115 and #117, and a playtest as
a child who cannot read (#123) comes last. Battle visuals followed the owner's verdict on the
battle-feel prototype (branch `prototype/battle-feel`): the battle redesign (#116) is split into
"Arena battles" below.

### Arena battles

Milestone "Phase 2: Arena battles". The owner's verdict on the battle-feel prototype: real-time
arena battles replace turn battles (variant 6, see [arena.md](arena.md) and
[decisions/0001-real-time-arena.md](decisions/0001-real-time-arena.md)), and friendly duels move
here from Slice D. The battle redesign (#116) is split into these tickets:

- #141: these docs: the arena design, the protocol plan and the decision to drop turns.
- #142: every move gets a kind, a shape and arena numbers (`content/creatures/arena.json`).
- #143: pictures for every ability shape, kind and arena button.
- #144: core arena: bodies, walking, dash, collisions, storm and ring-out.
- #145: core arena: abilities, hits, status effects and weather.
- #146: core arena: the wild creature's mind and the balance sim.
- #147: core arena: treats, swap, fainting, rounds and rewards.
- #148: save v7: loadouts, the turtle setting and `loadout.set`.
- #149: server: the arena room, input, limits and a protocol bump.
- #150: server: wild encounters fight in the arena (behind `ARENA_BATTLES`).
- #151: client: the arena scene and controls.
- #152: client: predict your creature and smooth the other.
- #153: client: health bars, damage numbers, juice and haptics.
- #154: client: the loadout picker and the new-move toast.
- #155: client: pick three and the best-of-three rounds.
- #156: trainer fights: best of three from a talk, with one placeholder trainer.
- #157: duels: challenge, accept or decline, even match.
- #158: duels: the duel island, watching and rewards.
- #159: playtest the arena: the game-tester, then the family on an iPad.
- #160: switch over: arena for everyone, turn battles removed (after #159 and the owner's go).

Order: #141 first; then #142, #143 and #144 in parallel; #145 (after #142 and #144) and #148
(after #142); #146 and #147; #149 alone, the seam between core and server; #150 and #151; #152,
#153, #155 and #157; #154 once #143 and #148 are in; #156, #158 and #159; #160 last. The critical
path is #141, #142, #145, #147, #149, #151, #152, #159, #160.

Later, not in this milestone: top-down creature art with walking frames after the kids' creature
design day (#161), co-op against a storm boss, 2v2 duels, arena sounds (Slice F) and the kids' own
trainers.

### Slice D: Better together

Trading, preset phrases and emotes, and home islands that others can visit, with the building skill
to shape them. Friendly duels moved to "Arena battles".

### Slice E: Grow the sky

Three or four islands, gliding between them, and shared storm events everyone on the islands takes
part in.

### Slice F: Placeholder sound

Placeholder sound effects, and the creatures' and characters' babble in place of voices.

Built as tickets: the sound engine (#202: protocol 16, save v8, the `sounds` setting, sound
recipes in `content/sounds.json` played with Web Audio by `apps/game/src/sound.ts`, and a tap, a
quest's fanfare and an arena hit to prove it), then placeholder sounds for the world and the
interface (#203), for arena fights and turn battles (#204), and babble while characters talk with
a cry for every creature (#205).

## Phase 3: Art test and creature design day

Two or three art methods tried on the same creature, one tile set and one portrait. One method is
picked, and the islands are redrawn in it. The approach to music is chosen. Then a creature design
day: each kid designs two creatures, which replace placeholder creatures as data.

## Phase 4 and later

An airship. The storm's story chapters. More islands and skills. Later, the offline solo mode.
