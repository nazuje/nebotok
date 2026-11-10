# Deploying Nebotok

Nebotok runs on the family Mac mini in two containers (see `compose.yaml`): the game server, and
Litestream, which backs the saves up to a folder on the Mac. The game is published on the Mac at
`http://127.0.0.1:8567` only, and the Mac's own Tailscale shares it with the family's tailnet over
HTTPS on port 8445, next to whatever else the Mac already shares. This is **host mode**, the
default; **sidecar mode**, where the game is its own Tailscale device, is an option for later (see
the end of this page). The game's image always comes from this repo's GitHub Actions and is checked
before it runs. Why it is set up this way: `docs/security.md`.

## First-time setup

Before you start:

1. The repository is on GitHub as `nazuje/nebotok` and CI has run once on `main`, so the image
   `ghcr.io/nazuje/nebotok:main` exists (the `image` job in the Actions tab).
2. On the Mac mini: OrbStack, the GitHub CLI and the Tailscale app are installed, `gh auth login`
   is done, and Tailscale is signed in.
3. A clone of the repository on the Mac mini (only the scripts and compose files are used there).

Then run the wizard from the clone and follow it:

```sh
scripts/setup-mac-mini.sh
```

It checks Tailscale on the Mac (MagicDNS and HTTPS certificates on), writes `.env` (only the backup
folder), checks the macOS settings that matter (security updates, firewall, remote access, never
sleep, restart after power failure, FileVault), makes sure the image is public, starts the game with
`scripts/update.sh`, shares it with `scripts/serve.sh`, and shows how to open it on the iPad. You
can stop and re-run it at any time.

The game is then at `https://<the Mac mini's name>.<your tailnet>.ts.net:8445`; `scripts/serve.sh
status` prints the exact address. Open it on the iPad, not on the Mac mini: it plays sound.

## Sharing on the tailnet

```sh
scripts/serve.sh          # share the game on HTTPS port 8445 (does nothing if it already is)
scripts/serve.sh status   # is it shared, and at which address? Changes nothing.
scripts/serve.sh off      # stop sharing it
```

It runs `tailscale serve --bg --https=8445 http://127.0.0.1:8567` and touches nothing but port
8445: the other services the Mac shares (on 443, 8443, 8444 or anywhere else) stay exactly as they
are. If port 8445 already serves something other than the game, it refuses and changes nothing. It
never turns on Funnel, which would put the game on the public internet. The setting lives in the
Mac's Tailscale, so it survives restarts and updates. If 8567 is taken on the Mac, set
`NEBOTOK_PORT` in `.env` to another port, run `scripts/serve.sh off`, `scripts/update.sh` and then
`scripts/serve.sh`.

## Moving from the hand-started container

Before the compose stack, the game ran as a container started by hand with `docker run`, called
`nebotok-app`, publishing `127.0.0.1:8567` and keeping its saves in the volume
`nebotok_nebotok-data`, with the Mac's Tailscale already sharing it on 8445. The first update takes
it over:

```sh
scripts/update.sh --dry-run   # checks the image and lists what it would do; changes nothing
scripts/update.sh
scripts/serve.sh status       # still shared on 8445, to 127.0.0.1:8567
```

`scripts/update.sh` verifies the image, writes `.env` (just `NEBOTOK_DIGEST`), creates
`~/NebotokBackups` if `BACKUP_DIR` is not set, and pulls. Then it stops `nebotok-app` (`docker
stop`, so the game shuts down cleanly), removes the container (`docker rm`, never with `-v`) and
starts the stack as compose project `nebotok`. Its volume is the same `nebotok_nebotok-data`, so
every save carries over. Docker Compose warns once that this volume "already exists but was not
created by Docker Compose"; that is expected. The game is away for the few seconds until the new
container is healthy, and the 8445 entry needs no change. It finds the old container by what it
does, not by its name: any container that uses the stack's data volume and was not started by
Docker Compose.

## Update

After a change lands on `main` and CI has finished:

