#!/usr/bin/env bash
# Nightly Postgres backup. Supabase did this for you; on a VPS nothing does
# unless this runs. Install with `crontab -e` as the kris user:
#   15 3 * * * bash /home/kris/app/deploy/backup.sh >> /home/kris/backups/backup.log 2>&1
# Then copy /home/kris/backups OFF the server (rclone to S3/B2/Drive, etc.) —
# a backup on the same disk dies with the disk.
set -euo pipefail
DIR=/home/kris/backups
KEEP_DAYS=14
mkdir -p "$DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump --format=custom --no-owner krisscript > "$DIR/krisscript-$STAMP.dump"
find "$DIR" -name 'krisscript-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u) backup ok: krisscript-$STAMP.dump"
