# Deploying Nebotok

Nebotok runs on the family Mac mini in two containers (see `compose.yaml`): Tailscale, which gives the
game its private `https://` address, and the game server. The image always comes from this repo's
GitHub Actions and is checked before it runs. Why it is set up this way: `docs/security.md`.

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

It walks through Tailscale (MagicDNS, HTTPS, the access policy, a tagged auth key), writes `.env`,
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
digest to `.env`, pulls and restarts. If verification fails it changes nothing. It waits until both
containers report healthy and records the digest in `deploy/.digests`.

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
docker compose ps                  # are both containers up and healthy?
docker compose logs -f app         # the game server's log (JSON lines); Ctrl-C to stop watching
docker compose logs --tail 100 ts  # Tailscale's log
docker compose restart app         # restart the game server
docker compose stop                # stop the game; `docker compose up -d` starts it again
```

**Never run `docker compose down -v`.** The `-v` deletes the volumes: the game's saved worlds and
the Tailscale identity (the game would join the tailnet as a new device and need a new auth key).
`docker compose down` without `-v` is fine.

If the Tailscale container is restarted on its own, the game container loses its network, because it
shares Tailscale's. `docker compose up -d` puts them back together.

## Backups

Coming in Phase 1, when worlds are saved. The saves will live in the `nebotok_nebotok-data` volume
(mounted at `/data` in the game container), and the backup will copy that volume.

## Testing the image on your own computer

```sh
npm run verify:container
```

builds the image from your working copy with `compose.local.yaml`, runs it sealed like production on
`http://127.0.0.1:2567` (this computer only), checks the seal, plays it in Chromium and WebKit, and
stops it. To poke at it by hand:

```sh
docker compose -f compose.local.yaml up -d --build --wait
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
And the data volume would live with Fly.io, so backups matter more.
