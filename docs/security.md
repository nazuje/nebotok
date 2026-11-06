# Security

Nebotok is a game for our children, running on the family Mac mini. The one goal that matters most:
**no malicious code should ever reach the Mac mini.** This page explains, first in plain words and
then in technical detail, how the project tries to keep that promise, and where it cannot.

## In plain words

Think of the game as a sealed box on a shelf in the house.

- **What goes into the box** is checked. The game is built from a short list of other people's
  code (libraries). We use exact versions only, wait a week before taking any new version, never let
  a library run its own setup code, and get weekly suggestions for updates that a person reviews.
- **The box is sealed.** The game runs inside a container: a locked room on the Mac with no view of
  your files, no administrator rights, and no way to change its own contents. If someone broke the
  game, they would find themselves in an empty room. A second sealed box, with no network at all,
  copies the saves to one backup folder on the Mac.
- **There is only one door, and only family has the key.** Nothing about the game is on the open
  internet or the home Wi-Fi. The game is open only to the Mac mini itself, and the Mac's own
  Tailscale passes it on, on one port (8445), to devices signed in to your family's Tailscale
  network. The game has no Tailscale identity of its own, so no rule on that network lets it reach
  anything. (Its ordinary connection goes out through the Mac; "Residual risks" explains what that
  still allows.)
- **Only boxes we built ourselves come in.** GitHub builds the game from this repository's code and
  signs a record saying so. The Mac mini checks that signature before running any new version, and
  refuses one it cannot check.
- **The helpers are watched.** AI coding agents help write this code. They cannot read the secret
  settings file, every change they make goes through a pull request that must pass the full checks
  before it joins the code, every change is checked for leaked passwords, and only a person puts a
  new version on the Mac mini.

Nothing is perfectly safe. The "Residual risks" section lists what is still possible, honestly.

## The five doors

A door is a way bad code or a stranger could get in. Each one, with what guards it.

### 1. Dependencies (other people's code)

The risk: a library we use, or one of the libraries it uses, is hijacked and a poisoned version is
published. These attacks usually run code the moment a package is installed, or are caught and pulled
within days.

| Measure | Where |
| --- | --- |
| Install scripts never run (`ignore-scripts=true`), locally, in CI and in the image build. | `.npmrc`, `Dockerfile` |
| Only versions at least 7 days old are resolved (`min-release-age=7`). | `.npmrc` |
| No dependencies straight from git repositories (`allow-git=none`). | `.npmrc` |
| Exact versions in every `package.json`, plus the lockfile, installed with `npm ci`. | `.npmrc` (`save-exact`), `package-lock.json` |
| Wrong Node version refuses to install (`engine-strict`). | `.npmrc`, `package.json` `engines` |
| Dependabot proposes updates weekly, grouped, after the same 7-day cooldown. Nothing merges by itself. | `.github/dependabot.yml` |
| The running image holds only the server's production libraries: no game libraries, no build or test tools, no npm cache. | `Dockerfile` |
| The web page may load nothing from outside its own address (Content Security Policy). | `apps/server/src/http.ts` |

Two packages have install scripts and work without them: `msgpackr-extract` (it loads its prebuilt
binary, or Colyseus falls back to plain JavaScript) and `fsevents` (an optional macOS file watcher).
If a future package truly needs its install script, run that one script from a named npm script and
document it here; never turn install scripts back on globally.

### 2. Container escape

The risk: someone finds a bug in the game server, runs code inside it, and tries to get out of the
container onto the Mac.

| Measure | Where |
| --- | --- |
| Runs as the unprivileged `node` user (uid 1000), never root. | `Dockerfile` `USER`, compose `user` |
| Root filesystem read-only; the app's own code is owned by root and cannot be changed. Writable: only `/data` (its volume) and `/tmp` (memory). | compose `read_only`, `tmpfs` |
| Every Linux capability dropped; `no-new-privileges`, so nothing can gain rights later. | compose `cap_drop`, `security_opt` |
| No host folders and no Docker socket mounted into the game. Data lives in a named Docker volume. | `compose.yaml` |
| Limits on memory (512 MB), CPU (1 core) and processes (200). | `compose.yaml` |
| Base image pinned by digest, from Docker's official Node image. | `Dockerfile` |
| Containers run inside OrbStack's Linux virtual machine, not directly on macOS. | OrbStack |
| In sidecar mode only, the Tailscale sidecar also runs with every capability dropped, read-only, in userspace mode (no network device, no admin rights). Its only host folder is `deploy/tailscale`, read-only. | `compose.tailscale.yaml` |
| The Litestream backup container is sealed the same way, as uid 1000 with no network; it alone sees a writable host folder, the backup folder (see "Backups" below). | `compose.yaml` |