```sh
scripts/update.sh              # the newest build of main
scripts/update.sh sha-1a2b3c4  # a specific build; the tag is in the CI run's summary
scripts/update.sh --dry-run    # look up and verify only, and say what would change
```

It looks up the image digest, verifies GitHub's signed build record for it, and only then writes the
digest to `.env`, pulls and restarts. If verification fails it changes nothing. It waits until every
container is up and the game reports healthy, records the digest in `deploy/.digests`, and prints
the game's address (`scripts/serve.sh status`). A restore (below) never needs an update, and an
update never touches the saves. In host mode `.env` needs nothing but the digest it writes;
`BACKUP_DIR` defaults to `~/NebotokBackups`, which it creates when missing. `--env-file FILE` makes
it read and write another settings file instead of `.env`, for a test stack.

Players get the new version by themselves: the game's page always comes from the server first, and an open game
offers "New version: tap to update" when it comes back into view. A game the new server refuses (a changed protocol)
reloads onto the new version once by itself, then shows a Reload button that clears the old copy.

The stack's Docker network always has the address range `10.231.67.0/28`, so the game knows which
address Tailscale Serve's requests arrive from (`docs/security.md`, "Profiles, PINs and sessions").
If an update fails with "Pool overlaps with other one on this address space", another Docker network
on the Mac already uses that range: set `NEBOTOK_NETWORK` in `.env` to three other numbers, such as
`10.231.68`, and run `scripts/update.sh` again. A test stack started with `--env-file` next to the
real one needs its own `NEBOTOK_NETWORK` (and `NEBOTOK_PORT`) in its settings file.

## Roll back

```sh
scripts/rollback.sh
```

Goes back to the image that ran before the current one (checked again before it runs). Running it
twice returns to where you started. For an older image, pick a digest from `deploy/.digests`:

```sh
scripts/update.sh --digest sha256:...
```

## Everyday commands

Run these from the clone on the Mac mini.

```sh
docker compose ps                  # are both containers up, and the game healthy?
docker compose logs -f app         # the game server's log (JSON lines); Ctrl-C to stop watching
docker compose logs --tail 20 litestream  # the backup's log
docker compose restart app         # restart the game server
docker compose stop                # stop the game; `docker compose up -d` starts it again
scripts/serve.sh status            # is it shared on the tailnet, and where?
curl -fsS http://127.0.0.1:8567/healthz   # does the game answer on the Mac itself?
```

**Never run `docker compose down -v`.** The `-v` deletes the volumes: the game's saved worlds (and,
in sidecar mode, the Tailscale identity). `docker compose down` without `-v` is fine.

## Profiles and PINs

Each child picks or makes a profile in the game, optionally with a four-digit PIN. When a PIN is
forgotten, or a profile has to go, run on the Mac mini from the clone:

```sh
scripts/admin.sh list                      # every profile: id, name, avatar, PIN, lock
scripts/admin.sh reset-pin "Name Here"     # a new random PIN, printed once; signs the profile out
scripts/admin.sh remove-pin "Name Here"    # no PIN any more
scripts/admin.sh delete "Name Here"        # the profile and its progress, for good
```

Names match in any capitals. The script runs `node apps/server/src/admin.ts` inside the running
game container (`docker compose exec app …`), against the same database. Names and the new PIN
appear only in your terminal, never in the server's log. A reset or deletion takes effect at the
child's next join: a game already open keeps playing until it reconnects. On a development computer,
`node apps/server/src/admin.ts list` works the same against `.local-data/`.

Five wrong PINs in a row lock a profile for a minute, and each lock after that twice as long, up to
an hour, until the right PIN. It unlocks by itself, and `reset-pin` unlocks it at once. A reset or a
delete closes that player's open game within 30 seconds.

## Backups

The saves live in one SQLite file, `nebotok.db`, in the `nebotok_nebotok-data` volume (mounted at
`/data` in the game container). Two kinds of backup leave that volume for a folder on the Mac,
`BACKUP_DIR` in `.env` (the setup wizard asks for it; `~/NebotokBackups` when it is not set):

- **Litestream** (the `litestream` container) copies every change within about a second into
  `BACKUP_DIR/litestream`. It keeps 7 days of history, so you can go back to any moment in that week.
