#!/usr/bin/env bash
# Deploys Nebotok on the Mac mini, but only an image this repo's own CI built from main.
#
#   scripts/update.sh                    the newest build of main
#   scripts/update.sh sha-1a2b3c4        a specific build, by its tag
#   scripts/update.sh --digest sha256:…  a specific image digest (scripts/rollback.sh uses this)
#   --env-file FILE                      read and write FILE instead of .env (a test stack)
#   --dry-run                            look up and verify only, then say what would change
#
# It finds the image's digest without downloading it, checks GitHub's signed build attestation for
# that digest (built by .github/workflows/ci.yml in nazuje/nebotok, from refs/heads/main, on a
# GitHub-hosted runner) and stops if that fails. Only then does it write the digest to .env, pull
# and restart. The data volumes are never removed. A container started by hand on the same data
# volume (from before the compose stack) is stopped and removed first; its volume stays.
# Host mode, the default, needs nothing in .env but the digest this writes. Sidecar mode is
# COMPOSE_FILE=compose.yaml:compose.tailscale.yaml in .env (docs/deploy.md).
set -euo pipefail

IMAGE=ghcr.io/nazuje/nebotok
REPO=nazuje/nebotok
WORKFLOW=.github/workflows/ci.yml
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=$ROOT/.env
HISTORY=$ROOT/deploy/.digests
DEFAULT_BACKUP_DIR=$HOME/NebotokBackups

say() { printf 'update: %s\n' "$*"; }
die() {
  printf 'update: %s\n' "$*" >&2
  exit 1
}
usage() {
  sed -n '2,17s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
  exit "${1:-0}"
}

tag=main
digest=
dry_run=false
while (($#)); do
  case $1 in
    -h | --help) usage ;;
    --digest)
      digest=${2:-}
      [[ -n $digest ]] || usage 2
      shift
      ;;
    --env-file)
      ENV_FILE=${2:-}
      [[ -n $ENV_FILE ]] || usage 2
      shift
      ;;
    --dry-run) dry_run=true ;;
    -*) usage 2 ;;
    *) tag=$1 ;;
  esac
  shift
