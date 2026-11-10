#!/bin/bash
# Run from the project root (the folder that contains mobile/). Removes the old per-role route folders and tab icon
# that the new single (app) group replaces. If you skip this, the router sees two /tickets, /queue... and refuses to start.
set -e
cd "$(dirname "$0")/finesse" 2>/dev/null || true
rm -rf "mobile/src/app/(student)" "mobile/src/app/(staff)" "mobile/src/app/(lecturer)" "mobile/src/components/TabIcon.tsx"
echo "Old mobile routes removed."