- **Nightly snapshots.** At about 03:00 UTC the game writes a complete copy of the database into
  `/data/snapshots` (also once at the first start), keeping the last 30. The Litestream container
  copies each new one into `BACKUP_DIR/snapshots` within a minute and keeps 30 there too. Each
  snapshot is an ordinary SQLite file that opens on its own, so it still works if Litestream's
  history is ever damaged.

Only the Litestream container sees the backup folder. It has no network and runs as the same
unprivileged user as the game. The game itself still sees no host folder. If the backup folder does
not exist, the stack refuses to start: Docker will not silently create an empty folder in its place.
`scripts/update.sh` creates only the default `~/NebotokBackups`; a `BACKUP_DIR` you set must exist.

**Time Machine.** Docker volumes live inside OrbStack's virtual machine, which Time Machine does not
reliably back up. That is why the backups go to a folder in your home folder: Time Machine copies
`BACKUP_DIR` like any other folder, so a backup survives even if the Mac mini's disk dies. Make sure
Time Machine is on and that `BACKUP_DIR` is not in its exclusions. The backups are not encrypted
apart from FileVault on the Mac and the Time Machine disk's own encryption (turn that on when you
set up the disk).

To check that backups are flowing:

```sh
docker compose logs --tail 20 litestream  # "snapshot complete", "compaction complete", no ERROR
ls "$BACKUP_DIR"/snapshots                 # nebotok-<date>T<time>Z.db, newest last
```

