#!/usr/bin/env bash
# Goes back to the image that ran before the current one, using deploy/.digests (written by
# scripts/update.sh on every successful deploy). The older image's attestation is checked again.
# Running it twice brings you back to where you started. To pick any older image instead:
#   scripts/update.sh --digest sha256:…     (digests are listed in deploy/.digests)
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=$ROOT/.env
HISTORY=$ROOT/deploy/.digests

die() {
  printf 'rollback: %s\n' "$*" >&2
  exit 1
}

[[ -f $ENV_FILE ]] || die ".env is missing. Run scripts/setup-mac-mini.sh first."
[[ -s $HISTORY ]] || die "no deploy history yet ($HISTORY), so there is nothing to go back to."

current=$(sed -n "s/^NEBOTOK_DIGEST=//p" "$ENV_FILE" | tail -n 1 | tr -d "'\"")
previous=$(awk -v current="$current" '$2 != current { found = $2 } END { print found }' "$HISTORY")
[[ -n $previous ]] || die "every image in $HISTORY is the one running now; nothing older to go back to."

printf 'rollback: from %s\nrollback: to   %s\n' "${current:-(none)}" "$previous"
exec "$ROOT/scripts/update.sh" --digest "$previous"
