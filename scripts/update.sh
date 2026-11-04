#!/usr/bin/env bash
# Deploys Nebotok on the Mac mini, but only an image this repo's own CI built from main.
#
#   scripts/update.sh                    the newest build of main
#   scripts/update.sh sha-1a2b3c4        a specific build, by its tag
#   scripts/update.sh --digest sha256:…  a specific image digest (scripts/rollback.sh uses this)
#
# It finds the image's digest without downloading it, checks GitHub's signed build attestation for
# that digest (built by .github/workflows/ci.yml in nazuje/nebotok, from refs/heads/main, on a
# GitHub-hosted runner) and stops if that fails. Only then does it write the digest to .env, pull
# and restart. The data volumes are never removed.
set -euo pipefail

IMAGE=ghcr.io/nazuje/nebotok
REPO=nazuje/nebotok
WORKFLOW=.github/workflows/ci.yml
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=$ROOT/.env
HISTORY=$ROOT/deploy/.digests

say() { printf 'update: %s\n' "$*"; }
die() {
  printf 'update: %s\n' "$*" >&2
  exit 1
}
usage() {
  sed -n '2,12s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
  exit "${1:-0}"
}

tag=main
digest=
case "${1:-}" in
  -h | --help) usage ;;
  --digest)
    digest=${2:-}
    [[ -n $digest ]] || usage 2
    ;;
  -*) usage 2 ;;
  "") ;;
  *) tag=$1 ;;
esac

cd "$ROOT"
command -v docker >/dev/null || die "docker is not installed (OrbStack provides it)."
command -v gh >/dev/null || die "the GitHub CLI (gh) is not installed: brew install gh"
docker info >/dev/null 2>&1 || die "Docker is not running. Start OrbStack and try again."
[[ -f $ENV_FILE ]] || die ".env is missing. Run scripts/setup-mac-mini.sh first."
[[ $tag =~ ^[A-Za-z0-9_.-]+$ ]] || die "that does not look like an image tag: $tag"

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

previous=$(sed -n "s/^NEBOTOK_DIGEST=//p" "$ENV_FILE" | tail -n 1 | tr -d "'\"")

# Rewrite .env through a private temporary file, so it is never left half-written or readable by others.
tmp=$(mktemp "$ROOT/.env.XXXXXX")
trap 'rm -f "$tmp"' EXIT
chmod 600 "$tmp"
grep -v '^NEBOTOK_DIGEST=' "$ENV_FILE" >"$tmp" || true
printf 'NEBOTOK_DIGEST=%s\n' "$digest" >>"$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT

say "pulling the verified image"
docker compose pull app
say "starting (waiting until both containers report healthy)"
if ! docker compose up -d --wait --wait-timeout 180; then
  docker compose ps
  docker compose logs --tail 40 app ts || true
  if [[ -n $previous && $previous != "$digest" ]]; then
    die "the new image did not turn healthy. To go back to the one before ($previous), run: scripts/rollback.sh"
  fi
  die "the stack did not turn healthy. See the logs above and docs/deploy.md."
fi

printf '%s %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$digest" "$label" >>"$HISTORY"
docker compose ps
say "running $IMAGE@$digest"
if [[ -n $previous && $previous != "$digest" ]]; then
  say "previous image: $previous (scripts/rollback.sh goes back to it)"
fi
say "the game's address (the containers keep Tailscale's state between updates):"
docker compose exec -T ts tailscale --socket=/tmp/tailscaled.sock serve status 2>/dev/null ||
  say "could not read it here; see the Machines page in the Tailscale admin console."
