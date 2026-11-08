#!/usr/bin/env bash
set -euo pipefail
binary=${SCRUB_BINARY:-src-tauri/target/debug/scrub-desktop}
export XDG_RUNTIME_DIR="$PWD/.artifacts/wayland-runtime"
export LD_LIBRARY_PATH="$PWD/.artifacts/sysroot/usr/lib/x86_64-linux-gnu:$PWD/.artifacts/sysroot/usr/lib/x86_64-linux-gnu/weston"
export WESTON_MODULE_MAP="x11-backend.so=$PWD/.artifacts/sysroot/usr/lib/x86_64-linux-gnu/libweston-13/x11-backend.so;kiosk-shell.so=$PWD/.artifacts/sysroot/usr/lib/x86_64-linux-gnu/weston/kiosk-shell.so"
.artifacts/sysroot/usr/bin/weston --backend=x11 --renderer=pixman --shell=kiosk-shell.so --socket=scrub-nested --idle-time=0 > .artifacts/weston-nested.log 2>&1 &
weston_pid=$!
trap 'kill "$weston_pid" 2>/dev/null || true' EXIT
sleep 1
export WAYLAND_DISPLAY=scrub-nested
printf 'wayland@example.com' | timeout 5 .artifacts/sysroot/usr/bin/wl-copy
mkdir -p .artifacts/wayland-data
printf '%s' '{"language":"en","skipReview":true,"keepMappings":false,"autostart":false,"welcomed":true,"scrubShortcut":"Ctrl+Alt+S","restoreShortcut":"Ctrl+Alt+R","dictionary":[],"detectors":{}}' > .artifacts/wayland-data/settings.json
GDK_BACKEND=wayland XDG_SESSION_TYPE=wayland SCRUB_DATA_DIR="$PWD/.artifacts/wayland-data" WEBKIT_DISABLE_DMABUF_RENDERER=1 "$binary" --scrub-clipboard > .artifacts/wayland.stdout 2> .artifacts/wayland.stderr &
app_pid=$!
trap 'kill "$app_pid" "$weston_pid" 2>/dev/null || true' EXIT
sleep 3
actual=$(timeout 5 .artifacts/sysroot/usr/bin/wl-paste --no-newline)
printf 'Wayland result: %s\n' "$actual"
test "$actual" = '[EMAIL_1]'
printf '[EMAIL_1] [EMAIL_1]' | timeout 5 .artifacts/sysroot/usr/bin/wl-copy
GDK_BACKEND=wayland XDG_SESSION_TYPE=wayland SCRUB_DATA_DIR="$PWD/.artifacts/wayland-data" "$binary" --restore-clipboard
sleep 1
test "$(timeout 5 .artifacts/sysroot/usr/bin/wl-paste --no-newline)" = 'wayland@example.com wayland@example.com'
printf 'Nested Weston: focused clipboard scrub, skip review and single-instance restore pass.\n'  
