#!/bin/sh
# Screenshot web pages for design review.
#
#   sh scripts/capture-inspiration.sh                         # the inspiration sites
#   sh scripts/capture-inspiration.sh http://localhost:3000   # any URLs you pass
#
# Each URL is captured at desktop (1440px) and phone (390px) width.
# Uses the installed, Google-signed Chrome in headless mode, with a brand-new
# empty profile per capture (deleted afterwards) and extensions disabled, so
# your own profile, cookies, passwords and wallet extensions are never loaded.
# Screenshots go to ~/Downloads/tavazon-inspiration/.
set -u

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
OUT="$HOME/Downloads/tavazon-inspiration"
mkdir -p "$OUT"

if [ "$#" -gt 0 ]; then
  urls="$*"
else
  urls=""
  for site in vantaui.com designbookmark.com cuedesign.space easyui.site great-ui.com paceui.com dev.cards \
    recent.design inspora.design theinternetdesigns.com bestdesignsonx.com \
    toolcraft.sh pinui.xyz solaceui.com feralui.dev; do
    urls="$urls https://$site"
  done
fi

capture() { # url, width, height, file
  profile=$(mktemp -d)
  "$CHROME" --headless=new --disable-extensions --no-first-run --no-default-browser-check \
    --user-data-dir="$profile" --hide-scrollbars --window-size="$2,$3" \
    --virtual-time-budget=10000 --screenshot="$4" "$1" >/dev/null 2>&1 &
  pid=$!
  # Give up after 90 seconds so one slow page can't stall the rest. Heavily
  # animated pages (canvasui, metalforge) need ~45s to finish the virtual-time budget.
  ( sleep 90 && kill "$pid" 2>/dev/null ) &
  watchdog=$!
  wait "$pid" 2>/dev/null
  kill "$watchdog" 2>/dev/null
  rm -rf "$profile"
}

for url in $urls; do
  name=$(echo "$url" | sed -E 's#^https?://##; s#[/:]+#_#g; s#_$##')
  echo "capturing $url"
  capture "$url" 1440 3200 "$OUT/$name.png"
  capture "$url" 390 2400 "$OUT/$name-phone.png"
done

echo "done: $(ls "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ') screenshots in $OUT"
