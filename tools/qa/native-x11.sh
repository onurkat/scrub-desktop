#!/usr/bin/env bash
set -euo pipefail
binary=${SCRUB_BINARY:-src-tauri/target/release/scrub-desktop}
data="$PWD/.artifacts/native-x11"
mkdir -p "$data"
printf '%s' '{"language":"en","skipReview":false,"keepMappings":false,"autostart":false,"welcomed":true,"scrubShortcut":"Ctrl+Alt+S","restoreShortcut":"Ctrl+Alt+R","dictionary":[],"detectors":{}}' > "$data/settings.json"
SCRUB_DATA_DIR="$data" WEBKIT_DISABLE_DMABUF_RENDERER=1 "$binary" > "$data/stdout" 2> "$data/stderr" &
app_pid=$!
trap 'kill "$app_pid" 2>/dev/null || true' EXIT
sleep 2
printf 'private@example.com' | xclip -selection clipboard
xdotool key ctrl+alt+s
sleep 1
window=$(xdotool search --onlyvisible --name '^Scrub$' | head -1)
test -n "$window"
xdotool windowfocus "$window" key Escape
sleep 0.2
test "$(xclip -selection clipboard -o)" = private@example.com
SCRUB_DATA_DIR="$data" "$binary" --scrub-clipboard
sleep 1
xdotool key Return
sleep 0.3
test "$(xclip -selection clipboard -o)" = '[EMAIL_1]'
printf '[EMAIL_1] [EMAIL_1]' | xclip -selection clipboard
xdotool key ctrl+alt+r
sleep 1
test "$(xclip -selection clipboard -o)" = 'private@example.com private@example.com'
test ! -e "$data/mappings.json"
printf 'X11 hotkey review, Escape cancellation, single-instance scrub and repeated-token restore pass.\n'
for text in '' 'ordinary text without sensitive details'; do
  printf '%s' "$text" | xclip -selection clipboard
  SCRUB_DATA_DIR="$data" "$binary" --scrub-clipboard
  sleep 0.5
  test "$(xclip -selection clipboard -o)" = "$text"
done
xclip -selection clipboard -t image/png -i src-tauri/icons/32x32.png
SCRUB_DATA_DIR="$data" "$binary" --scrub-clipboard
sleep 0.5
xclip -selection clipboard -t image/png -o | cmp - src-tauri/icons/32x32.png
printf 'X11 empty, no-detection and image clipboard selections remain unchanged.\n'
printf 'x11-test-complete' | xclip -selection clipboard
