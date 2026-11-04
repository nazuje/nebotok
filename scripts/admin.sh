#!/usr/bin/env bash
# Profile admin inside the running game container: list profiles, reset or remove a PIN, delete a
# profile. Run it on the Mac mini from the repository folder, for example:
#   scripts/admin.sh list
#   scripts/admin.sh reset-pin "Test Courier"
# See docs/deploy.md ("Profiles and PINs").
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

# A terminal gets one too; a script piping into this gets plain output.
tty_flag=()
[[ -t 0 && -t 1 ]] || tty_flag=(-T)

exec docker compose exec ${tty_flag[@]+"${tty_flag[@]}"} app node apps/server/src/admin.ts "$@"
