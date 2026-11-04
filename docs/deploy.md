# Deploying Nebotok

Nebotok runs on the family Mac mini in three containers (see `compose.yaml`): Tailscale, which gives
the game its private `https://` address, the game server, and Litestream, which backs the saves up to
a folder on the Mac. The game's image always comes from this repo's GitHub Actions and is checked
before it runs. Why it is set up this way: `docs/security.md`.

## First-time setup

Before you start:

1. The repository is on GitHub as `nazuje/nebotok` and CI has run once on `main`, so the image
   `ghcr.io/nazuje/nebotok:main` exists (the `image` job in the Actions tab).
2. On the Mac mini: OrbStack and the GitHub CLI are installed, and `gh auth login` is done.
3. A clone of the repository on the Mac mini (only the scripts and compose files are used there).

Then run the wizard from the clone and follow it:

```sh
scripts/setup-mac-mini.sh
```

It walks through Tailscale (MagicDNS, HTTPS, the access policy, a tagged auth key), writes `.env`
(including the backup folder),
checks the macOS settings that matter (security updates, firewall, remote access, never sleep,
restart after power failure, FileVault), makes sure the image is public, starts the game with
`scripts/update.sh`, and shows how to open it on the iPad. You can stop and re-run it at any time.

The game is then at `https://nebotok.<your tailnet>.ts.net`. Open it on the iPad, not on the Mac
mini: it plays sound.

## Update

After a change lands on `main` and CI has finished:

```sh
scripts/update.sh              # the newest build of main
scripts/update.sh sha-1a2b3c4  # a specific build; the tag is in the CI run's summary
```

It looks up the image digest, verifies GitHub's signed build record for it, and only then writes the
digest to `.env`, pulls and restarts. If verification fails it changes nothing. It waits until every
container is up, and the game and Tailscale report healthy, then records the digest in
`deploy/.digests`. A restore (below) never needs an update, and an update never touches the saves.

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
docker compose ps                  # are all three containers up, and the game and Tailscale healthy?
docker compose logs -f app         # the game server's log (JSON lines); Ctrl-C to stop watching
docker compose logs --tail 100 ts  # Tailscale's log
docker compose logs --tail 20 litestream  # the backup's log
docker compose restart app         # restart the game server
docker compose stop                # stop the game; `docker compose up -d` starts it again
```

**Never run `docker compose down -v`.** The `-v` deletes the volumes: the game's saved worlds and
the Tailscale identity (the game would join the tailnet as a new device and need a new auth key).
`docker compose down` without `-v` is fine.

If the Tailscale container is restarted on its own, the game container loses its network, because it
shares Tailscale's. `docker compose up -d` puts them back together.

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

Five wrong PINs in a row lock a profile for a minute; it unlocks by itself, and `reset-pin` unlocks
it at once.

## Backups

The saves live in one SQLite file, `nebotok.db`, in the `nebotok_nebotok-data` volume (mounted at
`/data` in the game container). Two kinds of backup leave that volume for a folder on the Mac,
`BACKUP_DIR` in `.env` (the setup wizard asks for it; `~/NebotokBackups` unless you chose another):

- **Litestream** (the `litestream` container) copies every change within about a second into
  `BACKUP_DIR/litestream`. It keeps 7 days of history, so you can go back to any moment in that week.
- **Nightly snapshots.** At about 03:00 UTC the game writes a complete copy of the database into
  `/data/snapshots` (also once at the first start), keeping the last 30. The Litestream container
  copies each new one into `BACKUP_DIR/snapshots` within a minute and keeps 30 there too. Each
  snapshot is an ordinary SQLite file that opens on its own, so it still works if Litestream's
  history is ever damaged.

Only the Litestream container sees the backup folder. It has no network and runs as the same
unprivileged user as the game. The game itself still sees no host folder. If `BACKUP_DIR` is missing
or the folder does not exist, the stack refuses to start: Docker will not silently create an empty
folder in its place.

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

(`$BACKUP_DIR` is set in `.env`; in a fresh terminal type the folder's path instead.)

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
`http://127.0.0.1:2567` (this computer only), checks the seal of the game and Litestream containers,
plays it in Chromium and WebKit, proves the backups (a fresh restore from the backup folder alone
matches the live saves, the snapshot arrives, and `scripts/restore.sh` works for the newest copy, a
snapshot and `--undo`), and stops it. It backs up to a temporary folder of its own. To poke at it by
hand, give it an empty folder for its backups, never your `BACKUP_DIR`:

```sh
mkdir -p /tmp/nebotok-local-backups
export NEBOTOK_LOCAL_BACKUP_DIR=/tmp/nebotok-local-backups
docker compose -f compose.local.yaml up -d --build --wait
COMPOSE_FILE=compose.local.yaml scripts/restore.sh    # restore.sh against the local stack
docker compose -f compose.local.yaml down
```

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