`npm run verify:container` proves the seal on every run: it builds the image, starts it, and checks
from Docker's side (user, read-only root, capabilities, mounts, port, limits) and from inside (uid is
not 0, writes to `/` and to the code fail, only `/data` and `/tmp` are writable, no Docker socket).
It checks the Litestream container from Docker's side too: user, read-only root, capabilities, no
network, exactly its three mounts, limits.

### 3. Network

The risk: a stranger on the internet or the home Wi-Fi reaches the game, or a broken game reaches
other devices.

In host mode, the default:

| Measure | Where |
| --- | --- |
| The game's port is published on the Mac's `127.0.0.1` only (8567), so nothing on the home network or the internet can reach it directly. | `compose.yaml` |
| The game has no Tailscale identity of its own. The only way in from the tailnet is the Mac's own Tailscale Serve entry on HTTPS port 8445, which terminates HTTPS with a real certificate and forwards to `127.0.0.1:8567`. Who may use it is whoever the tailnet policy lets reach the Mac mini on 8445. | `scripts/serve.sh` |
| `scripts/serve.sh` changes only port 8445, refuses when 8445 already serves something else, never turns on Funnel (public internet) and fails loudly if it finds Funnel on for 8445. | `scripts/serve.sh` |
| The game believes forwarded client addresses only from its Docker network's gateway (`TRUST_PROXY`), the address every connection through the published port arrives from. Only the Mac itself and containers in OrbStack can connect from there. | `compose.yaml` |
| The backup container has no network at all; its replica is a folder, not a cloud service. | `compose.yaml` |

In sidecar mode (optional, `docs/deploy.md`):

| Measure | Where |
| --- | --- |
| No ports published on the Mac. The only way in is Tailscale, as its own device `tag:nebotok`. | `compose.tailscale.yaml` |
| Tailscale Serve terminates HTTPS with a real certificate and forwards to the game on `127.0.0.1`. Funnel (public internet) is off. | `deploy/tailscale/serve.json` |
| Tailnet policy: members may reach `tag:nebotok` on TCP 443 only, and no rule lets `tag:nebotok` reach anything. Policy tests make Tailscale refuse edits that break this. | `deploy/tailscale/policy.md` |
| Only admins can assign the tag; the auth key is single-use, tagged, short-lived. | `deploy/tailscale/policy.md` |
| The game listens on `127.0.0.1` only, inside the shared container network; Tailscale's health endpoint likewise. | `compose.tailscale.yaml` |
| Tailscale's own logging to Tailscale's servers is off (`--no-logs-no-support`). | `compose.tailscale.yaml` |

### 4. GitHub and CI

The risk: the build itself is tampered with, or the Mac mini is tricked into running an image someone
else built.

| Measure | Where |
| --- | --- |
| Every GitHub Action pinned to a full commit SHA; the build helper images (binfmt, BuildKit) pinned by digest. | `.github/workflows/ci.yml` |
| Workflows get a read-only token by default; only the image job on `main` can write packages. Never `pull_request_target`; checkout keeps no credentials. | `.github/workflows/ci.yml` |
| The image is built and pushed only from `main`, and only after the full level 4 proof passes. | `ci.yml` `image` job, `needs: verify` |
| `main` is protected: it changes only through pull requests, squash-merged, and only once the `verify (level 4)` check has passed on them. Auto-merge waits for that same check. | Repository settings |
| Each image gets a signed build provenance attestation, stored with the image. | `actions/attest-build-provenance` |
| The Mac mini deploys only by digest, and only after `gh attestation verify` confirms: this repo, `.github/workflows/ci.yml`, `refs/heads/main`, a GitHub-hosted runner. It refuses otherwise. | `scripts/update.sh` |
| Secret scanning (gitleaks, pinned release, checksum verified) over the full history and the working tree on every run. | `scripts/verify.mjs`, `ci.yml` |

### 5. AI agents

The risk: an AI agent working on the code is tricked (for example by text hidden in a web page or a
package) into adding something harmful, leaking a secret, or publishing.