(`$BACKUP_DIR` is the backup folder, `~/NebotokBackups` unless `.env` names another; in a fresh
terminal type the folder's path instead.)

### Restore

Run on the Mac mini from the clone. Each form asks before it changes anything:

```sh
scripts/restore.sh                                    # the newest copy, seconds old
scripts/restore.sh --time 2026-11-04T18:30:00Z        # as it was then (UTC; Slovenia is UTC+1, +2 in summer)
scripts/restore.sh --list                             # the nightly snapshots in the backup folder
scripts/restore.sh --snapshot nebotok-20261104T030512Z.db
scripts/restore.sh --undo 20261104T183512Z            # put back what a restore replaced
```

It stops the game and Litestream, rebuilds the database in a staging folder, checks it (SQLite's
full integrity check, a save format this server knows) and only then swaps it in and starts
everything again. It prints how many profiles the restored database holds. Anyone playing at that
moment loses what they did since the point you restore to.

Nothing is deleted. The database it replaced moves to `before-restore-<stamp>` in the data volume,
which is what `--undo <stamp>` puts back (the script prints the exact command). Litestream's history
moves to `BACKUP_DIR/litestream-before-restore-<stamp>`, and Litestream starts a fresh history from
the restored database. Once you are happy with a restore, those folders can go: delete the ones in
`BACKUP_DIR` in Finder.

**After losing the whole Mac mini:** set up the new one with `scripts/setup-mac-mini.sh`, then
before (or instead of) starting the game, copy the backup folder back from Time Machine into the
`BACKUP_DIR` you chose, and run `scripts/restore.sh`. If Litestream's history is damaged, use
`scripts/restore.sh --list` and `--snapshot` instead.

## Testing the image on your own computer

```sh
npm run verify:container
```

builds the image from your working copy with `compose.local.yaml`, runs it sealed like production on
a free port of `127.0.0.1` (this computer only), checks the seal of the game and Litestream
containers, plays it in Chromium and WebKit, proves the backups (a fresh restore from the backup folder alone
matches the live saves, the snapshot arrives, and `scripts/restore.sh` works for the newest copy, a
snapshot and `--undo`), and stops it. It backs up to a temporary folder of its own. Each worktree
gets its own compose project (`nebotok-local-<id>`), image tag, port and network, so checks in
several worktrees can run at once; each project keeps its own data volume. Each run first deletes
the test players earlier runs left in that volume, so it can be run again and again.

A worktree's volume, `nebotok-local-<id>_nebotok-data`, stays behind after the worktree is
removed. It holds only test players. To list them, and remove one whose worktree is gone:

```sh
docker volume ls --filter name=nebotok-local-     # every local test volume, never the game's own
docker volume rm nebotok-local-<id>_nebotok-data  # one of them, copied from that list
```

Remove only names that start with `nebotok-local-`. The family's saves are in
`nebotok_nebotok-data`, which must never be removed. Docker refuses to remove a volume a container
still uses; a worktree whose volume you removed simply starts its next check with an empty one.

To poke at the local stack by hand, give it an empty folder for its backups, never your
`BACKUP_DIR`:

```sh
mkdir -p /tmp/nebotok-local-backups
export NEBOTOK_LOCAL_BACKUP_DIR=/tmp/nebotok-local-backups
docker compose -f compose.local.yaml up -d --build --wait
COMPOSE_FILE=compose.local.yaml scripts/restore.sh    # restore.sh against the local stack
docker compose -f compose.local.yaml down
```

## Sidecar mode

Host mode is enough for the family: every device on the tailnet that may reach the Mac mini can
open the game, and the game needs no Tailscale identity. Sidecar mode gives the game its own
Tailscale device instead, `tag:nebotok`, in a container next to it (`compose.tailscale.yaml`), with
its own address `https://nebotok.<your tailnet>.ts.net`. Choose it when the tailnet's policy has to
treat the game apart from the Mac: for example friends' devices that may reach the game but not the
Mac mini, or a host that runs no Tailscale of its own (on Fly.io, below). The game then publishes no
port on the Mac at all.

To switch:

```sh
scripts/setup-mac-mini.sh --sidecar   # the tailnet policy, a tagged auth key, and .env
scripts/serve.sh off                  # the Mac's own 8445 entry is no longer needed
scripts/update.sh                     # starts Tailscale next to the game
```

The wizard walks through `deploy/tailscale/policy.md` and the auth key, and writes `TS_AUTHKEY`,
`TS_HOSTNAME` and `COMPOSE_FILE=compose.yaml:compose.tailscale.yaml` to `.env`. Docker Compose reads
`COMPOSE_FILE` itself, so `scripts/update.sh`, `rollback.sh`, `restore.sh`, `admin.sh` and every
`docker compose` command then use both files. `docker compose logs --tail 100 ts` shows Tailscale's
log. If the Tailscale container is restarted on its own, the game container loses its network,
because it shares Tailscale's; `docker compose up -d` puts them back together.

To go back to host mode: `docker compose down` (no `-v`, so the Tailscale identity stays for next
time), delete those three lines from `.env`, then `scripts/update.sh` and `scripts/serve.sh`.

## Moving to Fly.io later

The image already works on Fly.io as it is: it listens on `PORT` (2567), answers `/healthz`, keeps
its data in `DATA_DIR` (`/data`), logs JSON to stdout, and shuts down cleanly on SIGTERM. A starting
`fly.toml`:

```toml
app = "nebotok"
primary_region = "ams"

[build]
  image = "ghcr.io/nazuje/nebotok@sha256:..."   # a verified digest, as on the Mac mini

[env]
  HOST = "0.0.0.0"
  PORT = "2567"
  DATA_DIR = "/data"

[mounts]
  source = "nebotok_data"
  destination = "/data"

[http_service]
  internal_port = 2567
  force_https = true
  auto_stop_machines = "off"

  [[http_service.checks]]
    method = "GET"
    path = "/healthz"
    interval = "30s"
    timeout = "5s"
```

Before deploying, run the same check `scripts/update.sh` does:
`gh attestation verify oci://ghcr.io/nazuje/nebotok@sha256:... --repo nazuje/nebotok --signer-workflow nazuje/nebotok/.github/workflows/ci.yml --source-ref refs/heads/main`.

Two things change on Fly.io. The game would be on the public internet instead of only on the
tailnet, so it would need its own sign-in, or Tailscale inside the Fly machine to keep it private.
And the data volume would live with Fly.io, so backups matter more: Litestream's replica would then
point at object storage (an `s3://` URL in `deploy/litestream/litestream.yml`) instead of a folder.
