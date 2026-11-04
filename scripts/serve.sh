#!/usr/bin/env bash
# Shares the game with the tailnet through this Mac's own Tailscale, in host mode (the default):
# https://<this Mac's name>.<tailnet>.ts.net:8445 goes to http://127.0.0.1:8567, where compose.yaml
# publishes the game.
#
#   scripts/serve.sh          add the 8445 entry if it is missing, then print the address
#   scripts/serve.sh status   print whether the game is shared, and where; changes nothing
#   scripts/serve.sh off      remove the 8445 entry
#
# It touches only HTTPS port 8445. Every other serve entry on this Mac (other apps on 443, 8443,
# 8444 and so on) stays exactly as it is, it never replaces an 8445 entry that points elsewhere,
# and it never turns on Funnel (the public internet). NEBOTOK_PORT, in the environment or .env,
# moves the game's local port; TAILSCALE names the Tailscale command if it is somewhere unusual.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ENV_FILE=$ROOT/.env
HTTPS_PORT=8445
MAC_APP_CLI=/Applications/Tailscale.app/Contents/MacOS/Tailscale

say() { printf 'serve: %s\n' "$*"; }
die() {
  printf 'serve: %s\n' "$*" >&2
  exit 1
}
usage() {
  sed -n '2,14s/^# \{0,1\}//p' "${BASH_SOURCE[0]}"
  exit "${1:-0}"
}

action=on
case "${1:-}" in
  -h | --help) usage ;;
  "") ;;
  status | off) action=$1 ;;
  *) usage 2 ;;
esac
(($# <= 1)) || usage 2

port=${NEBOTOK_PORT:-}
if [[ -z $port && -f $ENV_FILE ]]; then port=$(sed -n 's/^NEBOTOK_PORT=//p' "$ENV_FILE" | tail -n 1 | tr -d "'\""); fi
port=${port:-8567}
[[ $port =~ ^[0-9]+$ ]] || die "NEBOTOK_PORT is not a port number: $port"
target=http://127.0.0.1:$port

if [[ -n ${TAILSCALE:-} ]]; then
  ts=$TAILSCALE
elif command -v tailscale >/dev/null; then
  ts=$(command -v tailscale)
elif [[ -x $MAC_APP_CLI ]]; then
  ts=$MAC_APP_CLI
else
  die "Tailscale is not installed on this Mac. Install it from tailscale.com/download and sign in."
fi
command -v jq >/dev/null || die "jq is missing (macOS 15 and later include it; otherwise: brew install jq)"

serve_config() {
  local json
  json=$("$ts" serve status --json) || die "could not read Tailscale's serve settings. Is Tailscale running and signed in?"
  printf '%s' "${json:-"{}"}"
}

# free: nothing on the port. ours: HTTPS on the port, with "/" proxied to the game and nothing else.
# other: anything else, which is never touched.
port_state() {
  jq -r --arg port "$HTTPS_PORT" --arg target "$target" '
    (.TCP // {})[$port] as $tcp
    | [(.Web // {}) | to_entries[] | select(.key | endswith(":" + $port))] as $web
    | if $tcp == null and ($web | length) == 0 then "free"
      elif $tcp.HTTPS == true and ($web | length) == 1 and $web[0].value.Handlers == {"/": {"Proxy": $target}} then "ours"
      else "other" end' <<<"$1"
}
# What the port serves now, for a refusal message.
describe() {
  jq -r --arg port "$HTTPS_PORT" '
    [(.Web // {}) | to_entries[] | select(.key | endswith(":" + $port)) | .value.Handlers // {} | to_entries[]
      | "\(.key) -> \(.value.Proxy // .value.Path // .value.Text // "something")"]
    + [(.TCP // {})[$port] // empty | select(.TCPForward) | "TCP -> \(.TCPForward)"]
    | if length == 0 then "an entry without handlers" else join(", ") end' <<<"$1"
}
address() {
  jq -r --arg port "$HTTPS_PORT" '(.Web // {}) | keys[] | select(endswith(":" + $port)) | "https://" + .' <<<"$1" | head -n 1
}
funnel_on() {
  [[ $(jq -r --arg port "$HTTPS_PORT" '[(.AllowFunnel // {}) | to_entries[] | select(.key | endswith(":" + $port)) | .value] | any' <<<"$1") == true ]]
}
report_ours() {
  say "the game is shared on the tailnet at $(address "$1") (to $target)"
  if funnel_on "$1"; then
    die "WARNING: Funnel is on for port $HTTPS_PORT, so the game is on the public internet. Turn it off: $ts funnel --https=$HTTPS_PORT off"
  fi
}
refuse_other() {
  die "HTTPS port $HTTPS_PORT on this Mac already serves something else ($(describe "$1")). Nothing was changed."
}

config=$(serve_config)
state=$(port_state "$config")
case $action:$state in
  status:ours) report_ours "$config" ;;
  status:free)
    say "the game is not shared on the tailnet yet. To share it: scripts/serve.sh"
    exit 1
    ;;
  status:other | on:other | off:other) refuse_other "$config" ;;
  on:ours)
    say "already sharing; nothing to change"
    report_ours "$config"
    ;;
  on:free)
    say "sharing $target on HTTPS port $HTTPS_PORT (other serve entries stay as they are)"
    "$ts" serve --bg --https="$HTTPS_PORT" "$target" >/dev/null
    config=$(serve_config)
    [[ $(port_state "$config") == ours ]] || die "Tailscale did not take the setting; it now shows: $(describe "$config")"
    report_ours "$config"
    ;;
  off:free) say "the game is not shared on port $HTTPS_PORT; nothing to remove" ;;
  off:ours)
    say "removing HTTPS port $HTTPS_PORT (other serve entries stay as they are)"
    "$ts" serve --https="$HTTPS_PORT" off >/dev/null
    [[ $(port_state "$(serve_config)") == free ]] || die "port $HTTPS_PORT still has a serve entry; check: $ts serve status"
    say "the game is no longer shared on the tailnet"
    ;;
esac
