#!/bin/sh
set -eu

REPO="kaalabs/haakweeroverzicht-tui"

DEFAULT_INSTALL_DIR="$HOME/.local/share/haakweeroverzicht-tui"
DEFAULT_BIN_DIR="$HOME/.local/bin"

INSTALL_DIR="${INSTALL_DIR:-$DEFAULT_INSTALL_DIR}"
BIN_DIR="${BIN_DIR:-$DEFAULT_BIN_DIR}"

if [ -z "$INSTALL_DIR" ] || [ "$INSTALL_DIR" = "/" ]; then
  echo "Refusing to install into INSTALL_DIR='$INSTALL_DIR'" >&2
  exit 1
fi

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

OS_RAW=$(uname -s 2>/dev/null || echo unknown)
ARCH_RAW=$(uname -m 2>/dev/null || echo unknown)

OS=$(echo "$OS_RAW" | tr '[:upper:]' '[:lower:]')
ARCH=$(echo "$ARCH_RAW" | tr '[:upper:]' '[:lower:]')

case "$OS" in
  darwin)
    OS="darwin"
    ;;
  linux)
    OS="linux"
    ;;
  mingw*|msys*|cygwin*)
    OS="windows"
    ;;
  *)
    echo "Unsupported OS: $OS_RAW" >&2
    echo "This installer supports macOS, Linux, and Windows (via Git Bash/MSYS2/Cygwin/WSL)." >&2
    exit 1
    ;;
esac

normalize_arch() {
  raw="$1"
  os="$2"

  case "$raw" in
    x86_64|amd64)
      if [ "$os" = "windows" ]; then
        echo "amd64"
      else
        echo "x86_64"
      fi
      ;;
    aarch64|arm64)
      echo "arm64"
      ;;
    *)
      echo "$raw"
      ;;
  esac
}

ARCH=$(normalize_arch "$ARCH" "$OS")

# Optional overrides for debugging / cross-install.
if [ -n "${TARGET_OS:-}" ]; then
  OS="$TARGET_OS"
fi
if [ -n "${TARGET_ARCH:-}" ]; then
  ARCH="$TARGET_ARCH"
fi

case "$OS" in
  darwin|linux)
    need_cmd tar
    EXT="tar.gz"
    ;;
  windows)
    EXT="zip"
    ;;
  *)
    echo "Unsupported OS after normalization: $OS" >&2
    exit 1
    ;;
esac

# Try a few candidate asset names for compatibility.
ASSET_CANDIDATES=""
case "$OS" in
  darwin)
    case "$ARCH" in
      arm64)
        ASSET_CANDIDATES="haakweeroverzicht-tui-latest-darwin-arm64.tar.gz"
        ;;
      x86_64)
        ASSET_CANDIDATES="haakweeroverzicht-tui-latest-darwin-x86_64.tar.gz"
        ;;
      *)
        echo "Unsupported macOS architecture: $ARCH_RAW" >&2
        exit 1
        ;;
    esac
    ;;
  linux)
    case "$ARCH" in
      x86_64)
        ASSET_CANDIDATES="haakweeroverzicht-tui-latest-linux-x86_64.tar.gz"
        ;;
      arm64)
        ASSET_CANDIDATES="haakweeroverzicht-tui-latest-linux-arm64.tar.gz haakweeroverzicht-tui-latest-linux-aarch64.tar.gz"
        ;;
      *)
        echo "Unsupported Linux architecture: $ARCH_RAW" >&2
        exit 1
        ;;
    esac
    ;;
  windows)
    case "$ARCH" in
      amd64)
        ASSET_CANDIDATES="haakweeroverzicht-tui-latest-windows-amd64.zip haakweeroverzicht-tui-latest-windows-x86_64.zip"
        ;;
      arm64)
        ASSET_CANDIDATES="haakweeroverzicht-tui-latest-windows-arm64.zip"
        ;;
      *)
        echo "Unsupported Windows architecture: $ARCH_RAW" >&2
        exit 1
        ;;
    esac
    ;;
esac

TMP_DIR=$(mktemp -d 2>/dev/null || mktemp -d -t haakweeroverzicht)
cleanup() {
  rm -rf "$TMP_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

ARCHIVE_PATH="$TMP_DIR/archive.$EXT"

downloaded="0"
for ASSET in $ASSET_CANDIDATES; do
  URL="https://github.com/${REPO}/releases/latest/download/${ASSET}"
  echo "Downloading: $URL"
  if curl -fsSL "$URL" -o "$ARCHIVE_PATH"; then
    downloaded="1"
    break
  fi
  rm -f "$ARCHIVE_PATH" 2>/dev/null || true
  echo "  (not found)" >&2
done

if [ "$downloaded" != "1" ]; then
  echo "No matching release asset found for OS=$OS ARCH=$ARCH." >&2
  echo "Tried:" >&2
  for ASSET in $ASSET_CANDIDATES; do
    echo "  - $ASSET" >&2
  done
  exit 1
fi

echo "Installing to: $INSTALL_DIR"

# Preserve user data across upgrades.
PRESERVE_DATA_DIR="$INSTALL_DIR/data"
PRESERVED_DATA_TMP="$TMP_DIR/data"

mkdir -p "$INSTALL_DIR"

if [ -d "$PRESERVE_DATA_DIR" ]; then
  rm -rf "$PRESERVED_DATA_TMP" 2>/dev/null || true
  mv "$PRESERVE_DATA_DIR" "$PRESERVED_DATA_TMP"
fi

# Remove everything except the preserved data dir.
# (Avoids deleting user data when upgrading.)
find "$INSTALL_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

if [ -d "$PRESERVED_DATA_TMP" ]; then
  mv "$PRESERVED_DATA_TMP" "$PRESERVE_DATA_DIR"
fi

if [ "$EXT" = "tar.gz" ]; then
  tar -xzf "$ARCHIVE_PATH" -C "$INSTALL_DIR"
elif [ "$EXT" = "zip" ]; then
  if command -v unzip >/dev/null 2>&1; then
    unzip -q "$ARCHIVE_PATH" -d "$INSTALL_DIR"
  elif command -v powershell.exe >/dev/null 2>&1; then
    powershell.exe -NoProfile -Command "Expand-Archive -Force '$ARCHIVE_PATH' '$INSTALL_DIR'" >/dev/null
  elif command -v powershell >/dev/null 2>&1; then
    powershell -NoProfile -Command "Expand-Archive -Force '$ARCHIVE_PATH' '$INSTALL_DIR'" >/dev/null
  else
    echo "Missing required command to unpack zip: unzip or powershell" >&2
    exit 1
  fi
else
  echo "Unsupported archive type: $EXT" >&2
  exit 1
fi

BIN_NAME="haakweeroverzicht-tui"
if [ "$OS" = "windows" ]; then
  BIN_NAME="haakweeroverzicht-tui.exe"
fi

if [ ! -f "$INSTALL_DIR/$BIN_NAME" ]; then
  echo "Install failed: '$BIN_NAME' not found in $INSTALL_DIR" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"
LAUNCHER="$BIN_DIR/haakweeroverzicht-tui"

cat > "$LAUNCHER" <<SH
#!/bin/sh
cd "$INSTALL_DIR" && exec ./$BIN_NAME "\$@"
SH

chmod +x "$LAUNCHER"

echo "Installed: $LAUNCHER"
if ! echo ":$PATH:" | grep -q ":$BIN_DIR:"; then
  echo "NOTE: $BIN_DIR is not on your PATH. Add it to your shell profile to run 'haakweeroverzicht-tui' from anywhere." >&2
fi

echo "Run: haakweeroverzicht-tui"
