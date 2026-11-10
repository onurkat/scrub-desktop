#!/usr/bin/env bash
set -euo pipefail
binary=${SCRUB_BINARY:-src-tauri/target/debug/scrub-desktop}
mkdir -p .artifacts/self-test
# On failure, show what the app printed; CI logs are otherwise silent.
trap 'status=$?; if [ "$status" -ne 0 ]; then for f in .artifacts/self-test.stdout .artifacts/self-test.stderr; do [ -f "$f" ] && { echo "--- $f"; cat "$f"; }; done; fi' EXIT
printf 'previous-clipboard' | xclip -selection clipboard
SCRUB_DATA_DIR="$PWD/.artifacts/self-test" WEBKIT_DISABLE_DMABUF_RENDERER=1 timeout 60 "$binary" --self-test > .artifacts/self-test.stdout 2> .artifacts/self-test.stderr
actual=$(xclip -selection clipboard -o)
test "$actual" = previous-clipboard
printf 'Self-test exits 0 and preserves the previous clipboard after exit.\n'
printf 'release-test-owner' | xclip -selection clipboard
