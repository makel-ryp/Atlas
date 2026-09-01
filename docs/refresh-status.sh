#!/usr/bin/env bash
# Regenerates the machine-checkable block in STATUS.md. Run it before you hand off,
# and any time you commit. It only rewrites the block between the AUTO markers —
# every narrative section is yours to maintain by hand.
set -euo pipefail
ROOT="$HOME/Desktop/ATR"; DEV="$HOME/dev/ATR"
OUT="$(mktemp)"
{
  echo "_Regenerated $(date '+%Y-%m-%d %H:%M %Z') by \`docs/refresh-status.sh\`._"
  echo
  echo "| repo | path | remote | branch | uncommitted | unpushed |"
  echo "| --- | --- | --- | --- | --- | --- |"
  for d in "$DEV/atlas" "$DEV/eco" "$ROOT/websites/tgt" "$ROOT/apps/RYP-RED" \
           "$ROOT/apps/locker-room" "$ROOT/apps/debrief" "$ROOT/apps/practice-dna" \
           "$ROOT/apps/inventory"; do
    n=$(basename "$d"); p="${d/#$HOME/~}"
    if [ -d "$d/.git" ]; then
      r=$(git -C "$d" config --get remote.origin.url 2>/dev/null | sed 's#.*github.com[:/]##;s#\.git$##')
      b=$(git -C "$d" rev-parse --abbrev-ref HEAD)
      u=$(git -C "$d" status --porcelain | wc -l | tr -d ' ')
      a=$(git -C "$d" rev-list --count @{u}..HEAD 2>/dev/null || echo '—')
      [ "$u" = 0 ] && u="clean" || u="**$u file(s)**"
      [ "$a" = 0 ] && a="pushed" || a="**$a ahead**"
      echo "| $n | \`$p\` | ${r:-—} | $b | $u | $a |"
    else
      echo "| $n | \`$p\` | **not a git repo** | — | — | — |"
    fi
  done
  echo
  ev=$(node -p "require('$DEV/eco/package.json').version" 2>/dev/null || echo '?')
  ap=$(git -C "$DEV/atlas" log -1 --format='%h %s' 2>/dev/null || echo '?')
  epin=$(node -p "(require('$DEV/atlas/package.json').dependencies['@ryp/eco']||'—')" 2>/dev/null || echo '?')
  echo "- **@ryp/eco version:** \`$ev\`  •  **pinned in Atlas as:** \`$epin\`"
  echo "- **Atlas HEAD:** \`$ap\`"
} > "$OUT"
python3 - "$OUT" <<'PY'
import sys, re, pathlib
block = pathlib.Path(sys.argv[1]).read_text()
f = pathlib.Path.home()/ "dev/ATR/atlas/docs/STATUS.md"
t = f.read_text()
new, n = re.subn(r"<!-- AUTO:START -->.*?<!-- AUTO:END -->",
                 lambda m: "<!-- AUTO:START -->\n" + block.strip() + "\n<!-- AUTO:END -->",
                 t, flags=re.S)
if n != 1:
    raise SystemExit("FAILED: found %d AUTO blocks in STATUS.md, expected exactly 1" % n)
f.write_text(new)
print("STATUS.md auto-block refreshed")
PY
rm -f "$OUT"
