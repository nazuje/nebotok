#!/usr/bin/env bash
# Puts the game's database back from the backup folder (BACKUP_DIR), on the Mac mini.
#
#   scripts/restore.sh                             the newest copy, a few seconds old
#   scripts/restore.sh --time 2026-11-04T18:30:00Z as it was at that moment (UTC), up to 7 days back
#   scripts/restore.sh --snapshot NAME             a nightly snapshot, e.g. nebotok-20261104T030512Z.db
#   scripts/restore.sh --list                      the nightly snapshots in the backup folder
#   scripts/restore.sh --undo STAMP                put back the database a restore replaced
#   Add --yes to skip the question.
#
# It stops the game and Litestream, rebuilds the database in a staging folder in the data volume,
# checks it, and only then swaps it in. Nothing is deleted: the database it replaces moves to
# before-restore-STAMP in the data volume, and Litestream's history to
# BACKUP_DIR/litestream-before-restore-STAMP, so Litestream starts a new history from the restored
# database. Then everything starts again.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SNAPSHOT_NAME='^nebotok-[0-9]{8}T[0-9]{6}Z\.db$'
STAMP_FORMAT='^[0-9]{8}T[0-9]{6}Z$'
TIME_FORMAT='^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'

say() { printf 'restore: %s\n' "$*"; }
die() {
  printf 'restore: %s\n' "$*" >&2
  exit 1
}
usage() {
  sed -n '2,15s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
  exit "${1:-0}"
}

mode=latest
value=
yes=false
while (($#)); do
  case $1 in
    -h | --help) usage ;;
    --yes) yes=true ;;
    --list) mode=list ;;
    --time | --snapshot | --undo)
      mode=${1#--}
      value=${2:-}
      [[ -n $value ]] || usage 2
      shift
      ;;
    *) usage 2 ;;
  esac
  shift
done
case $mode in
  time) [[ $value =~ $TIME_FORMAT ]] || die "give the time in UTC like 2026-11-04T18:30:00Z, not: $value" ;;
  snapshot) [[ $value =~ $SNAPSHOT_NAME ]] || die "not a snapshot name (see --list): $value" ;;
  undo) [[ $value =~ $STAMP_FORMAT ]] || die "not a restore stamp like 20261104T183000Z: $value" ;;
esac

cd "$ROOT"
command -v docker >/dev/null || die "docker is not installed (OrbStack provides it)."
docker info >/dev/null 2>&1 || die "Docker is not running. Start OrbStack and try again."
services=$(docker compose config --services) || die "docker compose could not read the stack (is .env there, with BACKUP_DIR?)"
grep -qx litestream <<<"$services" || die "this stack has no litestream service"

# A one-off Litestream container: it has the data volume at /data and the backup folder at /backups.
in_litestream() { docker compose run --rm --no-deps -T --entrypoint "$1" litestream "${@:2}"; }

if [[ $mode == list ]]; then
  in_litestream ls -1 /backups/snapshots | grep -E "$SNAPSHOT_NAME" || say "no snapshots in the backup folder yet"
  exit 0
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
case $mode in
  latest) what="the newest copy in the backup folder" ;;
  time) what="the backup as it was at $value" ;;
  snapshot) what="the nightly snapshot $value" ;;
  undo) what="the database that the restore at $value replaced" ;;
esac
if [[ $yes != true ]]; then
  say "this replaces the game's saves with $what."
  say "Anyone playing now loses what they did since then. The current saves are kept, not deleted."
  read -r -p "restore: type yes to go on: " answer
  [[ $answer == yes ]] || die "nothing was changed."
fi

say "stopping the game and Litestream"
docker compose stop app litestream
# The check below runs in the game's image, which shares the Tailscale container's network.
if grep -qx ts <<<"$services"; then docker compose up -d --wait ts; fi

# Before the swap nothing has changed yet, so a failure only has to start the game again.
fail() {
  say "$1. The saves were not changed; starting the game again."
  [[ $mode == undo ]] || in_litestream rm -rf "/data/restore-$stamp" || true
  docker compose up -d --wait --wait-timeout 180 || true
  exit 1
}

source=/data/restore-$stamp
case $mode in
  latest) in_litestream litestream restore -integrity-check full -o "$source/nebotok.db" file:///backups/litestream || fail "Litestream could not rebuild the database" ;;
  time) in_litestream litestream restore -integrity-check full -timestamp "$value" -o "$source/nebotok.db" file:///backups/litestream || fail "Litestream could not rebuild the database at $value" ;;
  snapshot)
    in_litestream mkdir -p "$source" || fail "could not make the staging folder"
    in_litestream cp "/backups/snapshots/$value" "$source/nebotok.db" || fail "could not copy the snapshot $value"
    ;;
  undo)
    source=/data/before-restore-$value
    in_litestream test -f "$source/nebotok.db" || fail "there is no database in before-restore-$value"
    ;;
esac

say "checking the rebuilt database"
summary=$(docker compose run --rm --no-deps -T --entrypoint node app apps/server/src/check-database.ts "$source/nebotok.db") ||
  fail "the rebuilt database did not pass its check"
say "it holds $summary"

say "swapping it in; the replaced database goes to before-restore-$stamp in the data volume"
in_litestream sh /etc/litestream/restore-swap.sh "$source" "$stamp" ||
  die "the swap stopped halfway. The game is stopped; the replaced database is in before-restore-$stamp. See docs/deploy.md, Backups."

say "starting everything again"
docker compose up -d --wait --wait-timeout 180 ||
  die "the game did not turn healthy on the restored database. To go back: scripts/restore.sh --undo $stamp"
say "done. Restored $what ($summary)."
say "changed your mind? scripts/restore.sh --undo $stamp puts back what was there before."