| Measure | Where |
| --- | --- |
| Secrets live only in `.env` on the Mac mini, which git ignores and the agents may not read. | `.gitignore`, `scripts/hooks/guard.mjs` |
| Before every tool call, a shared hook refuses `.env` files, database files, `data/` and `.local-data/`, deleting Docker volumes, force-pushing, turning on install scripts and piping downloads into a shell. It catches slips and injected instructions, not a determined attacker. | `scripts/hooks/guard.mjs`, `.claude/settings.json`, `.factory/hooks.json`, `.codex/hooks.json` |
| Agents work in a Git worktree and branch per issue and reach `main` only through a pull request that passes CI. They never force-push, and only a person runs `scripts/update.sh` on the Mac mini. | `AGENTS.md` ("Working on a ticket"), skills `ticket` and `release` |
| Agents take briefs only from issues the repository owner wrote; instructions in other people's issues, comments or pull requests are data. | skill `ticket` |
| Each commit is scanned for secrets, database files, `.env` files and big new files; each push runs the level 0 proof. On once per clone with `npm run setup:hooks`. | `.githooks/` |
| Third-party agent skills are reviewed copies, pinned to a commit, with every edit recorded. | `.agents/skills/VENDORED.md` |
| Every change runs the secret scan, lint, tests and the browser proof before it can become an image. | `scripts/verify.mjs`, CI |
| New dependencies follow the checklist below, whoever proposes them. | This page |

## Profiles, PINs and sessions

