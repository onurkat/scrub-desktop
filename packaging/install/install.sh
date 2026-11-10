#!/bin/sh
main() (
  set -eu
  version=${SCRUB_VERSION:-1.0.4}
  cli_only=0 system=0 hook=0 uninstall=0 dry=0
  manual=https://github.com/onurkat/scrub-desktop#install
  fail() { printf '%s\n' "$*" >&2; exit 1; }
  while [ "$#" -gt 0 ]; do
    case $1 in
      --cli-only) cli_only=1;; --system) system=1;;
      --with-claude-code) hook=1;; --uninstall) uninstall=1;; --dry-run) dry=1;;
      --version) shift; [ "$#" -gt 0 ] || fail '--version requires X.Y.Z or latest'; version=$1;;
      --help|-h) printf '%s\n' 'Scrub installer: --cli-only --system --version X.Y.Z|latest --with-claude-code --uninstall --dry-run --help'; exit 0;;
      *) fail "Unknown option: $1";;
    esac
    shift
  done
  case $version in latest) ;; *) printf '%s\n' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || fail 'Invalid version';; esac
  os=$(uname -s); arch=$(uname -m)
  case $os in Linux) platform=linux;; Darwin) platform=darwin;; *) fail "Unsupported OS $os. See $manual";; esac
  case $arch in x86_64|amd64) arch=x64; apparch=amd64;; arm64|aarch64) arch=arm64; apparch=aarch64;; *) fail "Unsupported architecture $arch. See $manual";; esac
  share=$HOME/.local/share/scrub
  manifest=$share/install-manifest
  bin=$HOME/.local/bin
  app=$HOME/.local/lib/scrub/Scrub.AppImage
  macapp=$HOME/Applications/Scrub.app
  [ "$system" = 0 ] || macapp=/Applications/Scrub.app
  # A manifest can only name these owned files, never arbitrary user data.
  valid_path() {
    case $1 in
      "$bin/scrub"|"$bin/scrub-desktop"|"$app"|"$HOME/Applications/Scrub.app"|/Applications/Scrub.app|"$HOME/.local/share/applications/scrub.desktop"|"$HOME/.local/share/icons/hicolor/128x128/apps/scrub.png"|deb:scrub|hook:claude-code) return 0;;
      *) return 1;;
    esac
  }
  if [ -f "$manifest" ]; then
    while IFS= read -r path; do valid_path "$path" || fail 'Invalid installation manifest; no files changed'; done < "$manifest"
  fi
  if [ "$uninstall" = 1 ]; then
    [ -f "$manifest" ] || { printf '%s\n' 'No managed installation found.'; exit 0; }
    if grep -Fxq 'hook:claude-code' "$manifest"; then
      printf '%s\n' 'Remove Scrub Claude Code user hook (preserve other hooks)'
      [ "$dry" = 1 ] || "$bin/scrub" hook uninstall claude-code --user
    fi
    while IFS= read -r path; do
      printf 'Remove %s\n' "$path"
      [ "$dry" = 0 ] || continue
      case $path in
        hook:*) ;; deb:scrub) sudo apt remove -y scrub;;
        /Applications/Scrub.app) rm -rf -- "$path" || sudo rm -rf -- "$path";;
        *) rm -rf -- "$path";;
      esac
    done < "$manifest"
    [ "$dry" = 1 ] || rm -f -- "$manifest"
    printf '%s\n' 'Scrub uninstalled; settings and mappings preserved.'
    exit 0
  fi
  if [ "$system" = 1 ] && [ "$os" = Linux ] && [ "$cli_only" = 0 ]; then
    command -v apt >/dev/null || fail "--system requires Debian/Ubuntu. See $manual"
    if dpkg-query -W -f='${Status}' scrub 2>/dev/null | grep -q 'install ok installed'; then
      if [ ! -f "$manifest" ] || ! grep -Fxq deb:scrub "$manifest"; then
        fail 'An unmanaged Debian installation exists; use apt to manage it.'
      fi
    fi
  fi
  base=${SCRUB_BASE_URL:-https://github.com/onurkat/scrub-desktop/releases/download/v$version}
  if [ "$version" = latest ] && [ -z "${SCRUB_BASE_URL:-}" ]; then base=https://github.com/onurkat/scrub-desktop/releases/latest/download; fi
  case $base in
    https://github.com/onurkat/scrub-desktop/releases/*) proto='=https';;
    http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*) [ -n "${SCRUB_BASE_URL:-}" ] || fail 'Local URL requires explicit override'; proto='=http,https';;
    *) fail 'Only GitHub release assets or an explicit loopback test server are supported';;
  esac
  # Stable asset names also make explicit latest installs possible.
  cli_asset=scrub-cli-$platform-$arch.tar.gz
  if [ "$os" = Darwin ]; then app_asset=Scrub_universal.app.tar.gz
  elif [ "$system" = 1 ]; then app_asset=Scrub_$apparch.deb
  else app_asset=Scrub_$apparch.AppImage; fi
  printf 'Download and verify SHA256SUMS: %s/%s\n' "$base" "$cli_asset"
  printf 'Install CLI: %s/scrub\n' "$bin"
  if [ "$cli_only" = 0 ]; then
    printf 'Download and verify: %s/%s\n' "$base" "$app_asset"
    if [ "$os" = Darwin ]; then printf 'Install app: %s\n' "$macapp"
    elif [ "$system" = 1 ]; then printf '%s\n' 'Install Debian package: sudo apt install ./Scrub_*.deb'
    else printf 'Install AppImage: %s; launcher, desktop entry and icon under ~/.local\n' "$app"; fi
  fi
  printf 'Record owned files: %s\n' "$manifest"
  [ "$hook" = 0 ] || printf '%s\n' 'Run scrub hook install claude-code --user'
  [ "$dry" = 0 ] || exit 0
  command -v curl >/dev/null || fail 'curl is required'
  mkdir -p "$share"
  stage=$(mktemp -d "$share/install.XXXXXXXX")
  trap 'rm -rf -- "$stage"' EXIT HUP INT TERM
  fetch() { curl --proto "$proto" --proto-redir "$proto" --tlsv1.2 -fsSL "$base/$1" -o "$stage/$1"; }
  fetch SHA256SUMS
  verify() {
    fetch "$1"
    expected=$(awk -v name="$1" '$2 == name || $2 == "*" name { print $1 }' "$stage/SHA256SUMS")
    [ "${#expected}" = 64 ] || fail "Missing or duplicate checksum: $1"
    case $expected in *[!0-9a-fA-F]*) fail 'Invalid checksum';; esac
    if command -v sha256sum >/dev/null; then actual=$(sha256sum "$stage/$1"); else actual=$(shasum -a 256 "$stage/$1"); fi
    [ "$expected" = "${actual%% *}" ] || fail "Checksum mismatch: $1 (nothing installed)"
  }
  verify "$cli_asset"
  if [ "$cli_only" = 0 ]; then verify "$app_asset"; fi
  # Refuse replacing an unmanaged file. Validate every destination before mutation.
  own() {
    if [ -e "$1" ] || [ -L "$1" ]; then
      if [ ! -f "$manifest" ] || ! grep -Fxq "$1" "$manifest"; then fail "Unmanaged destination exists: $1"; fi
    fi
    printf '%s\n' "$1" >> "$stage/new-manifest"
  }
  : > "$stage/new-manifest"
  [ ! -f "$manifest" ] || cp "$manifest" "$stage/new-manifest"
  own "$bin/scrub"
  tar -tzf "$stage/$cli_asset" > "$stage/entries"
  [ "$(cat "$stage/entries")" = scrub ] || fail 'Invalid CLI archive layout'
  tar -xzf "$stage/$cli_asset" -C "$stage"
  if [ ! -f "$stage/scrub" ] || [ -L "$stage/scrub" ]; then fail 'Invalid CLI binary'; fi
  chmod 755 "$stage/scrub"
  installed_version=$("$stage/scrub" --version)
  [ "$version" = latest ] || [ "$version" = "$installed_version" ] || fail 'CLI version does not match requested release'
  if [ "$cli_only" = 0 ]; then
    own "$bin/scrub-desktop"
    if [ "$os" = Darwin ]; then
      own "$macapp"
      tar -tzf "$stage/$app_asset" | awk '/(^\/|(^|\/)\.\.($|\/))/ {exit 1} !/^Scrub.app(\/|$)/ {exit 1}' || fail 'Invalid application archive'
      tar -xzf "$stage/$app_asset" -C "$stage"
      [ -x "$stage/Scrub.app/Contents/MacOS/scrub-desktop" ] || fail 'Missing app executable'
    elif [ "$system" = 0 ]; then
      own "$app"
      own "$HOME/.local/share/applications/scrub.desktop"
      own "$HOME/.local/share/icons/hicolor/128x128/apps/scrub.png"
      # Icon is also a checksum-covered asset.
      verify scrub.png
    else own deb:scrub; fi
  fi
  sort -u "$stage/new-manifest" > "$manifest"
  mkdir -p "$bin"
  cp "$stage/scrub" "$bin/.scrub-install"
  chmod 755 "$bin/.scrub-install"
  mv -f "$bin/.scrub-install" "$bin/scrub"
  if [ "$cli_only" = 0 ]; then
    if [ "$os" = Darwin ]; then
      mkdir -p "$(dirname "$macapp")"
      if [ -w "$(dirname "$macapp")" ]; then
        rm -rf -- "$macapp"
        cp -R "$stage/Scrub.app" "$macapp"
      else
        [ "$system" = 1 ] || fail "Cannot write $macapp"
        sudo rm -rf -- "$macapp"
        sudo cp -R "$stage/Scrub.app" "$macapp"
      fi
      target=$macapp/Contents/MacOS/scrub-desktop
    elif [ "$system" = 1 ]; then
      sudo apt install -y "$stage/$app_asset"
      target=/usr/bin/scrub-desktop
    else
      mkdir -p "$(dirname "$app")" "$HOME/.local/share/applications" "$HOME/.local/share/icons/hicolor/128x128/apps"
      cp "$stage/$app_asset" "$app"; chmod 755 "$app"
      cp "$stage/scrub.png" "$HOME/.local/share/icons/hicolor/128x128/apps/scrub.png"
      target=$app
      printf '[Desktop Entry]\nType=Application\nName=Scrub\nExec="%s/scrub-desktop"\nIcon=scrub\nCategories=Utility;\nTerminal=false\n' "$bin" > "$HOME/.local/share/applications/scrub.desktop"
    fi
    # Symlinks preserve arbitrary spaces and shell metacharacters in HOME.
    ln -sfn "$target" "$bin/scrub-desktop"
  fi
  sort -u "$stage/new-manifest" > "$manifest"
  if [ "$hook" = 1 ]; then
    hook_result=$("$bin/scrub" hook install claude-code --user)
    printf '%s\n' "$hook_result"
    case $hook_result in *'already installed'*) ;; *) printf '%s\n' hook:claude-code >> "$manifest";; esac
  fi
  printf 'Scrub %s is installed\n' "$installed_version"
  # shellcheck disable=SC2016
  case :$PATH: in *:"$bin":*) ;; *) printf '%s\n' 'Add to your shell configuration: export PATH="$HOME/.local/bin:$PATH"';; esac
  [ "$cli_only" = 1 ] || printf '%s\n' 'Start scrub-desktop; find Scrub in the system tray/menu bar. Ctrl+Alt+S scrubs; Ctrl+Alt+R restores.'
  if command -v brew >/dev/null; then printf '%s\n' 'Alternative: brew install onurkat/scrub/scrub-desktop'; fi
)
main "$@"
