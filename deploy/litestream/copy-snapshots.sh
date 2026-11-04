#!/bin/sh
# Runs inside the Litestream container, as the child process `litestream replicate -exec` watches:
# if this loop ever stops, Litestream stops too and Docker restarts both.
#
# The game writes a snapshot of its database every night into /data/snapshots (keeping 30). This
# copies each new one into the backup folder, /backups/snapshots, and keeps the newest 30 there too.
# A copy lands under a hidden name first and is renamed when whole.
set -u

SOURCE=/data/snapshots
TARGET=/backups/snapshots
KEEP=30

copy_new() {
  for file in "$SOURCE"/nebotok-*Z.db; do
    [ -f "$file" ] || continue
    name=${file##*/}
    [ -e "$TARGET/$name" ] && continue
    if cp "$file" "$TARGET/.partial-$name" && mv "$TARGET/.partial-$name" "$TARGET/$name"; then
      printf '{"level":"INFO","msg":"snapshot copied to the backup folder","file":"%s"}\n' "$name"
    else
      rm -f "$TARGET/.partial-$name"
      printf '{"level":"ERROR","msg":"could not copy a snapshot to the backup folder","file":"%s"}\n' "$name"
    fi
  done
}

# The glob sorts the names, and the names sort by time: the first ones beyond KEEP are the oldest.
prune_old() {
  set -- "$TARGET"/nebotok-*Z.db
  [ -f "$1" ] || return 0
  extra=$(($# - KEEP))
  while [ "$extra" -gt 0 ]; do
    rm -f "$1"
    shift
    extra=$((extra - 1))
  done
}

trap 'exit 0' TERM INT
mkdir -p "$TARGET"
while :; do
  copy_new
  prune_old
  # Waiting on a background sleep lets the TERM trap run at once.
  sleep 30 &
  wait $!
done