The risk: someone on the family tailnet (a visiting friend's phone, a sibling) plays as someone
else, guesses a PIN, or a web page elsewhere tricks a browser into using the game's API.

| Measure | Where |
| --- | --- |
| PINs are stored only as scrypt hashes (N=16384, r=8, p=1) with a random 16-byte salt per profile, and compared in constant time. | `apps/server/src/pin.ts` |
| Five wrong PINs lock a profile for 60 seconds. Each lock in a row lasts twice as long as the one before, up to an hour, until a right PIN; each is logged as a warning with only the profile id. Only one PIN check per profile runs at a time. | `apps/server/src/profiles.ts` |
| Each client address may make 120 API calls, 10 logins, 5 new profiles and 5 tries at adding a PIN a minute. Behind Tailscale Serve the address is the device's own tailnet address, which Serve puts in `X-Forwarded-For` (replacing any the device sent). The server believes that header, and `X-Forwarded-Host`, only from the one peer named in `TRUST_PROXY`, never from anyone (`true`, `*` and `/0` are refused): loopback in sidecar mode, where Serve shares the game's network namespace, and in host mode the gateway of the stack's Docker network, `10.231.67.1` unless `NEBOTOK_NETWORK` moves it, which is where Docker's port forwarding from the Mac's `127.0.0.1:8567` arrives. From any other peer the header is ignored and the peer's own address counts. | `apps/server/src/config.ts`, `api.ts`, `rate-limit.ts`, `http.ts`, compose files |
| Session tokens are 32 random bytes; the database keeps only their SHA-256. A login replaces the profile's previous session; sessions end after 180 days, at logout, or when a PIN is reset. A signed-in player may add a PIN only while the profile has none, and that ends every other session of the profile, closing a seat held with one at once. | `apps/server/src/profiles.ts` |
| The world room refuses a join without a valid session, before any seat is reserved. One profile has one character; a second join takes it over and closes the first. The server has one world room, with room for twice `MAX_PROFILES`, and seats are held across rooms, so a profile can never sit twice. A reconnection and the 30-second save round look the session up again, so a PIN reset or deletion with `scripts/admin.sh`, a separate process, ends the seat too. | `apps/server/src/world-room.ts` |
| One player cannot stop the game for everyone. An error in the room is caught (`onUncaughtException`, and per seat in each tick and check), logged with ids and the error's name and message, and ends only that seat or battle. Every save is checked against content as it loads (`sanitizeProgress`), so a save naming a removed creature, move or item cannot trip a rule. | `apps/server/src/world-room.ts`, `renamed.ts`, `packages/core/src/save-repair.ts` |
| API calls that change anything must name this same host in `Origin` and send JSON. Neither the API nor Colyseus's join endpoint (`/matchmake`) sends CORS headers, so other pages cannot read their answers or send them JSON with a token. | `apps/server/src/api.ts`, `matchmake.ts` |
| API and join request bodies are at most 1 KB and checked by strict zod schemas; errors never include stack traces. Room messages are checked the same way and rate-limited: 30 a second disconnects, and `walk.to` beyond 5 a second is dropped. | `api.ts`, `world-room.ts`, `packages/core/src/profile.ts`, `protocol.ts` |
| Logs carry profile ids and counts, never names, PINs or tokens. | `apps/server/src/log.ts` callers |
| The room state other players receive holds only a name, an avatar and a position. | `apps/server/src/world-state.ts` |

Profiles are for telling children apart, not a security boundary against the family: a four-digit
PIN is easy to guess for someone who watches, and a profile without one is open to anyone on the
tailnet, who could also give it a PIN its owner does not know. A parent can reset a PIN or delete a profile with `scripts/admin.sh` (`docs/deploy.md`).
## Backups

The saves are copied out of the game's volume by a separate container, so that backing up does not
cost the game its seal (details and restore steps in `docs/deploy.md`, "Backups").

| Measure | Where |
| --- | --- |
| Litestream, pinned by digest (`litestream/litestream:0.5.17`), replicates the database to `BACKUP_DIR` on the Mac with 7 days of history. Dependabot proposes its updates with the Tailscale image's. | `compose.yaml`, `deploy/litestream/litestream.yml` |
| The Litestream container has no network (`network_mode: none`), runs as uid 1000 (not root), with a read-only root, every capability dropped, `no-new-privileges` and limits. Its config is mounted read-only. | `compose.yaml` |
| It is the only container with a host folder, and that folder is only `BACKUP_DIR`. The game still sees no host folder. A missing `BACKUP_DIR` stops the stack instead of creating a new empty folder (`create_host_path: false`). | `compose.yaml` |
| The game writes nightly snapshots with `VACUUM INTO` into its own volume; Litestream's container copies them to `BACKUP_DIR/snapshots`. Both keep 30. Copies land under a hidden name and are renamed when whole, and only if the copy is still a plain file, so a file swapped for a link meanwhile is dropped. | `apps/server/src/snapshots.ts`, `deploy/litestream/copy-snapshots.sh` |
| A restore checks the rebuilt database (full integrity check, a known schema) before swapping it in, and moves, never deletes, what it replaces, so every restore can be undone. | `scripts/restore.sh`, `apps/server/src/check-database.ts` |
| The local test backs up to its own folder (`NEBOTOK_LOCAL_BACKUP_DIR`), never `BACKUP_DIR`. `npm run verify:container` proves the seal of both containers and a full restore on every run. | `compose.local.yaml`, `scripts/lib/backup-check.mjs` |
## Residual risks

What these measures do not stop, in rough order of importance:

1. **Someone gets into the GitHub account.** They could merge their own pull request (or change the
   branch rules), and CI would build and sign their image like any other; `scripts/update.sh` would
   accept it. Protect the account with a passkey or hardware key.
2. **Pull requests merge themselves.** An agent's pull request merges once CI passes, with no person
   reading it first. CI proves that it builds, passes the tests and leaks no secret found by the
   scan, not that it is harmless. Nothing reaches the Mac mini until a person runs
   `scripts/update.sh`, so read the commits since the last deploy before running it.
3. **The game can reach the internet, the home network and the tailnet.** The containers have
   ordinary outbound access through OrbStack, which leaves through the Mac's own connections. So a
   broken game server could talk to the internet, to the router, to other devices on the home
   Wi-Fi, and, because the Mac mini is itself on the tailnet, to any tailnet device the policy lets
   the Mac mini reach, as if it were the Mac. This holds in both modes: in host mode the game has no
   Tailscale identity to limit, and in sidecar mode the `tag:nebotok` policy governs only the
   sidecar's own connection, not this one. A later phase can cut this off (for example, an internal
   Docker network with the game reachable only through a proxy); it is not done yet. Until then,
   keep the policy for the Mac mini itself as narrow as you can.
4. **A poisoned library that waits.** The 7-day delay catches attacks that are noticed quickly. One
   that ships normally and stays quiet would still run inside the game's container (with the limits
   above) and inside development and CI.
5. **Development on the Mac mini itself.** `npm test`, `npm run dev` and the build run library code as
   your user, outside any container. If you develop on the Mac mini, that code can see your files.
   Prefer developing on another computer, or treat the Mac mini as a server only.
6. **Container or VM escape.** A bug in Linux, Docker or OrbStack could let code out of the
   container. Escaping lands in OrbStack's Linux VM first, but OrbStack shares the Mac's folders with
   that VM so that bind mounts work, so assume an escape could read your files. Keep OrbStack and
   macOS updated.
7. **Trust in the tools.** Tailscale, Litestream, OrbStack, Docker's official Node image, GitHub and Sigstore (the
   signing service behind attestations) are all trusted. Their images and actions are pinned, but a
   compromise at the source before pinning would carry through.
