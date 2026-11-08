# Scrub Desktop acceptance evidence

Application source checkpoint: `8209ca0`. Linux verification on 2026-11-08.
A clean `git archive` extraction received its own `npm ci`; Node tests, Rust
tests, clippy and both Tauri bundles passed. Cargo's compilation cache was reused,
but the application was rebuilt from the extracted source (14.71 seconds).

| Acceptance | Evidence |
|---|---|
| 1 Engine parity | Node 12/12 tests pass in the working checkout; six recorded hashes and byte comparisons to the sibling upstream pass, plus four independent upstream CLI fixture comparisons. Clean extraction passes 10 tests with the two optional sibling-source comparisons skipped because upstream is absent. |
| 2 No runtime network | Linux, aarch64 macOS and x64 Windows `cargo tree --target` outputs contain no HTTP client. Canonical UI/CLI sources have no fetch/XHR/WebSocket/EventSource; CSP permits IPC only; capability grants core defaults only. External About links require an explicit click and an allowlisted native system-browser command. |
| 3 Canary privacy | `tools/qa/canary.py` passes on the release binary: unique canary absent from data, stdout/stderr, newly modified temporary files and window titles with persistence off. When opted in, only the 0600 mapping contains it. |
| 4 Review / cancel | `native-x11.sh` and `native-settings.py` pass actual X11 hotkey, item keep, category keep, copy/Enter and Escape without changing the cancelled clipboard. `notifications.py` verifies five actual native D-Bus notification deliveries (scrub, restore, empty, no detections, non-text), with no originals in messages. The isolated notification server verifies delivery; compositor toast appearance is OS-owned. |
| 5 Restore | Native repeated-token restore passes. Browser bridge regression verifies known tokens restored and unknown tokens preserved/listed; unit tests independently verify best recent-map selection. |
| 6 Continuation | Unit and browser flow tests verify reused placeholders across scrubs and New conversation restarting at EMAIL_1. |
| 7 Clipboard edge cases | Native X11 checks preserve empty, ordinary-text and PNG selections. Browser regression checks each message, hidden window, cleared stale review and Skip review; native canary and Wayland tests exercise Skip review. |
| 8 Single instance | X11 and nested Wayland commands forward to the running app. Commands carry only action flags, never clipboard text. |
| 9 Settings | Native AT-SPI/xdotool test changes the hotkey without restart, reserves a conflicting X11 combination, checks the specific error and retained old shortcut, toggles Scrub's login entry on/off, then verifies opt-in 0600 persistence and confirmed deletion. |
| 10 Dictionary / documents | Browser `documents.mjs` passes CSV import, inline edit, export and document review/save/restore. Independent Node DOCX test verifies original visible text and retained formatting. Engine source remains unchanged. |
| 11 Wayland | Nested Weston with X11 backend, real seat and pixman renderer passes focused GTK clipboard reading/writing, Skip review and single-instance restore. GNOME Wayland was unavailable; this is compositor evidence, not a claim of GNOME certification. |
| 12 CLI | Usage/errors, streams, files, DOCX, continuation and exit 3 pass. Canary checks both CLI-to-desktop and desktop-to-CLI `--last`. `npm pack` contains only the 12 whitelisted package files; installation into a separate prefix runs and returns EMAIL_1. |
| 13 Homebrew | Homebrew unavailable locally. Both formulas pass Ruby syntax review; build only from the source tarball with its measured SHA-256. No downloaded binaries or quarantine changes. Local-tap build/style/audit steps are in macOS CI. Release source artifact is prepared, not uploaded. |
| 14 CI | `actionlint` 1.7.12 passes. Ubuntu/macOS/Windows jobs run clean npm tests, Rust tests/clippy and builds; macOS local-tap install/self-test/quarantine assertion and Windows unsigned MSIX plus separate temporary signed test install are authored. They run on GitHub Actions after push. |
| 15 AppImage | Clean-source AppImage 82.26 MiB and deb 5.68 MiB built. AppImage runs with extraction mode on this FUSE-less host; its self-test exits 0 and the previous clipboard remains after exit. Native tray builder uses bundled light/dark icons. |
| 16 Locales | Exactly 34 locales, all used keys and substitutions verified by tests. Final layout run passes 340 views: five tabs × 34 languages × widths 480/800. Each tab label is checked against its locale; all UI strings come from the checked dictionaries. |
| 17 Accessibility | Browser axe reports no serious/critical issues on all five tabs. Native accessible controls drive review/settings tests. Keyboard tabs, Enter/Escape, visible focus and recorder navigation are implemented. Body is 14px or larger; compact labels are at least 12px. |
| 18 Screenshots | Refreshed all 30 en/de/ar × five-view × light/dark screenshots in `qa/screens/`; reviewed all through language contact sheets. Labels, forms, wrapping, contrast and Arabic RTL layout remain legible without overlap or horizontal clipping. |

## Reproduction

Run native tests sequentially: single-instance identity is shared even across
separate Xvfb displays. The settings harness needs Python GI/AT-SPI and the
external shortcut holder built with `cc tools/qa/hold-shortcut.c -lX11 -o .artifacts/hold-shortcut`.
It removes only the Scrub autostart entry it enables. The official autostart
plugin uses the platform home config path rather than XDG_CONFIG_HOME.

