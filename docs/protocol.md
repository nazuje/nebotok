# Protocol

How the browser talks to the server: an HTTP API for profiles and sessions, then one Colyseus room,
`world`, for the shared island, and one `arena` room per real-time fight (see "Arena fights"). The shapes live in `packages/core` (`src/protocol.ts`,
`src/profile.ts`, `src/messages.ts` for battles and teams, `src/story-messages.ts` for talks and
`src/skill-messages.ts` for skills and jobs), so client and server import the
same zod schemas and constants. A change the client relies on bumps `PROTOCOL_VERSION` (now **12**),
including a change to what the server accepts or requires with the same messages: protocol 7 is
protocol 6 with the starter only through a talk, protocol 8 adds skills and the job board,
protocol 9 judges the tiny games exactly as they are drawn, protocol 10 adds the player's
settings ("Read to me"), protocol 11 adds arena loadouts and the turtle setting
(`loadout.set`, `settings.turtle`; see "Arena fights"), and protocol 12 the arena room, its input
and its messages.
`scripts/lib/protocol-contract.test.mjs` hashes the message names, the client message schemas, the
attempt timing constants, server switches such as `STARTER_NEEDS_TALK` and `SKILLS_NEED_STARTER`,
and the arena room's name, input fields, messages and limits, and fails until the hash is recorded for a new version in `PROTOCOL_CONTRACTS`.

Everything is same-origin: the page, the API, the maps and the WebSocket all come from the server
that served the page. In development Vite proxies `/colyseus/*` to the server and strips the prefix,
so the client prefixes every path below with `/colyseus` there.

## Profiles and sessions (HTTP)

All under `/api`, JSON only, at most 1 KB per body. Responses carry `Cache-Control: no-store` and no
CORS headers. A POST, PUT or DELETE must have an `Origin` header naming this same host (else 403)
and a POST or PUT must be `Content-Type: application/json` (else 415). Each client address may make
120 API requests a minute, 10 logins, 5 profile creations and 5 tries at adding a PIN; past that the
answer is 429 with `Retry-After`.

| Request | Body | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/profiles` | none | 200, `ProfileSummary[]` in creation order | |
| `POST /api/profiles` | `{ name, avatar, pin? }` | 201, the new `ProfileSummary` | 400 `nameInvalid` / `pinInvalid`, 409 `nameTaken` / `full` |
| `POST /api/sessions` | `{ profileId, pin? }` | 200, `LoginResponse` | 400 `pinInvalid` (PIN missing or malformed), 401 `pinWrong`, 404 `unknown`, 423 `locked`, 429 `busy` |
| `PUT /api/profiles/current/pin` | `{ pin }`, `Authorization: Bearer <token>` | 200, the profile's `ProfileSummary` | 400 `pinInvalid` (PIN missing or malformed) / `unknown`, 401 `signedOut`, 409 `hasPin`, 429 `busy` |
| `DELETE /api/sessions/current` | none, `Authorization: Bearer <token>` | 204, always | |

- `ProfileSummary` is `{ id, name, avatar, hasPin, lockedForSeconds }`; it never includes a PIN.
- `LoginResponse` is `{ token, expiresAt, profile }`. The token is 43 base64url characters. Keep it
  in `localStorage` under `nebotok:session` as `{ "token": "…", "profile": { id, name, avatar } }`;
  the client reads it from there, and uses the profile part only to show who is playing.
- Every error body is `ApiError`, `{ error, retryAfterSeconds? }`, where `error` is one of
  `PROFILE_ERRORS`. The client shows the string `profile.error.<error>` from `content/strings.json`.
  Anything unexpected (malformed JSON, too big, server fault) answers `unknown` with a fitting status
  and never a stack trace.
- **Names:** 1 to 16 letters (A to Z plus č, š, ž, ć, đ, either case) and single spaces, trimmed.
  Names are unique ignoring case. At most `MAX_PROFILES` (20) profiles.
- **Avatars:** an `id` from `content/avatars.json`.
- **PINs:** optional, exactly four digits. Five wrong PINs in a row lock the profile (`locked`, with
  `retryAfterSeconds`): for 60 seconds the first time, and twice as long each time it is locked
  again (2 minutes, 4 minutes and so on, at most an hour). A right PIN resets both counts. Only one
  PIN check per profile runs at a time; a second one meanwhile is `busy`.
- **Sessions** last 180 days. Each login starts a new session and ends the profile's previous one,
  so a token is good on one device at a time. Logout ends the session and closes the profile's seat
  in the world (close code `signedOut`). A PIN reset or a deletion with `scripts/admin.sh` closes
  the seat with the same code, at its next reconnection or within 30 seconds.
- **Adding a PIN:** a profile made without a PIN gets one with `PUT /api/profiles/current/pin`,
  signed in as that profile (no session, or one that ended, is 401 `signedOut`). It works only
  while the profile has no PIN (409 `hasPin` otherwise); changing or removing a PIN stays with
  `scripts/admin.sh`. The session that added it goes on, and every other session of the profile
  ends, so a seat in the world held with one of those closes with `signedOut` at once.

## Maps (HTTP)

`GET /maps/<map>.tmj` is the Tiled map named in the room state; `GET /maps/sky-tiles.png` is its
tileset image, for tools (the game draws its tiles from the art bundled in it, `content/art/`). Clients read the map with `readTiledMap` from core, the same function the server uses, so
predicted walking matches the server's.

## Joining the world (Colyseus)

```ts
client.auth.token = token;
const room = await client.joinOrCreate('world', { protocol: PROTOCOL_VERSION, language });
```

The SDK sends the token as `Authorization: Bearer <token>`. `language` (`en` or `sl`) is optional;
it is stored in the save. Like `/api`, the join request (`POST /matchmake/…`) gets no CORS headers;
its body must declare a `Content-Length` (else 411) of at most 1 KB (else 413). A refused join
throws a `ServerError`:

| `error.code` | Meaning | What the client does |
| --- | --- | --- |
| `ErrorCode.AUTH_FAILED` (525) | No token, or one that is expired, logged out or replaced | Forget the token, show the profile screen |
| `ErrorCode.MATCHMAKE_INVALID_CRITERIA` (521) | Missing or different `protocol` | The page is out of date: reload |

One profile has one character. Joining again from another device takes the character over, where it
stands, and the older connection is closed with `CLOSE_CODES.replaced`. The server has exactly one
world room: it holds `MAX_PLAYERS` (twice `MAX_PROFILES`), stays open while nobody plays, and
refuses to open a second one, so every profile meets everyone else and holds one seat at most.

## Room state

```text
WorldState
  playerCount  uint16   players in the room, connected or waiting to reconnect
  map          string   the map id, served at /maps/<map>.tmj
  stepMs       uint16   how long one step takes (200 at 5 tiles a second)
  players      map<sessionId, Player>

Player
  name, avatar       string
  x, y               uint16   the tile the player stands on, or is stepping onto
  facing             'up' | 'down' | 'left' | 'right'
  moving             boolean
  connected          boolean  false while the player's connection is lost
  inBattle           boolean  true while the player is in a battle
  talking            boolean  true while the player is talking to a character
  skill              string   '' or the skill the player is doing: foraging, fishing or cooking
