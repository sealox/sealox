#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
generated_flutter_config="$repo_root/apps/desktop/macos/Flutter/ephemeral/Flutter-Generated.xcconfig"

fail() {
  printf 'debug.sh: %s\n' "$*" >&2
  exit 1
}

resolve_executable() {
  local value="${1:-}"
  [[ -n "$value" ]] || return 1
  if [[ "$value" == */* ]]; then
    [[ -x "$value" ]] || return 1
    printf '%s\n' "$value"
    return 0
  fi
  command -v -- "$value" 2>/dev/null
}

resolve_flutter() {
  local resolved=""
  local flutter_root=""
  local candidate=""

  if resolved="$(resolve_executable "${FLUTTER_BIN:-}")"; then
    printf '%s\n' "$resolved"
    return 0
  fi

  if resolved="$(command -v flutter 2>/dev/null)"; then
    printf '%s\n' "$resolved"
    return 0
  fi

  if [[ -r "$generated_flutter_config" ]]; then
    while IFS= read -r line; do
      case "$line" in
        FLUTTER_ROOT=*)
          flutter_root="${line#FLUTTER_ROOT=}"
          flutter_root="${flutter_root%$'\r'}"
          break
          ;;
      esac
    done < "$generated_flutter_config"
    candidate="$flutter_root/bin/flutter"
    if [[ -n "$flutter_root" && -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  fi

  for candidate in \
    "$HOME/development/flutter/bin/flutter" \
    "$HOME/flutter/bin/flutter" \
    "$HOME/fvm/default/bin/flutter" \
    /opt/homebrew/bin/flutter \
    /usr/local/bin/flutter; do
    if [[ -x "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

usage() {
  cat <<'EOF'
Usage:
  ./debug.sh          Start the Flutter desktop debug preview.
  ./debug.sh --check  Validate the local debug toolchain only.
  ./debug.sh --help   Show this help.

While the preview is running:
  r  Hot reload
  R  Hot restart
  q  Quit
EOF
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
  ''|--check)
    ;;
  *)
    usage >&2
    fail "unknown option: $1"
    ;;
esac

[[ -f "$repo_root/package.json" ]] || fail "package.json is missing from $repo_root"
[[ -f "$repo_root/apps/desktop/pubspec.yaml" ]] || fail "Flutter desktop project is missing"

npm_bin="$(command -v npm 2>/dev/null || true)"
[[ -n "$npm_bin" ]] || fail "npm was not found; install Node.js 24 first"

node_bin="$(command -v node 2>/dev/null || true)"
[[ -n "$node_bin" ]] || fail "node was not found; install Node.js 24 first"

flutter_bin="$(resolve_flutter || true)"
[[ -n "$flutter_bin" ]] || fail \
  "flutter was not found; add it to PATH or run FLUTTER_BIN=/path/to/flutter ./debug.sh"

printf 'Helios desktop debug preview\n'
printf '  project: %s\n' "$repo_root"
printf '  node:    %s (%s)\n' "$node_bin" "$("$node_bin" --version)"
printf '  flutter: %s\n' "$flutter_bin"

if [[ "${1:-}" == "--check" ]]; then
  "$flutter_bin" --version | sed -n '1p'
  printf 'Debug toolchain is ready.\n'
  exit 0
fi

printf '\nStarting preview. Use r to hot reload, R to hot restart, or q to quit.\n\n'
cd "$repo_root"
exec env FLUTTER_BIN="$flutter_bin" "$npm_bin" run dev