```sh
npm ci && npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings
node tools/qa/ui-flows.mjs
node tools/qa/documents.mjs
node tools/qa/i18n-ui.mjs
xvfb-run -a bash tools/qa/native-x11.sh
xvfb-run -a /usr/bin/python3 tools/qa/native-settings.py
xvfb-run -a python3 tools/qa/canary.py
xvfb-run -a bash tools/qa/wayland.sh
dbus-run-session -- xvfb-run -a /usr/bin/python3 tools/qa/notifications.py
APPIMAGE_EXTRACT_AND_RUN=1 SCRUB_BINARY=src-tauri/target/release/bundle/appimage/Scrub_1.0.0_amd64.AppImage xvfb-run -a bash tools/qa/self-test.sh
```

The Weston harness uses locally extracted Weston/wl-clipboard packages under
`.artifacts/sysroot`; adjust the executable/module paths for a system install.
Build-tool downloads via GitHub release URLs initially failed with 504; verified
official release assets were obtained through GitHub's asset API and cached
locally. `LDAI_RUNTIME_FILE` points to the cached official AppImage runtime;
`APPIMAGE_EXTRACT_AND_RUN=1` and `XDG_CACHE_HOME` select that local cache. These
are build-time tooling only and are not shipped in the application.

DOCX restoration is checked for original text and retained formatting, not
identical XML run boundaries: the unchanged upstream engine legitimately merges
runs. Cargo.lock includes Tauri's mobile-only reqwest dependency; desktop target
trees do not. Flathub is a prepared manifest, not a submitted or verified package.
No macOS/Windows execution, Store reservation, signing, publishing or push is
claimed from this Linux machine.

During QA, overlapping isolated native tests collided with the application’s single-instance identity; a fresh isolated D-Bus session also required portal startup time. Native suites are therefore run sequentially, with a bounded startup wait. These harness failures were followed by successful isolated runs; they are not suppressed application errors.

Final release-binary rerun also passed native settings in an isolated D-Bus session, canary/CLI interoperability and nested Weston. Non-accessibility suites emitted host AT-SPI socket warnings after isolated-session shutdown; clipboard assertions still passed, and the dedicated AT-SPI suite passed in its own session. Test-created Scrub autostart entry was confirmed removed.

## AUDIT-001 response

M1 and minors 1–3 are fixed. Clipboard review now leads with detected categories
and per-value decisions, followed by a scrollable preview capped at six lines.
Copy, Cancel and New conversation stay at the viewport bottom. Full app chrome
is hidden; Open Scrub restores it. The live count appears once in the heading
area, while errors can still use the status region. Existing translated strings
were reused without adding keys; the 34-locale exact-key test stays green.

macOS presentation converts accelerators to control/option/shift/command symbols
in Settings, translated messages and tray labels. Recorder values remain the
original accelerator syntax in data attributes and persisted settings. A Mac
platform browser regression verifies fields, menu labels, welcome shortcut copy
and unchanged saved Ctrl+Alt+S; native macOS CI remains the auditor's platform check.

Verification: npm test 12/12, cargo clippy --all-targets -D warnings, release
build, ui-flows.mjs, native-x11.sh and the 340-view locale matrix pass. Engines
remain byte-identical. The UI regression measures the whole first category above
the action bar at 560×640 in en/de/ar, category-before-preview order, preview
height, hidden chrome, single count and bar position before/after scrolling.
All six `qa/screens/*-clipboard-review-{light,dark}.png` screenshots were reviewed;
the first category and all primary actions are visible in each. Six affected
full-window Scrub screenshots were also refreshed. Native X11 emitted the known
host accessibility-bus warning, but all clipboard/hotkey assertions passed.

## DOCX warning delivery (2026-11-08)

Engine synced from 9ed0c6b with byte/hash parity. Documents displays content-free categories and counts from `report.skipped` in all 34 languages before saving. A conservative confirmation applies whenever the report contains notices (the general DOCX notice is always present). Cancel and Escape preserve the review without writing a document or mapping. CLI prints localized notices to stderr and requires `--save-anyway` before writing either output or mapping; `--language` overrides the environment locale.

Validation: Node 20 and Node 22 `npm test` each pass 14/14, including upstream parity, warning normalization/privacy and CLI refusal/approval. `cargo clippy --all-targets -- -D warnings` passes. `tools/qa/documents.mjs` checks Cancel, Escape, approval, mapping export and DOCX restore. The i18n matrix passes 340 views at 480/800 pixels, checks translated warning/confirmation labels in every locale and refreshes the six Documents screenshots. Arabic dark Documents screenshot inspected for wrapping and RTL alignment. npm tarball contains 47 files, including all 34 locale dictionaries and the warning adapter, excluding internal documents/context; extracted CLI successfully writes a DOCX with Turkish warnings and explicit approval.

`npm test` names `test/*.test.js` explicitly to support both Node versions without recursively discovering generated build artifacts. Field instructions remain opaque in this engine revision and receive a specific warning; follow-up engine audit work is tracked separately.

### AUDIT-007 engine sync

Engine updated to eee8f69: field instruction values now scrub/restore and every inspected part validates namespace bindings. Node 20 and 22 each pass all 14 tests, including upstream byte parity; `tools/qa/documents.mjs` passes save approval/cancellation and restore after the sync. The earlier warning-delivery note about opaque field instructions is superseded by this revision: unrecognised/unmapped field content still carries a conservative notice.
