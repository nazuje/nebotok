#!/usr/bin/env bash
# Goes back to the image that ran before the current one, using deploy/.digests (written by
# scripts/update.sh on every successful deploy). The older image's attestation is checked again.
# Running it twice brings you back to where you started. To pick any older image instead:
#   scripts/update.sh --digest sha256:…     (digests are listed in deploy/.digests)
# --env-file FILE and --dry-run work as in scripts/update.sh.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=$ROOT/.env
HISTORY=$ROOT/deploy/.digests

die() {
  printf 'rollback: %s\n' "$*" >&2
  exit 1
}

passed=()
while (($#)); do
  case $1 in
    --env-file)
      [[ -n ${2:-} ]] || die "--env-file needs a file"
      ENV_FILE=$2
      [[ $ENV_FILE == /* ]] || ENV_FILE=$PWD/$ENV_FILE
      passed+=(--env-file "$ENV_FILE")
      shift
      ;;
    --dry-run) passed+=(--dry-run) ;;
    *) die "unknown option: $1 (see the top of scripts/rollback.sh)" ;;
  esac
  shift
done

[[ -f $ENV_FILE ]] || die "$ENV_FILE is missing, so nothing has been deployed with scripts/update.sh yet."
[[ -s $HISTORY ]] || die "no deploy history yet ($HISTORY), so there is nothing to go back to."

current=$(sed -n "s/^NEBOTOK_DIGEST=//p" "$ENV_FILE" | tail -n 1 | tr -d "'\"")
previous=$(awk -v current="$current" '$2 != current { found = $2 } END { print found }' "$HISTORY")
[[ -n $previous ]] || die "every image in $HISTORY is the one running now; nothing older to go back to."

printf 'rollback: from %s\nrollback: to   %s\n' "${current:-(none)}" "$previous"
exec "$ROOT/scripts/update.sh" ${passed[@]+"${passed[@]}"} --digest "$previous"