done
[[ $ENV_FILE == /* ]] || ENV_FILE=$PWD/$ENV_FILE

# The last KEY=value line of the settings file, without quotes; empty when there is none.
env_value() {
  [[ -f $ENV_FILE ]] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d "'\""
}
# Before the first deploy the settings file may not exist yet; compose then reads no file at all.
compose() {
  local env=$ENV_FILE
  [[ -f $env ]] || env=/dev/null
  docker compose --env-file "$env" "$@"
}

cd "$ROOT"
command -v docker >/dev/null || die "docker is not installed (OrbStack provides it)."
command -v gh >/dev/null || die "the GitHub CLI (gh) is not installed: brew install gh"
docker info >/dev/null 2>&1 || die "Docker is not running. Start OrbStack and try again."
[[ $tag =~ ^[A-Za-z0-9_.-]+$ ]] || die "that does not look like an image tag: $tag"

if [[ ${COMPOSE_FILE:-$(env_value COMPOSE_FILE)} == *compose.tailscale.yaml* ]]; then mode=sidecar; else mode=host; fi

make_backups=false
backups=${BACKUP_DIR:-$(env_value BACKUP_DIR)}
if [[ -z $backups ]]; then
  backups=$DEFAULT_BACKUP_DIR
  [[ -d $backups ]] || make_backups=true
elif [[ ! -d $backups ]]; then
  die "BACKUP_DIR ($backups) is not an existing folder. Create it, correct it in $ENV_FILE, or delete that line to use $DEFAULT_BACKUP_DIR."
fi
export BACKUP_DIR=$backups

if [[ -z $digest ]]; then
  say "looking up $IMAGE:$tag (without downloading it)"
  digest=$(docker buildx imagetools inspect "$IMAGE:$tag" --format '{{.Manifest.Digest}}') ||
    die "could not find $IMAGE:$tag. Has CI published it, and is the package public?"
  label=$tag
else
  label=digest
fi
[[ $digest =~ ^sha256:[0-9a-f]{64}$ ]] || die "not an image digest: $digest"

say "verifying that $digest was built by $REPO's CI from main"
if ! gh attestation verify "oci://$IMAGE@$digest" \
  --repo "$REPO" \
  --signer-workflow "$REPO/$WORKFLOW" \
  --source-ref refs/heads/main \
  --deny-self-hosted-runners >/dev/null; then
  die "REFUSING TO DEPLOY: the build attestation for $digest did not verify. Nothing was changed."
fi
say "attestation verified"

project=$(NEBOTOK_DIGEST=$digest compose config | sed -n 's/^name: //p') ||
  die "the compose files do not validate with these settings (see above). Nothing was changed."
services=$(NEBOTOK_DIGEST=$digest compose config --services | tr '\n' ' ')
volume=${project}_nebotok-data
# Containers that mount this stack's data volume but are not part of any compose project: a game
# started by hand with docker run before the stack existed. Two servers on one database must not
# run at once, and the old one also holds the game's port.
legacy=$(docker ps -a --filter "volume=$volume" --format '{{.Names}} {{.Label "com.docker.compose.project"}}' | awk '$2 == "" { print $1 }')
previous=$(env_value NEBOTOK_DIGEST)

if [[ $dry_run == true ]]; then
  say "dry run: nothing was changed. Without --dry-run this would:"
  say "  write NEBOTOK_DIGEST=$digest to $ENV_FILE (now: ${previous:-not set})"
  [[ $make_backups == false ]] || say "  create the backup folder $backups (readable by you only)"
  for name in $legacy; do say "  stop and remove the hand-started container $name (the volume $volume stays)"; done
  say "  pull the image and start compose project $project in $mode mode: $services"
  exit 0
fi

# Rewrite the settings through a private temporary file, so they are never left half-written or
# readable by others.
tmp=$(mktemp "$ENV_FILE.XXXXXX")
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
if [[ -f $ENV_FILE ]]; then grep -v '^NEBOTOK_DIGEST=' "$ENV_FILE" >"$tmp" || true; fi
printf 'NEBOTOK_DIGEST=%s\n' "$digest" >>"$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT

if [[ $make_backups == true ]]; then
  say "creating the backup folder $backups"
  mkdir -p "$backups"
  chmod 700 "$backups"
fi

say "pulling the verified image"
compose pull app
for name in $legacy; do
  say "stopping the hand-started container $name and removing it; the saves stay in the volume $volume"
  docker stop --time 30 "$name" >/dev/null
  docker rm "$name" >/dev/null
done
say "starting $services(waiting until every container is up and the game reports healthy)"
if ! compose up -d --wait --wait-timeout 180; then
  compose ps
  compose logs --tail 40 || true
  if [[ -n $previous && $previous != "$digest" ]]; then
    die "the new image did not turn healthy. To go back to the one before ($previous), run: scripts/rollback.sh"
  fi
  die "the stack did not turn healthy. The saves are safe in the volume $volume. See the logs above and docs/deploy.md."
fi

printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$digest" "$label" >>"$HISTORY"
compose ps
say "running $IMAGE@$digest"
if [[ -n $previous && $previous != "$digest" ]]; then
  say "previous image: $previous (scripts/rollback.sh goes back to it)"
fi
if [[ $mode == sidecar ]]; then
  say "the game's address (the containers keep Tailscale's state between updates):"
  compose exec -T ts tailscale --socket=/tmp/tailscaled.sock serve status 2>/dev/null ||
    say "could not read it here; see the Machines page in the Tailscale admin console."
else
  NEBOTOK_PORT=${NEBOTOK_PORT:-$(env_value NEBOTOK_PORT)} "$ROOT/scripts/serve.sh" status ||
    say "the game is running, but not shared on the tailnet as expected (see the line above and docs/deploy.md)."
fi
