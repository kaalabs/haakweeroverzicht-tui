#!/bin/sh
set -eu

REPO="kaalabs/haakweeroverzicht-tui"

DEFAULT_INSTALL_DIR="$HOME/.local/share/haakweeroverzicht-tui"
DEFAULT_BIN_DIR="$HOME/.local/bin"

INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
BIN_DIR="${BIN_DIR:-$DEFAULT_BIN_DIR}"

if [ "${ALLOW_ROOT:-0}" != "1" ] && [ "$(id -u)" -eq 0 ]; then
  echo "Refusing to run as root. Re-run as a normal user (or set ALLOW_ROOT=1)." >&2
  exit 1
fi

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need_cmd curl
need_cmd tar

OS_RAW=$(uname -s 2>/dev/null || echo unknown)
ARCH_RAW=$(uname -m 2>/dev/null || echo unknown)

OS=$(echo "$OS_RAW" | tr '[:upper:]' '[:lower:]')
ARCH=$(echo "$ARCH_RAW" | tr '[:upper:]' '[:lower:]')

case "$OS" in
  darwin)
    case "$ARCH" in
      arm64)
        ASSET="haakweeroverzicht-tui-latest-darwin-arm64.tar.gz"
        ;;
      x86_64|amd64)
        echo "No prebuilt macOS x86_64 artifact is published currently." >&2
        echo "Use an Apple Silicon Mac, or build from source." >&2
        exit 1
        ;;
      *)
        echo "Unsupported macOS architecture: $ARCH_RAW" >&2
        exit 1
        ;;
    esac
    ;;
  linux)
    case "$ARCH" in
      x86_64|amd64)
        ASSET="haakweeroverzicht-tui-latest-linux-x86_64.tar.gz"
        ;;
      aarch64|arm64)
        echo "No prebuilt Linux arm64 artifact is published currently." >&2
        echo "Build from source or add a Linux arm64 runner to the release workflow." >&2
        exit 1
        ;;
      *)
        echo "Unsupported Linux architecture: $ARCH_RAW" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "Unsupported OS: $OS_RAW" >&2
    echo "This installer supports macOS and Linux. On Windows, use WSL/Git Bash or download the .zip from releases." >&2
    exit 1
    ;;
esac

URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t haakweeroverzicht)
cleanup() {
  rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ARCHIVE_PATH="$TMP_DIR/$ASSET"

echo "Downloading: $URL"
curl -fsSL "$URL" -o "$ARCHIVE_PATH"

echo "Installing to: $INSTALL_DIR"
rm -rf "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

tar -xzf "$ARCHIVE_PATH" -C "$INSTALL_DIR"

mkdir -p "$BIN_DIR"
LAUNCHER="$BIN_DIR/haakweeroverzicht-tui"

cat > "$LAUNCHER" <<SH
#!/bin/sh
cd "$INSTALL_DIR" && exec ./haakweeroverzicht-tui "\$@"
SH

chmod +x "$LAUNCHER"

echo "Installed: $LAUNCHER"
if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  echo "NOTE: $BIN_DIR is not on your PATH. Add it to your shell profile to run 'haakweeroverzicht-tui' from anywhere." >&2
fi

echo "Run: haakweeroverzicht-tui"
