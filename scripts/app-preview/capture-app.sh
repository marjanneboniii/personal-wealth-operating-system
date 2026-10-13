#!/bin/sh
# Screenshot every page of the app with fictional demo data, for design review.
#
#   sh scripts/app-preview/capture-app.sh [git-ref] [label] [mode]
#     git-ref  what to capture (default: origin/main)
#     label    output folder name (default: the ref's short hash)
#     mode     core    — every page, in desktop/phone/phone-dark/installed-app (default)
#              devices — the key pages on every device: 4.7″ to 6.7″ phones,
#                        Android, landscape, iPad mini/iPad/landscape, Android tablet
#
# Every page is also audited (content past the screen edge, small tap
# targets); the findings land in audit.md next to the screenshots.
#
# SAFETY — this never touches your real data:
#   • It runs a SEPARATE copy of the app (a temporary git worktree with no .env)
#     on port 3100, so your own dev server and .env are left alone.
#   • The database is the embedded in-memory one (DATABASE_URL=memory://),
#     filled with the built-in demo data and thrown away when the server stops.
#   • A preview-only login route is copied into that temporary copy only (see
#     preview-login.route.ts); it refuses to run on anything but memory://.
#   • Screenshots use the installed, Google-signed Chrome through Playwright,
#     with a throwaway profile and extensions disabled: your Chrome profile,
#     cookies and wallet extensions never load.
#
# Output: ~/Downloads/tavazon-app-preview/<label>/{desktop,phone,phone-dark,pwa}/*.png
set -u

TOOL=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$TOOL/../.." && pwd)
REF=${1:-origin/main}
MODE=${3:-core}
PORT=3100
BASE="http://localhost:$PORT"

cd "$REPO" || exit 1
git fetch -q origin 2>/dev/null
SHA=$(git rev-parse --short "$REF") || { echo "Unknown ref: $REF"; exit 1; }
LABEL=${2:-$SHA}
OUT="$HOME/Downloads/tavazon-app-preview/$LABEL"
WORK=$(mktemp -d)/app
mkdir -p "$OUT"

if curl -s -o /dev/null "$BASE"; then
  echo "Port $PORT is already in use. Stop whatever runs there and try again."
  exit 1
fi
[ -d "$TOOL/node_modules/playwright-core" ] || (cd "$TOOL" && npm install --silent) || exit 1

echo "Preparing a separate copy of $REF ($SHA)…"
git worktree add -q --detach "$WORK" "$REF" || exit 1
ln -s "$REPO/node_modules" "$WORK/node_modules"
rm -f "$WORK/.env" "$WORK/.env.local"
mkdir -p "$WORK/src/app/api/dev-preview-login"
cp "$TOOL/preview-login.route.ts" "$WORK/src/app/api/dev-preview-login/route.ts"

cleanup() {
  [ -n "${SERVER:-}" ] && kill "$SERVER" 2>/dev/null
  sleep 1
  git -C "$REPO" worktree remove --force "$WORK" 2>/dev/null
}
trap cleanup EXIT INT TERM

echo "Starting the app on the in-memory demo database (port $PORT)…"
# Extra heap: on the default one the dev server restarts itself part-way through
# ~200 page loads, which wipes the in-memory database and the session with it.
( cd "$WORK" && env -u DATABASE_URL DATABASE_URL=memory:// APP_MODE=development NODE_OPTIONS=--max-old-space-size=8192 \
    npx next dev --webpack -p "$PORT" >"$OUT/server.log" 2>&1 ) &
SERVER=$!
for _ in $(seq 1 90); do
  grep -q "Ready in" "$OUT/server.log" 2>/dev/null && break
  sleep 2
done

if [ "$MODE" = "devices" ]; then
  ROUTES="/login / /accounts /transactions /new /portfolio /assets /crypto /debts /debts/installments /budgets /goals /net-worth /reports /ledger /settings"
  export VIEWS=all
else
  ROUTES=$(cd "$WORK" && find src/app -name page.tsx | sed -E 's#^src/app##; s#/page.tsx$##; s#^$#/#' | grep -v '\[' | sort)
fi
echo "Compiling $(echo "$ROUTES" | wc -l | tr -d ' ') pages (first visit is slow in dev)…"
for route in $ROUTES; do curl -s -o /dev/null --max-time 240 "$BASE$route"; done
# Compile the preview login route too, so the first sign-in is not cut short.
curl -s -o /dev/null --max-time 240 "$BASE/api/dev-preview-login"

echo "Capturing ($MODE)…"
# shellcheck disable=SC2086
node "$TOOL/capture.mjs" "$BASE" "$OUT" $ROUTES

echo "done: screenshots in $OUT"