```

The key of `players` is the Colyseus `sessionId`; your own is `room.sessionId`. Nothing else about a
profile is in the state: no team, treats or battle. Those go only to their player, as messages (see
"Battles, teams and treats" below).

## Messages

Every message is checked by a strict zod schema. A message that does not match closes the
connection with Colyseus's `WITH_ERROR` (4002). More than 30 messages a second also disconnects.
More than 5 `walk.to` a second are not an error: the extra ones are dropped without an answer.

Client to server:

| Type | Payload | Effect |
| --- | --- | --- |
| `ping` | `{ sentAt: number }` | Answered with `pong`, same payload |
| `walk.to` | `{ x, y, from? }`, integers 0 to 1023 | Walk along the cheapest path (core `findPath`: around tall grass unless the tile is grass or the way around is much longer) to that tile. A tile off the map is ignored. |
| `walk.hold` | `{ direction, from? }` | Walk that way tile after tile until `walk.stop` or another intent. At a blocked tile the player turns to face it and waits. |
| `walk.stop` | `{ from? }` | Finish the current step and stand still |
| `settings.set` | `{ readToMe: boolean }` | Change the player's own settings: saved with the player at once and sent back as `settings`. Counts against the request limit of talks, battles and skills. |
| `settings.turtle` | `{ on: boolean }` | Turn the turtle setting on or off, like `settings.set`; refused `inBattle` during a fight (see "Arena fights") |

A new intent replaces the old one. A step that has started always finishes, so the player ends on a
whole tile.

`from` is `{ x, y }`, the tile the client planned the command from: the tile its prediction had
claimed, or the next one when that step was nearly over. The server runs the same rule, core
`planCommand`: when `from` is one of the next `CATCH_UP_STEPS` (2) tiles of the player's current
intent, the player carries on to it and the command starts there; a walk whose route from `from`
the player has already stepped onto is joined where it stands; otherwise, or without `from`, the
command starts from the player's own tile. `from` never moves a player anywhere its own intent or
a path on the map would not, so a wrong one only costs the client a correction. Without it, a client
and server planning from tiles a step apart often pick different, equally short routes, and the
client's courier would have to jump back to the server's.

Server to client:

| Type | Payload | When |
| --- | --- | --- |
| `welcome` | `Welcome`: `{ protocol, world, playerCount, messageKey }` | Right after joining |
| `pong` | `{ sentAt }` | Answer to `ping` |
| `walk.refused` | `{ x, y }` | A `walk.to` target on the map that cannot be reached; drop any predicted path |
| `settings` | `{ readToMe, turtle }` | On joining, after `skills`, and after each `settings.set` and `settings.turtle`. Only this seat changes them, so a reconnection keeps what the page has. |

**Settings.** The player's own settings live in their save, so they follow the player to any
device: `turtle`, the player's easier arena setting (docs/arena.md, "The turtle setting"; off until
they turn it on, and nothing reads it until arena fights are built), and `readToMe` ("Read to me",
off for every player until they turn it on): while it is on, the page reads each talk line aloud in its speaker's voice and the hint of each new
quest banner in the narrator's, from the clips in `apps/game/public/voice/`. A speaker button on the
talk box and the quest banner reads its words whatever the setting; a line without a clip is silent.
Language and controls stay settings of the device.

The battle, team and starter messages are in the next section, the talk and quest messages in
"Talking, quests and the bag", and the skill and job messages in "Skills and the job board".

## Battles, teams and treats

Since protocol 4, with learning moves since protocol 5. The payload schemas are in
`packages/core/src/messages.ts`, the type names in `CLIENT_MESSAGES` and `SERVER_MESSAGES`, and
the rules they use in core: `rollEncounter` (`encounter.ts`), the battle engine (`battle/`),
`befriendChance` (`befriend.ts`), the team, treat and shrine rules (`creatures.ts`), experience
(`growth.ts`) and learning moves (`learning.ts`).

### Privacy: battles are messages to one player

Everything about a battle, a team, the treats and storage goes **only to the player it belongs
to**, as Colyseus messages. Other players see one thing: `inBattle` on that player in the room
state, so they can draw a "battling" mark and know not to wait for them.

Why messages, not the room state:

- **Privacy.** Colyseus 0.18 can hide state per client (`StateView`), but a single `.view()` field
  makes the server encode the whole room once per client on every patch, instead of once for
  everyone, for a family's handful of players walking at 20 ticks a second. Not worth it for data
  only one player reads.
- **Order.** The room state sends only the latest value of each field per patch. A turn is a list of
  events (a hit, a faint, a swap, weather) that the screen animates in order; in the state, two
  changes within one patch would collapse into the last. A message carries the whole list.
- **Reconnection.** A message sent while a connection is down can be lost (and the SDK holds at
  most 10 of the client's own sends while offline), so a client cannot rely on having seen every
  turn. Each battle message therefore carries the full `BattleView` as well as the events, and
  after a reconnection the server sends `battle.view` once. The client always draws from the view
  and uses the events only to animate.

Duels and arena fights do not use these messages: see "Arena fights" below.

### Client to server

| Type | Payload | When | Effect |
| --- | --- | --- | --- |
| `starter.choose` | `{ species }` | `progress.needsStarter`, while talking at Bavko's starter node (see "The starter") | The starter from `content/starters.json` joins the team, with the starting treats (core `chooseStarter`) |
| `battle.move` | `{ slot }`, 0 to 3 | In a battle | Use the active creature's move in that slot |
| `battle.switch` | `{ index }`, 0 to 5 | In a battle | Send out the team creature at that place; also the answer to `mustSwap` |
| `battle.treat` | `{ itemId }` | `canTreat`, with that treat in the inventory | Offer one; it is used up whether or not it is accepted |
| `battle.run` | `{}` | `canRun` | Leave the battle |
| `team.reorder` | `{ order }`, `order[i]` the current place of the creature going to place i | Not in a battle | New team order (core `reorderTeam`); the first creature that can battle goes out first |
| `storage.swap` | `{ team, storage }`, each a place or null | At a shrine, not in a battle | Swap, store or bring back creatures (core `swapStorage`) |
| `move.choose` | `{ offer, forget }`: `offer` the id from `move.offer`, `forget` a slot 0 to 3 or null | A `move.offer` is waiting | Forget the move in that slot for the offered one, or skip it with null (core `answerMove`) |

A message that does not match its schema closes the connection (4002), as with walking. A message
that matches but is not allowed now (not in a battle, an illegal move, a treat the player has not
got, `storage.swap` away from a shrine, `move.choose` with no offer waiting (`notNow`) or for
another offer (`invalid`)) is answered with `refused`, and nothing changes. The client
shows `refused.<reason>` from `content/strings.json`.

### Server to client

| Type | Payload | When |
| --- | --- | --- |
| `progress` | `ProgressMessage`: `{ team, inventory, lastShrine, seen, befriended, needsStarter }`; each team creature also has its `loadout` and `learned`, the ids of every move it has learned (core `learnedMoves`), since protocol 11 | After `welcome` and each reconnection, and after anything that changes them |
| `storage` | `StorageMessage`: `{ shrine, storage }` | On reaching a shrine, and after each `storage.swap` |
| `battle.started` | `BattleUpdate`: `{ battle, events }` | A wild creature appeared; `events` are the start events (who is sent out, the weather) |
| `battle.turn` | `BattleUpdate` | After each step: a turn, a swap, or a treat or run in the befriend phase |
| `battle.view` | `{ battle }` | After a reconnection during a battle |
| `battle.befriend` | `BefriendResult`: `{ battle, species, placedIn }` | The wild creature accepted a treat; `placedIn` is `team` or `storage` |
| `battle.result` | `BattleResult`: `{ battle, outcome, rewards, learned, woke }` | The battle is over; `inBattle` turns false |
| `move.offer` | `MoveOffer`: `{ offer, index, species, move, moves }` | After `battle.result`, one at a time: the creature at team place `index` may learn `move` by forgetting one of `moves` |
| `refused` | `Refused`: `{ request, reason }` | A request from the table above was not done |

`battle` in a `BattleUpdate` is a `BattleView` (core `battleView`): the phase, the turn, the
weather, the player's team with health and moves, the wild creature with its health but not its
moves, and `mustSwap`, `canTreat`, `canRun` and `outcome`. The player is always side 0, creatures
`a1` to `a6` in team order; the wild creature is side 1, `b1`. `events` are core's
`BattleEvent`s, for the screen to animate in order: `turnStarted`, `switched`, `used`, `missed`,
`hit` (damage, health left, weather chart effect), `fainted`, `mustSwap`, `weatherStarted`,
`weatherEnded`, `canBefriend`, `treatOffered` (the chance and whether it was accepted), `ran`
and `ended`.

### How a wild battle goes

1. **Encounter.** When a step ends on a tile inside an `encounters` rectangle of the map
   (`encounterZoneAt`) and the team can battle (`canBattle`), the server rolls `rollEncounter`
   for that zone with its own seeded RNG. On an encounter it stops the player's walk, adds the
   species to `seen`, sets `inBattle`, starts the battle from `wildBattleSetup` (the whole team in
   order, with saved health and moves, and the zone's weather) and sends `battle.started`. Walk
   messages are ignored while `inBattle`.
2. **Turns.** In phase `choose` the player sends `battle.move`, `battle.switch`, `battle.treat` or
   `battle.run`; the server picks the wild creature's action with a core bot, runs `battleStep`
   and sends `battle.turn`. In phase `swap` the player answers `mustSwap` with `battle.switch`.
   A turn has no time limit, but a battle with no request from its player for 2 minutes ends as a
   run, connected or not.
3. **Treats.** `canTreat` turns true once the wild creature is worn down to
   `windowPercent` of its health (`content/creatures/befriending.json`), and stays true after it
   faints: then the battle waits in phase `befriend` for a treat or `battle.run`. Each offer rolls
   `befriendChance` once: more likely the more tired the creature, with its favourite treat (or one
   its weather type likes) and the lower its level. Accepted, the creature joins the team, or storage
   when the team has 6 (`addCreature`), at full health, and `befriended` gains its species. A
   refused treat in phase `befriend` ends the battle as a win, and so does `battle.run` there
   (the game's Done button), which plays no line about running away.
4. **End.** The server sends the last `battle.turn` (ending in `ended`), then `battle.befriend`
   if a treat was accepted, then `battle.result`, then the first `move.offer` if there is one,
   then `progress`. The team keeps the health it ended with (`teamAfterBattle`). A win or a
   befriending gives `xpForWin` of the wild creature's level to every creature that was sent out
   and still stands (`awardXp`, `sentOut`); `rewards` lists them.
5. **Learning moves.** A creature whose level rises past a level in its species' `learnset` learns
   that move (core `learnTeamMoves`, `learning.ts`), in learnset order, one level after another.
   While it knows fewer than four moves the move is added at once, and `battle.result.learned`
   lists it as `{ index, move }`, `index` its team place. A creature that already knows four is
   offered the move instead: after `battle.result` the server sends one `move.offer`, waits for its
   answer, and only then sends the next one, then `progress` after each. The player answers with
   `move.choose`: `forget` is the slot of the move given up, whose place the new move takes, or
   null to skip it (core `answerMove`). The answer is saved at once. While an offer waits, no wild
   creature appears and `team.reorder`, `storage.swap` and `starter.choose` are refused with
   `notNow`, so the team place in the offer stays right. An offer with no answer for 2 minutes is
   skipped, connected or not, like an idle battle. After a reconnection the server sends the
   waiting offer again, after `progress`.
6. **Fainting.** When the whole team faints, the player wakes at `wakePoint`: their last shrine,
   or the map's `player` spawn before they have touched one (spread out with `freeTileNear`). The
   rules in `content/shrines.json` `teamFainted` apply (`wakeAfterFainting`): the team is healed
   and nothing is lost. `battle.result.woke` says where.
7. **Shrines.** Stepping onto a shrine's tile or one next to it (`shrineAt`) heals the team
   (`healTeam`), makes it `lastShrine`, and sends `progress` and `storage`.

A battle lives only in the server's memory. While its player is disconnected it waits, up to the
2 minutes above; when the seat expires, another device takes the profile over, or the server stops,
it ends like a run (a win, if the wild creature had already fainted), and the team keeps its health.
Each battle draws from its own RNG, seeded from the server's randomness when it starts.

Move offers live only in the server's memory too, and are never saved: the save format stays as it
was. When the seat ends with offers waiting (the player leaves, the seat expires, another device
takes the profile over or the server stops), they are dropped, and the creature simply does not
learn those moves. The level and experience are saved as usual. Offers have ids counted across the
room, so an answer to an old offer never matches a new one.

The battle, starter, team, storage and move requests together are limited to 5 a second per client;
past that the server drops them without an answer and without closing the connection. The game
sends every battle, talk, skill and board request through one pacer (`apps/game/src/request-pacer.ts`,
5 every 1.25 s) so it stays under the limit however fast it is tapped, and a screen waiting on a
request gives it up after 1.5 s without an answer, so the next tap asks again.

## Arena fights

**Planned** for the milestone "Phase 2: Arena battles" (#141 to #160). Built so far: loadouts and
the turtle setting (`loadout.set`, `settings.turtle`, protocol 11, save v7, #148), and the arena
room with its input, limits, state and messages, the hand-off and `ARENA_BATTLES` (protocol 12,
#149), and wild fights from tall grass with the setting on (#150). Tests can also start one with
the world room's `startWildFight(playerId, wild)`. Parts still to come are marked.
The rules are in [arena.md](arena.md), and why the fight runs in its own room in
[decisions/0001-real-time-arena.md](decisions/0001-real-time-arena.md). Until the switch-over
(#160) both kinds of battle exist: the server setting `ARENA_BATTLES` (default `off`, in
`apps/server/src/config.ts` and `.env.example`) turns tall-grass encounters into arena fights.

### Rooms and the hand-off

Each fight runs in its own Colyseus room, `arena`, next to the one `world` room.

- **Private.** The world room plans the fight in the server's fight book (`src/fights.ts`) and
  creates its room with `matchMaker.createRoom('arena', { fightId })`; it is `setPrivate`, never
  listed, and its static `onAuth` refuses every matchmaking join (`joinOrCreate`, `create`,
  `join`, `joinById`). A player joins only with a seat reservation (`matchMaker.reserveSeatFor`,
  which skips that check), sent to that player alone in `arena.join`; the client joins with
  `consumeSeatReservation`. The reservation carries a one-time fight ticket that stays on the
  server; the room's `onAuth` spends it and checks that the session joining (`_authToken`, the
  same token as the world) is the profile it was made for. A refused attempt spends the seat and
  the ticket. Watchers (duels only, up to 6, #158) will join the same way, with a watcher seat.
- **The world room stays connected** and stays the only writer of saves. While a fight runs, the
  seat's `seat.fight` is set (`seat.battle` for turn battles) and `inBattle` is true, so walking,
  talks, shrines, storage and skills are refused exactly as in a battle. A take-over or a leave of
  the world seat ends the fight as `ran`.
- **The end.** The arena room hands `{ fightId, fight, why }`, the fight as it ended, to the
  world room through the fight book (same process), and closes 2 s later. The world room settles it
  against the seat's progress (`settleFight` in `src/battles.ts`): team health
  (`teamAfterFight`), then XP and level ups to the creatures still standing (`arenaRewards`), every
  move a level up teaches in `learned` (an arena creature keeps every move it learns, so nothing
  is offered with `move.offer`; a turn battle's four moves take the new ones while there is room),
  the treats left, the befriended creature to the team or storage with `befriended`, and waking
  at a shrine when the whole team fainted. It saves at once and sends `arena.result`, then counts
  the quest events: `battleWon` in the fight's zone on `won`, `wonByRingOut` and `befriended`
  (a befriending is a won battle, as in a turn battle), and `befriended` too on `befriended`, with any
  `quest.changed`, then `progress` and, when quests moved, `story`; `inBattle` turns false. `seen` is
  saved as the fight starts.
- **Starting points.** Tall grass with `ARENA_BATTLES` on (#150, built): a step that meets a
  wild creature (`rollEncounter`, as for turn battles) starts a wild fight instead of
  `battle.started`, set up by `arenaWildSetup` with the zone's weather (on the island from the
  start and for the whole fight, until a move's weather replaces it), the player's loadouts and
  turtle setting, and the wild loadout. The courier stays on the grass tile where it met the
  creature, and `arena.join` follows. The world room's `startWildFight` (#149) does the same
  outside any zone, for tests. A trainer's talk node `fight: <trainerId>` (#156): rounds against the trainer's mind.
  An accepted duel (#157): rounds with two human sides. A dev-only `arena.practice` switch starts
  rounds against `BOT` for the browser check (#155).

### Input

Clients send only a stick direction and button presses, 30 times a second, with Colyseus 0.18's
input stream (`room.input()`, called `arena.input` in these docs), each stamped to a server tick.
It never goes through `outbox.ts` or `request-pacer.ts`; a tap between two sends is latched so
none is lost. The server declares it with
`defineInput(ArenaInputSchema, { bufferMaxSize: 16, sanitize, idle })`:

| Field | Type | Meaning |
| --- | --- | --- |
| `dir` | uint8 | The stick's direction 0 to 15 (the client sends the 8 even ones), 255 for none |
| `press` | uint8 | Ability button 0 to 2, 255 for none |
| `dash` | boolean | Dash |
| `treat` | boolean | Throw a treat |
| `swap` | boolean | Swap to the next creature |
| `leave` | boolean | Leave the fight (wild fights) |

`sanitize` turns anything else (NaN, 9999, a string) into none (core `cleanArenaInput`; the uint8
wire already wraps a big number, so out of range means 16 to 254 for `dir` and 3 to 254 for
`press`). `idle`, used when a tick's input is missing, keeps `dir` and clears every press: a held
stick survives a lost packet and a tap never repeats. A watcher's input will be refused (#158). The client stamps each input ahead of the server by the
round trip times the tick rate, clamped to 2 to 10 ticks.

### The step and the limits

- `setFixedTimestep(step, 30, { subSteps: 2 })`: 30 inputs a second, each running two 60 Hz core
  `fightStep`s; the input applies on the first sub-step only, and the second keeps the stick with
  every button let go. A computer's side (a wild creature, a `BOT`) gets `wildInput` from its
  own brain and `mind:<side>:<seed>` RNG on every core step.
- This room alone allows 45 messages a second (`maxMessagesPerSecond`); more disconnects (the
  input stream counts). New presses beyond 10 in the last 30 inputs are dropped (the buttons let go,
  the stick kept) and counted; a button held down is one press. The world room's limits do not
  change.
- **Load budget** (#149): 6 arena rooms of `BOT` against `BOT` plus 4 bots walking the world, in
  the container's 1 CPU and 512 MB: a mean step under 1 ms and no world tick later than 10 ms.
  `npm run arena:load` measures it (its header has the container command). A core step on its own
  stays under 0.05 ms in Node (#144).
- **Logs:** `fight started` and `fight ended` with ids, mode, why it ended, outcome, ticks, mean
  and worst step time, inputs, dropped inputs, dropped presses and refused presses, and `fight
  settled` in the world room. No names.

### Arena state

The fight is the arena room's state, which only its players and watchers receive. The world room's
state shows others only `inBattle` (and, for duels, the duelling and watching marks of #158).

```text
ArenaRoomState (apps/server/src/arena-state.ts)
  mode               'wild' | 'rounds'
  tick, limit        uint32   the step, and the tick the island's time limit falls on
  phase              'fighting' | 'ended' now; 'picking' and 'between' come with #155
  radius             int32    the island's radius now, in 1/256 units
  storm              { step, phase, next }: the tick the next shrink starts, -1 at the floor
  weather            string   the weather on the island, or ''
  bodies             2 × ArenaBody, side 0 first
  things             ArraySchema of shots, zones and strikes, at most 24
                     { id, side, move, shape, x, y, radius, armTicks, ticks }
  treat              { item, x, y, landed }: a treat in the air or on the ground; item '' for none
  score              round wins of each side (rounds; 0 and 0 in a wild fight)
  round              uint8    the round now (rounds)

