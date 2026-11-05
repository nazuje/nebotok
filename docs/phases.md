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

**Then a creature design day:** each kid designs two creatures, which become the data for Phase 2.

## Phase 2: First battles

- The battle engine, in `packages/core`. (Built early, with placeholder creatures.)
- Wild encounters.
- Treats and befriending.
- A team of up to 6.
- Shrines, where you wake after a lost battle.
- Battle bots and golden replays that prove battles stay fair and repeatable.

## Phase 3: First route

The first vertical slice: Sky Post delivery quests, characters to talk to in English and Slovenian,
and foraging and cooking.

## Phase 4: Art and sound test

Two or three art methods tried on the same creature, one tile set and one portrait. One method is
picked, and the first island is redrawn in it. The approach to music is chosen.

## Phase 5: Better together

Trading, duels with the even-match setting, preset phrases and emotes, and home islands that others
can visit.

## Phase 6 and later: Grow the sky

New islands, one at a time. A glider, then an airship. The storm's story chapters. Shared world
events. More skills. Later, the offline solo mode.
