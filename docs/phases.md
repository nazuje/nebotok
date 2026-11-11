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

Rather than wait for real art and real creatures, Phase 2 builds the game in six thin slices, each
playable on the live server. Everything a slice adds is data with a schema in `content/`:
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

### Slice D: Better together

Trading, duels with the even-match setting, preset phrases and emotes, and home islands that others
can visit, with the building skill to shape them.

### Slice E: Grow the sky

Three or four islands, gliding between them, and shared storm events everyone on the islands takes
part in.

### Slice F: Placeholder sound

Placeholder sound effects, and the creatures' and characters' babble in place of voices.

## Phase 3: Art test and creature design day

Two or three art methods tried on the same creature, one tile set and one portrait. One method is
picked, and the islands are redrawn in it. The approach to music is chosen. Then a creature design
day: each kid designs two creatures, which replace placeholder creatures as data.

## Phase 4 and later

An airship. The storm's story chapters. More islands and skills. Later, the offline solo mode.