ArenaBody
  id                 string   the fighter: a<place + 1> for a team creature, b1 for the wild one
  x, y, vx, vy       int32    in 1/256 units
  facing             uint8    0 to 15
  health, max, level, species
  status             bits: 1 slowed, 2 rooted, 4 shielded, 8 tumbling, 16 winding up
  cooldowns          ticks left for buttons 1 to 3, dash and swap (swap: side 0 of a wild fight)
  turtle             boolean  shows the turtle badge
```

Events (hits, faints, ring-outs, the storm) go as one `arena.events` message per fixed step, the
events of both its core steps, for the screen's juice only (see "Events" in arena.md). The state is
the truth.

### Messages

World room, client to server:

| Type | Payload | When | Effect |
| --- | --- | --- | --- |
| `loadout.set` (built) | `{ index, loadout }`: `index` a team place 0 to 5, `loadout` three move ids or null | Not in a fight | Sets that creature's buttons (core `setLoadout`), saved at once and sent back in `progress`; refused `invalid` for an unlearned move, a wrong kind, a locked button or an empty team place, `inBattle` during a fight (today a turn battle) |
| `settings.turtle` (built) | `{ on }` | Not in a fight | Turns the turtle setting on or off; saved at once and sent back in `settings`; refused `inBattle` during a fight |
| `duel.ask` | `{ to, even }`: `to` the other player's key in `players`, `even` the even-match switch | Both free, within 4 tiles, both with 3 standing creatures | Sends `duel.asked` to the other player. One ask at a time; the same pair waits 30 s after a decline |
| `duel.answer` | `{ yes }` | A `duel.asked` waits for you | Yes starts the duel; no, or no answer in 20 s, declines |
| `duel.cancel` | `{}` | Your ask waits | Takes the ask back |

World room, server to client:

| Type | Payload | When |
| --- | --- | --- |
| `arena.join` (built) | `{ fightId, reservation }`: the seat reservation, for `consumeSeatReservation` | A fight you are in or watch is ready to join, again when your seat in its room is gone while the fight goes on |
| `arena.result` (built) | `{ fightId, outcome, rewards, befriended, learned, rounds, woke }`: `outcome` core's, null for no result; `befriended` `{ species, level, placedIn }` or null; `learned` `[{ index, move }]`; `woke` as in `battle.result` | The fight is settled; leave the arena room, show the result, and a new-move toast for each `learned` |
| `duel.asked` | Who asks (their key in `players`), their first three creatures and `even` | Someone asks you |
| `duel.answered` | `{ yes }` | Your ask was answered, or declined by itself |
| `settings` (built) | `{ readToMe, turtle }` | As today, with `turtle` |
| `progress` (built) | As today; each team creature also has `loadout` and `learned` (its learned move ids) | As today |

Arena room:

| Type | Direction | Payload | When |
| --- | --- | --- | --- |
| input (`arena.input`) | client to server | The input above | 30 times a second while fighting |
| `arena.pick` | client to server | `{ order }`: 3 team places, different, each standing | In the `picking` phase of rounds; refused `invalid` otherwise. A 30 s timer picks the first three standing |
| `arena.started` (built) | server to client | `{ fightId, mode, side, sides }`: `sides` both line-ups, `[{ id, species, level, place }]` (`place` null for a creature not of your team) | On joining and on reconnecting |
| `arena.events` (built) | server to client | `{ tick, events }`: core's fight events of one fixed step's core steps. A `refused` press repeats every tick it is held, so one already sent the step before is left out | Each fixed step with events |

A request that matches its schema but is not allowed now is answered with `refused` and the reasons
the world already uses (`invalid`, `notNow`, `inBattle`, `tooFar`); a payload that does not match
closes the connection (4002), as everywhere.

### Prediction

The client predicts its own creature by running core's `fightStep` from the last server state plus
its unacknowledged inputs (Colyseus `Predict`; `self-walker.ts` is the house pattern). A correction
is blended away over 120 ms, or snapped when the error is beyond 1.5 bodies (69 units). Knocks and
ring-outs come only from the server; a cast is predicted only as the start of its animation. The
other creature is drawn 100 ms in the past (as `OTHERS_DELAY_MS` in the world), between snapshots.
Hit-stop pauses only the drawing, never input or prediction. The browser check (#152) keeps the
mean prediction error under 8 units with fewer than 2 snaps over 5 s of movement, at 0, 50 and
150 ms of lag.

Dev and test only: `ARENA_FAKE_LAG_MS` adds lag on the dev server and is refused in production
config; `?test=1&net=1` shows the round trip, the input lead, corrections a second, the mean error
and snaps, also in the test hook.

### Dropping and coming back

- The arena room holds a dropped player's seat for 20 s (`allowReconnection`), and the SDK
  reconnects by itself. Inputs sent while the fight waited are thrown away when it resumes. A
  reconnection looks the session up again, as the world room's does, and closes with `signedOut`
  when it has ended.
- A **wild fight pauses** while its player is away (no steps), up to 120 s (`BATTLE_IDLE_MS`), then
  ends as `ran`. A player back after the 20 s but within the 120 s gets a new `arena.join` from the
  world room for the same fight: at once while still in the world, else on reconnecting to it.
  A fight does not start moving until its players are in.
- A **duel pauses** both sides, and both players and the watchers see "waiting". After 30 s it ends
  with no result.
- A server restart loses the fight, which lives only in memory: the world comes back, and the fight
  ends as `ran` (#160's restart check).

### Saves

- **v7** (#148, built): each creature gains `loadout`, three move ids or null, one per button;
  settings become `SettingsV7 { readToMe, turtle }`. `moves` stays while turn battles live.
  Migrating from v6 puts on each unlocked button the first learned move of its kind, as arena.md's
  default, so a move forgotten in a turn battle can come back; `turtle` starts false. The save
  repair replaces a loadout move that is not learned, of the wrong kind or on a locked button with
  that default.
- **v8** (#160): drops `moves`. Nothing else is lost, and learned moves are worked out from the
  level, so moves forgotten with the old prompt come back.

### Protocol versions

The protocol was 10 before the arena work. Each wire change bumps it once, in the order the tickets
merge: #148 to 11 (`loadout.set`, `settings.turtle`, `loadout` and `learned` in `progress`;
done), then #149 to 12 (the arena room, its input and `arena.join`, `arena.started`,
`arena.events`, `arena.result`; done), #155 (`arena.pick`), #157 (`duel.*`) and #160. So the switch-over's
number is whatever comes next then, not fixed here. Tickets merged at the same time conflict on the
one line in `scripts/lib/protocol-contract.test.mjs`; the later one takes the next number.

### Removed at the switch-over

#160 removes the turn messages `battle.move`, `battle.switch`, `battle.treat`, `battle.run`,
`move.choose`, `battle.started`, `battle.turn`, `battle.view`, `battle.befriend`, `battle.result`
and `move.offer`, the `ARENA_BATTLES` setting, and this page's "Battles, teams and treats" turn
parts, which it rewrites for the arena. `starter.choose`, `team.reorder`, `storage.swap`,
`progress`, `storage` and `refused` stay. An old page gets the usual protocol refusal and reloads.
## Talking, quests and the bag

Since protocol 6. The payload schemas are in `packages/core/src/story-messages.ts`, the content
schemas in `story-content.ts`, and the rules in core: talks (`dialogue.ts`), quests (`quests.ts`),
the bag (`inventory.ts`) and the content links (`story.ts`). Like battles, everything here goes
**only to its player**, as messages; the room state shows others just `talking` on that player.

While a talk is open the player stands still: `talk.start` stops any walk (the step under way
still ends), walk messages are ignored, and no wild creature appears. A talk ends on `talk.end`, at
the end of its dialogue, when a node's effect cannot happen, after a chosen starter, when a battle
starts, when the player leaves or another device takes over the seat, when the server stops, and
after two minutes with no `talk.start` or `talk.next` (`TALK_IDLE_MS` in
`apps/server/src/talk.ts`). A dropped connection does not end it: after the reconnection the
server sends `progress`, `story` and then the same `talk.node` again, and the talk goes on from
there.

### Client to server

| Type | Payload | When | Effect |
| --- | --- | --- | --- |
| `talk.start` | `{ npc }` | Standing next to the character (core `npcInReach`: on a tile beside theirs, not diagonally), not in a battle, not talking, no `move.offer` waiting | Opens the talk at the first entry of `dialogue/<npc>.json` whose `if` holds (core `openConversation`), does that node's effects, sets `talking` and sends `talk.node` |
| `talk.next` | `{ conversation, choice }`: `choice` 0 to 2, or null | Talking, `conversation` the id of the current talk | With a number, picks that choice, which must be one of `talk.node`'s `choices`; with null, goes on to the node's `next`, or ends the talk when the node has neither `next` nor a choice to show (core `advanceConversation`) |
| `talk.end` | `{ conversation }` | Talking | Ends the talk at once. Nothing is undone: effects happen on entering a node |
| `starter.choose` | `{ species }` | See "The starter" below | As in protocol 5 |

A talk request that matches its schema but is not allowed now is answered with `refused`:
`tooFar` (not next to that character, or the character is on another map), `notTalking`
(`talk.next` or `talk.end` with no talk open), `invalid` (an unknown character, another talk's
`conversation`, a choice the node does not show, or null where the player must choose), and
`inBattle` or `notNow` (a battle or a move offer is in the way, or already talking).

### Server to client

| Type | Payload | When |
| --- | --- | --- |
| `story` | `StoryMessage`: `{ active, done, flags }`, the saved story | After `progress` on joining and on each reconnection, and after anything that changes it |
| `talk.node` | `TalkNode`: `{ conversation, npc, node, choices, cue }` | On opening a talk and after each step that stays in it; again after a reconnection during a talk |
| `talk.ended` | `TalkEnded`: `{ conversation }` | The talk is over: the player ended it, it reached its end, a node's effect could not happen, a starter was chosen, it was left two minutes, or a battle, a leave or another device took over. `talking` turns false |
| `quest.changed` | `QuestChanged`: `{ quest, change, step, rewards, cue }` | A quest `started`, moved to its next `step`, or was `done` (`step` is then its number of steps and `rewards` the items given, what did not fit and the experience each team creature got) |

`talk.node` carries ids, not text: the client finds the line in `dialogue/<npc>.json`
(`nodes[node]`) in the player's language, and shows the choices whose places are in `choices`, in
that order. The speaker, mood and portrait come from the node and `npcs.json`. `cue` is a scene to
play (`effects/<cue>` in content/art/), `offerStarter` (below) or null. `conversation` is a number
counted across the room, so an answer to an old talk never matches a new one.

After each step that changes them the server sends, in this order: `quest.changed` for each quest
that changed, then `progress` (items and experience), then `story`, and then the `talk.node` the
step leads to, if any. A `quest.changed` with experience brings the same learning of moves as after
a battle: a move offered on a level up comes as `move.offer` just before that `progress`, and
`talk.start` is refused with `notNow` until it is answered.

### The starter

A new player has no creature (`progress.needsStarter`), so no wild creature appears for them and no
character marks a new quest. Bavko's first talk with them ends at a node with the effect
`{ "offerStarter": true }`: that `talk.node` has `cue: "offerStarter"`, and the client opens its
starter screen over the talk. The player picks with `starter.choose` as before, and the server
answers with `progress`. `starter.choose` is allowed only while the player is talking at a node
that offers the starter (core `offersStarter`) and still has no creature; otherwise it is refused
with `notTalking` or `notNow` (the rule is `STARTER_NEEDS_TALK` in `apps/server/src/talk.ts`). The
client never opens the starter screen by itself: a new player finds Bavko by his mark and a hint,
and talks to him. A chosen starter ends the open talk (`talk.ended`), since what the dialogue checks has changed. A
player who already has a creature never meets the starter node: the dialogue's `needsStarter`
condition skips it, and an `offerStarter` effect for them ends the talk instead.

### Quests

A quest has steps, done in order. `talk` and `deliver` steps are completed by a dialogue node's
`completeStep` effect (a `deliver` node also takes the item, and only opens while the player has
it); the others count world events (core `questEvent`): `winBattles` (a won wild battle, in one
zone or any), `befriend` (a befriended creature, of a species or weather type or any),
`visitShrine` (resting at that shrine) and `reach` (stepping onto or next to a point of a map's
`marks` layer, core `marksAt`). Each active quest remembers its step and the events counted for it.
Finishing the last step marks the quest `done` and gives its rewards: items, each up to its stack,
and experience to every team creature. A quest is `available` once every quest it `requires` is
done. Core `questLog` is the journal, `npcMarks` the marks over characters (`turnIn` or
`newQuest`), and `nextGoal` what to do next.

### The bag

`progress.inventory` holds every item: `quest` items (given and taken by dialogue, kept in full
when the team faints), `treat`s and `material`s. `content/inventory.json` gives each kind's stack:
how many of one item fit (core `stackLimit`). What does not fit is not added (a quest's
`rewards.extra` lists it); nothing is ever thrown away, and players cannot discard items. Core `bagView` is the bag screen: one section per kind, in `order`.

## Skills and the job board

Since protocol 8. The payload schemas are in `packages/core/src/skill-messages.ts`, the content
schemas in `skill-content.ts`, and the rules in core: levels (`skills.ts`), the tiny games and how
they are judged (`attempts.ts`), gathering and cooking (`gathering.ts`) and the board (`jobs.ts`).
Everything here goes **only to its player**, as messages; the room state shows others just
`skill` on that player, the skill being done or `''`.

A player gathers at a spot (`content/spots.json`, placed by a map's `spots` layer) and cooks at a
cooking pot (`content/stations.json`, placed by its `stations` layer), standing on a tile beside it,
not diagonally (core `spotInReach`, `stationInReach`). Each gather or cook is one attempt: a tiny
game of 3 to 5 seconds that the browser plays and the server judges. Skills need a creature: a
player still waiting for the starter is refused `notNow` (`SKILLS_NEED_STARTER` in
`apps/server/src/skills.ts`).

### Client to server

| Type | Payload | When | Effect |
| --- | --- | --- | --- |
| `gather.start` | `{ spot }` | Next to the spot, not busy | Checks the start (core `gatherRefusal`), stops any walk (the step under way still ends), turns the courier to the spot, sets `skill` and sends `skill.attempt` |
| `cook.start` | `{ recipe, station }` | Next to that cooking pot, not busy | The same with core `cookRefusal`; the ingredients are taken only on a success |
| `skill.finish` | `{ attempt, taps }`: at most `MAX_TAPS` (8) taps `{ at, place }`, `at` 0 to 20000 ms, whole, `place` 0 to 3 (0 for dip and marker) | The game of `attempt` is over | Judges the taps (core `judgeAttempt`), applies the result and sends `skill.result` |
| `skill.cancel` | `{ attempt }` | An attempt is open | Ends it as `cancelled`: nothing is used and nothing rests |
| `board.open` | `{ station }` | Next to the job board | The first open draws the board from a new seed (core `openBoard`); sends `jobs` |

Busy means in a battle, talking, a `move.offer` waiting or an attempt open. A request that matches
its schema but is not allowed now is answered with `refused`: `invalid` (an unknown spot, recipe
or station, a station of the wrong kind, or another attempt's number), `notNow` (busy, or no
creature yet), `inBattle`, `tooFar` (not next to it, or it is on another map), `needsLevel` (the
spot or recipe needs a higher level), `resting` (the spot rests for this player), `noItem` (the
ingredients are not in the bag) and `bagFull` (the spot's item or the dish is already at its
stack). The order of the checks is that of core `gatherRefusal` and `cookRefusal`.

### Server to client

| Type | Payload | When |
| --- | --- | --- |
| `skills` | `SkillsMessage`: `{ skills: [{ skill, level, xp, toNext }], resting: [{ spot, ms }] }` | After `story` on joining and on each reconnection, and after anything that changes it |
| `skill.attempt` | `SkillAttemptMessage`: `{ attempt, skill, spot, recipe, game, params, endsByMs }` | An accepted start: play `game` with `params` (core `AttemptPlan`); `spot` or `recipe` is null |
| `skill.result` | `SkillResultMessage`: `{ attempt, outcome, items, used, extra, skill, xp, level, levelUp, restMs }` | The attempt ended: `perfect`, `success`, `miss`, `late` or `cancelled`. `skill` turns `''` |
| `jobs` | `JobsMessage`: `{ board: [{ job, template, kind, item, count, to, progress }] }` | After `board.open`, after `skills` on joining once the board has been opened, and after anything that changes the board |
| `job.changed` | `JobChanged`: `{ job, change, progress, rewards, next }` | A job counted something (`progress`) or was `done`: `rewards` are the items given, what did not fit and the skills' XP and levels, and `next` the job drawn in its place |

`skill.attempt` params by game: dip `{ dipAtMs, windowMs, perfectMs }`; sparkle `{ sparkles:
[{ place, atMs, showMs }], need }`; marker `{ sweepMs, zoneFrom, zoneTo, perfectFrom, perfectTo,
timeoutMs }` (marker positions run 0 to `MARKER_TRACK`, 1000, and back, core `markerAt`). Text
never travels: names come from the content files by id.

**Order.** After an attempt: `skill.result`, then each `job.changed` and `quest.changed`, then
`progress`, `skills`, `story` and `jobs`, each only when it changed (core `skillEvent` counts the
attempt for quests and jobs in one call). After a delivery in a talk: the same from `job.changed`
on, then the `talk.node`. On joining and each reconnection: `progress`, `story`, `skills`, then
`jobs` once the board has been opened.

### How the server judges an attempt

The browser times taps with `performance.now()` from the moment it draws the game, so network
delay never shortens a window, and sends `skill.finish` when the game ends: on the tap for dip
and marker, after the last sparkle for sparkle, or with no taps when time runs out. With
`elapsed` the server's own time since it sent `skill.attempt` (constants in `attempts.ts`, pinned
by `scripts/lib/protocol-contract.test.mjs`):

- `MIN_ATTEMPT_MS` (1000): a finish sooner is a miss.
- `CLOCK_SLACK_MS` (50): a tap later than `elapsed` + 50, or taps out of order, is a miss: that
  tap had not happened yet.
- What counts is what the browser draws, with the slack for frame timing and touch delay drawn
  too. `FADE_MS` (100): a dipped float and a sparkle fade out over 100 ms once their time is up,
  and a tap while they fade still counts; a tap before they show never does.
  `MARKER_HALF_WIDTH` (20): the marker's needle is 40 track units wide, and a stop counts for a
  band whenever any part of the needle touches it.
- `LATE_MS` (5000): the server waits `endsByMs` plus 5 s for `skill.finish`, then ends the attempt
  `late`, a miss. Up to 5 s of delay on the answer costs nothing.
- Dip: the first tap counts; while the float is dipped or fading (core `dipPhase`) is a success,
  within `perfectMs` of the dip a perfect, before or after a miss. Sparkle: one sparkle shows at a
  time, the earliest not yet picked whose time has come and whose fade is not over (core
  `shownSparkle`); a tap at its `place` picks it (core `sparkleHit`). `need` of them is a
  success, all a perfect. Marker: the first tap stops it; the needle touching the zone is a
  success, touching the perfect band a perfect, no tap by `timeoutMs` a miss.

A success gives the spot's item (or the dish) and XP, and rests the spot for this player only
(`restSeconds` of its skill); a perfect gives one more within the stack. A miss, `late` or
`cancelled` uses and rests nothing. One attempt per player at a time: during it the player stands
still and meets no wild creature, and `talk.start`, `board.open` and another start are refused
`notNow`. A walk message, `skill.cancel`, leaving, a take-over, a reconnection and a battle start
end it as `cancelled`. Attempts and rests live only in the server's memory, rests by profile id,
so a reconnection keeps them and a restart clears them. The five requests share the request
limit of the battle and talk requests, `REQUESTS_PER_SECOND` (5) a second in
`apps/server/src/world-room.ts`; the extra ones are dropped without an answer.

A modified browser knows the parameters and can play perfectly, but it cannot be faster than the
game, the minimum time or the rests, so the most it gains is the perfect bonus.

### Levels, recipes and jobs

Each skill has levels 1 to `maxLevel` (`content/skills.json`); `levelCosts` is the XP from each
level to the next, and a save keeps the XP since the level was reached, so a later curve never
takes a level away. Levels unlock spots and recipes. The recipe book (core `recipeBook`) is every
recipe at or below the cooking level, plus the next locked one.

The board shows `slots` (3) jobs from `content/jobs.json`. Job `n` is drawn from an RNG seeded by
the save's `jobs.seed` and `n` (core `drawJob`), never a template already on the board, and never
the template of the job just finished while another fits. It draws only a template that fits the
player (core `jobFits`): their level of the skill its `needs` name is at least that level and
less than `outgrownAfter` levels past it, and they can get its item now, from a spot of theirs or
a recipe whose ingredients they can gather (`canGetNow`). Past `countGrowth.afterLevel` of that
skill, each level asks for `percentPerLevel` percent more items (core `jobCount`), so jobs come
fewer and richer, as XP is paid per item. A `gather` job counts that item gathered after it appeared (a
perfect counts 2), a `cook` job that dish cooked, and a `deliver` job is handed over in a talk:
the character's dialogue entry `{ "jobReady": true }` leads to a node with the effect
`{ "deliverJob": true }`, which takes the items (core `deliverJob`). A ready delivery outranks
entries marked `reminder` (core `openConversation`), so a character with the turn-in mark for it
takes it even while a quest of theirs is open. A job is done the moment its
count is reached: its rewards go in at once, within stack limits, and the next job is drawn
straight away. There is no accept, collect or swap step and no currency. Quest steps `gather`,
`cook` and `finishJobs` count the same events.

## Movement rules

The server runs core's `stepWalker` 20 times a second (`setFixedTimestep`, 50 ms) for every
player. Movement is tile by tile in four directions; players never block each other, only map
tiles do (see `docs/tiled.md`). When a step starts the player claims the next tile, so `x, y` change
at the start of a step and `moving` is true until it ends. A client can predict its own walk with
the same core functions (`createWalker`, `withIntent`, `planCommand`, `stepWalker`) and `stepMs`, and
treat the server state as the truth whenever they differ.

## Leaving, dropping and coming back

| Close code | Meaning | Reconnect? |
| --- | --- | --- |
| 4000 `CONSENTED` | The client left | No |
| 1006 and other network losses | The connection dropped | Yes: the SDK retries by itself |
| 4001 `SERVER_SHUTDOWN` | The server is restarting | Join again after a pause |
| 4002 `WITH_ERROR` | A malformed message, or too many | No; it is a bug |
| 4101 `CLOSE_CODES.replaced` | The same profile joined on another device | No; say so |
| 4102 `CLOSE_CODES.signedOut` | The profile logged out, or its session ended | No; show the profile screen |
| 4103 `CLOSE_CODES.failed` | The server hit an error with this seat alone; it was saved and ended | Join again after a pause |

An error inside the room never stops the server. An error in one player's part of a tick or of the
room's regular checks ends that player's seat with `failed` (a battle check ends only the battle);
an error handling a message ends the sender's battle, if any, as a run. Every other player goes on.

A dropped player stays in the world, standing still with `connected: false`, for three minutes
(`RECONNECT_SECONDS`). The SDK reconnects to the same `sessionId` and position.

Any other join, such as one after the server restarted or after `failed`, is a new seat. Battles
and move offers live only in the server's memory, so a new seat has none: the client forgets any
battle, offer or open team screen it was showing, and shows a battle again only when the server
sends one. The player stands where their save says, with the team as saved; a battle's start is
saved, so that is where the battle began, with the team as it was before it. A `refused` with
`notInBattle` while the client still shows a battle without its result also puts that battle away.
The player count comes from the room state, never from `welcome`: the state reaches a new seat
before `welcome` does, and may already count a player who joined in between.

## Saves

The server saves each player (save format v7, `packages/core/src/save.ts`) when they leave or
their seat expires, every 30 seconds for players who moved, when a battle starts, when they change
a setting, and when it shuts down. A save holds the
position and, since v3, the team (up to 6 creatures: species, level, xp, hp, one to four moves and
an optional nickname), storage (up to `STORAGE_LIMIT`, 200), the inventory (item id and count),
`lastShrine`, and the `seen` and `befriended` species. A save from v2 or earlier has no
creatures, so that player chooses a starter on their next visit.

Every save is checked against today's content as it loads: renamed species become the species
`creatures/renamed.json` names, then core's `sanitizeProgress` drops a creature whose species is
gone, keeps each move its species learns and fills the slots of the others from its species' moves,
caps health at full health, and drops items and `seen`/`befriended` species that are gone. A team
left empty takes the first stored creature that can battle; with no creature left at all the player
chooses a starter again. The server logs a repair as `save repaired` with the player's id and the
content ids involved, and saves the repaired data the next time it saves the player. A player
starts at their saved tile, or at the map's `player` spawn when there is no save or the saved tile
is no longer walkable.

Since v4 a save also holds `story`: `active` quests (each with its `step` index and the
`count` of events for that step, at most `MAX_ACTIVE_QUESTS`, 50), the `done` quests and the
story `flags` set, each id once and no quest both active and done. A v3 save gets an empty
story. `sanitizeProgress` leaves the story alone; right after it, the server's save repair
(`loadSaveRepair`) applies core `pruneStory` against `quests.json` and `story.json`, which drops
unknown quests and flags, and active quests whose saved step is past their steps now (they can be
started again). The `save repaired` log line then also lists `droppedQuests` and `droppedFlags`.

Since v5 a save also holds `skills` (each skill's `level` and the `xp` since reaching it; a skill
not listed is level 1 with 0 XP) and `jobs` (null until the board is first opened, then its
`seed`, how many jobs were `drawn` and `done`, and the `board`). Spot rests are not saved. A v4
save gets `skills: []` and `jobs: null`. The save repair applies core `pruneSkills` (drops skills
that are gone, holds levels at `maxLevel`) and `pruneJobs` (drops board jobs whose template, item
or character is gone; the next `board.open` refills the board), and the `save repaired` line then
also lists `droppedSkills` and `droppedJobs`.

Since v6 a save also holds `settings`, the player's own settings: `{ readToMe }`. A v5 save gets
`readToMe: false`, since sound never plays unasked.

Since v7 each creature also holds its `loadout` (one move id or null for each arena button) and
`settings` also hold `turtle`. A v6 save gets each creature's default loadout (core
`defaultLoadout`: on each button its level has unlocked, the first learned move of that button's
kind) and `turtle: false`; upgrading reads today's creature content, so `migrateSave` takes it.
`sanitizeProgress` replaces a loadout move that is not learned, of the wrong kind or on a locked
button with that default, and counts the creatures as `repairedLoadouts` in the `save repaired`
line. A level up puts the default on a button it unlocks and a newly learned move on its kind's
empty button (core `gainXp`).

**The Slice B story is a placeholder.** When the real story replaces it, a new save version resets
every player's `story` to empty, so everyone starts it from the beginning, and keeps their
creatures, items and levels. Do not build anything that depends on a placeholder quest or flag
lasting.

## The profile screen

The client starts on "Who's playing?" (`apps/game/src/profile-screen.ts`): it lists
`GET /api/profiles`, signs in with `POST /api/sessions` (the PIN typed on an on-screen number pad),
or makes a profile with `POST /api/profiles` and then signs in. A reload with a stored token joins
the world at once. "Switch player" in the settings panel leaves the room, calls
`DELETE /api/sessions/current` and forgets the token. A refused join (`AUTH_FAILED`), `signedOut` or
`replaced` forgets the token and shows the list with the reason. Development uses the same screen.

While the profile has no PIN, the settings panel also offers "Add a PIN"
(`apps/game/src/pin-setup.ts`): the same number pad (`apps/game/src/pin-pad.ts`) asks for the
PIN twice, then sends it with `PUT /api/profiles/current/pin` and says it is set. The page learns
whether the profile has a PIN from `GET /api/profiles` when it enters the world.

A locked profile's card and message say how long is left (`lockedForSeconds` or `retryAfterSeconds`),
rounded up by `apps/game/src/lock-wait.ts` ("a minute", "2 minutes", "about 10 minutes", "an
hour") and counting down while the list is open. A list of `MAX_PROFILES` hides "New player" and
says it is full. Profiles without a PIN show an outline lock, and the list a short hint to use one.

The browser check drives it like a player. Each run makes its own profile with a PIN and, against
its own server, sends its own `X-Forwarded-For` address (believed from loopback) so the
per-address limits stay out of the way; against a server given by `--url`, which may not believe
that header, the runs are spaced out instead. Against its own server it also locks profiles once
and twice, to see the one-minute and two-minute wordings, and at the end fills the list to
`MAX_PROFILES` to see the full list. At 360px wide it also signs in as a profile made without a
PIN, adds one from the settings, switches player and signs in with it.
