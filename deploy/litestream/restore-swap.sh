#!/bin/sh
# Runs inside a one-off Litestream container for scripts/restore.sh, with the game and Litestream
# stopped:  sh /etc/litestream/restore-swap.sh SOURCE_DIR STAMP
# Moves the current database (and Litestream's notes on it) into /data/before-restore-STAMP, moves
# the checked one from SOURCE_DIR into its place, and moves Litestream's history in the backup folder
# aside, so Litestream starts a new history from the restored database. Moves only, never deletes.
set -eu

source=$1
aside=/data/before-restore-$2

mkdir "$aside"
for name in nebotok.db nebotok.db-wal nebotok.db-shm .nebotok.db-litestream; do
  if [ -e "/data/$name" ]; then mv "/data/$name" "$aside/"; fi
done
for name in nebotok.db nebotok.db-wal nebotok.db-shm; do
  if [ -e "$source/$name" ]; then mv "$source/$name" "/data/$name"; fi
done
rmdir "$source" 2>/dev/null || true
if [ -e /backups/litestream ]; then mv /backups/litestream "/backups/litestream-before-restore-$2"; fi
