# Protocol

How the browser talks to the server: an HTTP API for profiles and sessions, then one Colyseus room,
`world`, for the shared island. The shapes live in `packages/core` (`src/protocol.ts`,
`src/profile.ts`), so client and server import the same zod schemas and constants. A change the
client relies on bumps `PROTOCOL_VERSION` (now **3**).

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
stands, and the older connection is closed with `CLOSE_CODES.replaced`.

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
```

The key of `players` is the Colyseus `sessionId`; your own is `room.sessionId`. Nothing else about a
profile is in the state.

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

A dropped player stays in the world, standing still with `connected: false`, for three minutes
(`RECONNECT_SECONDS`). The SDK reconnects to the same `sessionId` and position.

## Saves

The server saves each player's position (save format v2, `packages/core/src/save.ts`) when they
leave or their seat expires, every 30 seconds for players who moved, and when it shuts down. A player
starts at their saved tile, or at the map's `player` spawn when there is no save or the saved tile
is no longer walkable.

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