8. **Pinned helper images age.** Dependabot updates GitHub Actions, the Dockerfile base image and the
   Tailscale and Litestream images in `compose.yaml`, but not the binfmt and BuildKit images pinned
   inside `ci.yml`. Update those by hand now and then, and `compose.local.yaml`'s Litestream pin
   with each Litestream update (`scripts/compose.test.mjs` fails until they match).
9. **Anything running on the Mac mini can claim any address to the game.** In host mode a
   connection through `127.0.0.1:8567` and one from another container in OrbStack (to the game's
   container address or to `host.docker.internal`) both arrive from the network's gateway, which the
   game trusts so that Tailscale Serve's `X-Forwarded-For` counts. A program or container on the Mac
   can therefore pick a fresh address for each request and slip past the per-address API limits. It
   cannot get past a PIN lockout, which counts per profile, and it could reach the game anyway. In
   sidecar mode the same holds for anything inside the game's network namespace, which is only
   Tailscale.
10. **The tailnet name becomes public.** HTTPS certificates are logged publicly, so the Mac mini's
    name (in sidecar mode, the game's device name) and your tailnet name are visible to anyone who
    looks. Nothing can connect without being on the tailnet.
11. **Known advisories in build tools.** See below.
12. **The database is not encrypted on disk.** Profile names, PIN hashes and saves sit in the
    `nebotok_nebotok-data` volume as a plain SQLite file, and in `BACKUP_DIR` (and so in Time
    Machine) as Litestream files and snapshots. Anyone who can read the Mac mini's Docker volumes,
    your home folder or the Time Machine disk can read them; a four-digit PIN hash can be brute-forced
    offline in seconds. FileVault and an encrypted Time Machine disk protect them when the computer
    or disk is off or stolen.
13. **A broken Litestream could write into the backup folder.** It is the one container with a
    writable host folder. A bug or poisoned Litestream release (behind the digest pin and the
    review of its update) could fill or damage `BACKUP_DIR`, though not the rest of your files. It
    also reads what the game writes: a compromised game could hand it crafted database files or huge
    snapshots, to attack Litestream or to fill the Mac's disk. The copy loop takes only plain files
    named like snapshots, never symbolic links, and keeps 30. Time Machine's older copies of the
    folder are the fallback.

## Known advisories

`npm audit` reports nothing in production dependencies. It reports 10 advisories (2 low, 8 moderate)
in development dependencies, all pulled in by `vite-plugin-pwa` through `workbox-build`, which
generates the service worker at build time:

| Package (version) | Advisory | Why it stays for now |
| --- | --- | --- |
| `glob` 11.1.0 | GHSA-3g3m-2fjr-6pw4, moderate: AbortSignal cancellation bypass | Fixed only in 14.0.2+. `workbox-build` 7.4.1 (latest) asks for `^11`. |
| `minimatch` 10.2.6, 5.1.9 | GHSA-g3hv-75wg-m249, moderate: slow matching on crafted patterns | Fixed only in 11.0.1+; `glob` 11 and `filelist` 1 ask for older majors. |
| `deepmerge` 4.3.1 | GHSA-gcqx-w48m-w2h4, low: prototype poisoning | No fixed version exists. |
| `ejs` 3.1.10, `jake` 10.9.4, `filelist` 1.0.6 | moderate, through `minimatch` | Fixed releases are new majors that `@trickfilm400/rollup-plugin-off-main-thread` 3.0.0-pre1 does not accept. |
| `@rollup/plugin-node-resolve` 16.0.3, `@trickfilm400/rollup-plugin-off-main-thread` 3.0.0-pre1, `workbox-build` 7.4.1, `vite-plugin-pwa` 2.0.0 | low/moderate, only because they depend on the above | Already the latest releases. |

npm's only offered fix (`npm audit fix --force`) downgrades to `workbox-build` 7.3.0 and
`vite-plugin-pwa` 1.1.0, a breaking change that brings back older code. Forcing newer majors with
`overrides` would run these libraries against versions they were not written for. Neither is worth
it: these tools only run during `npm run build`, on our own files, and none of them is in the image.
Recheck when `workbox-build` or `vite-plugin-pwa` releases a new version; Dependabot will propose it.

## Checklist: adding a dependency

Before `npm install <package>`:

1. **Do we need it?** Could 20 lines of our own code do the job? Fewer packages, fewer doors.
2. **Who maintains it?** Look at the npm page and the repository: several active maintainers, a
   history of releases, issues answered. Be wary of a recent change of owner.
3. **Is it widely used?** Weekly downloads in the many thousands, used by projects you recognise.
4. **What does it pull in?** `npm view <package> dependencies` and, after installing, `npm ls`.
   Prefer packages with few dependencies.
5. **Does it have install scripts?** `npm view <package> scripts`. Look for `preinstall`, `install`
   or `postinstall`. They will not run here; check that the package works without them.
6. **Is the version at least 7 days old?** `.npmrc` enforces this; do not override it.
7. **Production or development?** Only what the server needs at runtime goes in
   `apps/server/package.json` `dependencies`. Everything else is a dev dependency and stays out of
   the image.
8. **Run the proof:** `npm run verify -- --level 4`, and `npm run verify:container` if the server's
   dependencies changed. Check `npm audit`.

## Technical notes

- `.npmrc` settings apply to every npm command run in this repo, including `npm ci` in CI and in
  the Dockerfile (both copy `.npmrc` first).
- The Docker build runs `npm ci --ignore-scripts` explicitly as well, in case `.npmrc` is ever missing.
- The production image digest lives in `.env` as `NEBOTOK_DIGEST`; compose refuses to start without
  it, so the Mac mini cannot fall back to an unverified tag.
- `scripts/update.sh` resolves the digest with `docker buildx imagetools inspect`, which reads the
  registry without downloading the image, and verifies before `docker compose pull`.
- The database is SQLite through Node's built-in `node:sqlite` (`DatabaseSync`), so no native
  add-on with an install script is needed. On Node 26.13.0 it prints no experimental warning; it
  bundles SQLite 3.54.0, and `VACUUM INTO` (used for snapshots) works. It opens with WAL,
  `foreign_keys` on and a 5 second `busy_timeout`; numbered migrations in
  `apps/server/src/migrations/` run in one transaction and set `user_version`
  (`apps/server/src/db.ts`). Outside the container `DATA_DIR` defaults to `.local-data/`, which
  git and the agent guard both ignore; tests use temporary folders.
- Litestream 0.5.17 (Debian build) runs as root by default, so compose sets `user: "1000:1000"`,
  the game's `node` uid that owns the database files. It needs write access to the data volume: it
  keeps its own notes in `/data/.nebotok.db-litestream` and checkpoints the write-ahead log. Its
  `-exec` child is the snapshot copy loop: Litestream forwards SIGTERM to it, and if the loop exits,
  Litestream exits and Docker restarts the container. It has no healthcheck; `docker compose ps`
  shows whether it is running and its log shows each sync.
- Provenance verification checks the multi-platform index digest; each platform's image is addressed
  by its own digest inside that index, so the chain of hashes covers what is pulled.
- In host mode the server listens on `0.0.0.0` inside its container, because Docker's port
  forwarding arrives on the container's network interface; the published side is `127.0.0.1` on the
  Mac. `scripts/compose.test.mjs` checks the published address and, where Docker is available, that
  `compose.yaml` and `compose.yaml` plus `compose.tailscale.yaml` both validate with every seal set.
- Measured on OrbStack 2.2.4: a request to a published `127.0.0.1` port reaches the container from
  the gateway of the container's compose network, not from loopback and not from OrbStack's default
  `bridge` gateway (`192.168.215.1`, which a container started with plain `docker run` sees). So
  `compose.yaml` gives its network a fixed subnet, `10.231.67.0/28`, and sets `TRUST_PROXY` to its
  gateway; the gateway stays the same across restarts because the subnet is fixed, and
  `NEBOTOK_NETWORK` in `.env` moves both together.
  `compose.local.yaml` uses `10.231.67.16/28` so both stacks can run on one Mac, and the container
  check moves it, with its gateway, to a free `10.231.100-199.16/28` per worktree; and
  `compose.tailscale.yaml` sets `TRUST_PROXY` back to `loopback`. Tailscale Serve (1.104) keeps the
  browser's `Host` and sets `X-Forwarded-Host` to the same value, so the `Origin` check gives the
  same answer whether or not the proxy is trusted. `scripts/compose.test.mjs` checks the settings and
  `npm run verify:container` checks, through the published port, that the limits follow the
  forwarded address.
- `scripts/update.sh` removes a container only when it mounts the stack's data volume and was not
  started by Docker Compose (the hand-started game from before the stack), after `docker stop`, and
  never with `-v`.
