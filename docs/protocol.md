# Protocol

How the browser talks to the server: an HTTP API for profiles and sessions, then one Colyseus room,
`world`, for the shared island. The shapes live in `packages/core` (`src/protocol.ts`,
`src/profile.ts`, and `src/messages.ts` for battles and teams), so client and server import the
same zod schemas and constants. A change the client relies on bumps `PROTOCOL_VERSION` (now **5**).

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
| `walk.to` | `{ x, y, from? }`, integers 0 to 1023 | Walk along the shortest path (core `findPath`) to that tile. A tile off the map is ignored. |
| `walk.hold` | `{ direction, from? }` | Walk that way tile after tile until `walk.stop` or another intent. At a blocked tile the player turns to face it and waits. |
| `walk.stop` | `{ from? }` | Finish the current step and stand still |

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

The battle, team and starter messages are in the next section, and the talk and quest messages in
"Talking, quests and the bag".

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

A future duel (Slice D) uses the same messages: each player gets their own view, from their side.

### Client to server

| Type | Payload | When | Effect |
| --- | --- | --- | --- |
| `starter.choose` | `{ species }` | `progress.needsStarter` (since protocol 6, also at Bavko's starter node: see "The starter") | The starter from `content/starters.json` joins the team, with the starting treats (core `chooseStarter`) |
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
| `progress` | `ProgressMessage`: `{ team, inventory, lastShrine, seen, befriended, needsStarter }` | After `welcome` and each reconnection, and after anything that changes them |
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
past that the server drops them without an answer and without closing the connection.

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
with `notTalking` or `notNow`. The server holds that rule behind `STARTER_NEEDS_TALK` in
`apps/server/src/talk.ts`. While it is `false` (until the client's talk screen can reach the
starter node), `starter.choose` is also allowed with no talk open, as in protocol 5, whenever
`needsStarter`; it is still refused with `notNow` once the player has a creature. Either way, a
chosen starter ends any open talk (`talk.ended`), since what the dialogue checks has changed. A
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

## Saves

The server saves each player (save format v4, `packages/core/src/save.ts`) when they leave or
their seat expires, every 30 seconds for players who moved, and when it shuts down. A save holds the
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
