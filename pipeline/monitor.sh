#!/usr/bin/env bash
# Sample disk, memory, and CPU use every few seconds while the pipeline runs.
#
#   pipeline/monitor.sh <out.csv> [interval_seconds] &
#
# The current step is read from $PHASE_FILE (default /tmp/opendots-phase);
# write a name to it before each step. Works on Linux (GitHub runners) and
# macOS (memory columns are left empty there).
set -u
OUT=${1:?usage: monitor.sh out.csv [interval]}
INTERVAL=${2:-10}
PHASE_FILE=${PHASE_FILE:-/tmp/opendots-phase}
ROOT=$(cd "$(dirname "$0")/.." && pwd)

kb() { du -sk "$1" 2>/dev/null | cut -f1 || echo 0; }

echo "time,elapsed_s,phase,disk_used_kb,disk_avail_kb,mem_total_kb,mem_avail_kb,load1,raw_kb,work_kb,site_kb" > "$OUT"
start=$(date +%s)
while true; do
  now=$(date +%s)
  phase=$(cat "$PHASE_FILE" 2>/dev/null || echo start)
  read -r used avail < <(df -Pk "$ROOT" | awk 'NR==2 {print $3, $4}')
  if [ -r /proc/meminfo ]; then
    mem_total=$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)
    mem_avail=$(awk '/^MemAvailable:/ {print $2}' /proc/meminfo)
  else
    mem_total=; mem_avail=
  fi
  load=$(uptime | sed -E 's/.*load averages?: *([0-9.]+).*/\1/')
  echo "$(date -u +%H:%M:%S),$((now - start)),$phase,$used,$avail,$mem_total,$mem_avail,$load,$(kb "$ROOT/data/raw"),$(kb "$ROOT/data/work"),$(kb "$ROOT/site")" >> "$OUT"
  sleep "$INTERVAL"
done
