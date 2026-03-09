#!/bin/bash
# MMM-PirControl Setup Script
# Configures sudo permissions for power save mode.
#
# Usage: sudo bash setup.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo "========================================="
echo " MMM-PirControl Setup"
echo "========================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Error: Please run as root: sudo bash setup.sh${NC}"
    exit 1
fi

# Detect the user who called sudo
ACTUAL_USER="${SUDO_USER:-$(whoami)}"
if [ "$ACTUAL_USER" = "root" ]; then
    echo -e "${YELLOW}Warning: Could not detect non-root user. Using 'pi' as default.${NC}"
    ACTUAL_USER="pi"
fi

echo -e "Configuring for user: ${GREEN}${ACTUAL_USER}${NC}"
echo ""

# --- 1. Install dependencies ---
echo "[1/4] Checking dependencies..."

install_if_missing() {
    if ! command -v "$1" &> /dev/null; then
        echo "  Installing $2..."
        apt-get install -y "$2" > /dev/null 2>&1
        echo -e "  ${GREEN}$2 installed.${NC}"
    else
        echo -e "  ${GREEN}$1 already installed.${NC}"
    fi
}

install_if_missing "gpiomon" "gpiod"
install_if_missing "wlr-randr" "wlr-randr"

# --- 2. Configure sudoers ---
echo ""
echo "[2/4] Configuring sudo permissions..."

SUDOERS_FILE="/etc/sudoers.d/mmm-pircontrol"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)/scripts"

cat > "$SUDOERS_FILE" << EOF
# MMM-PirControl: allow MagicMirror user to control power saving
${ACTUAL_USER} ALL=(ALL) NOPASSWD: /bin/bash ${SCRIPT_DIR}/powersave.sh *
EOF

chmod 440 "$SUDOERS_FILE"

if visudo -cf "$SUDOERS_FILE" > /dev/null 2>&1; then
    echo -e "  ${GREEN}Sudoers configured successfully.${NC}"
else
    echo -e "  ${RED}Sudoers validation failed! Removing file.${NC}"
    rm -f "$SUDOERS_FILE"
    exit 1
fi

# --- 3. Add user to gpio group ---
echo ""
echo "[3/4] Adding ${ACTUAL_USER} to gpio group..."

if getent group gpio > /dev/null 2>&1; then
    usermod -aG gpio "$ACTUAL_USER"
    echo -e "  ${GREEN}User added to gpio group.${NC}"
else
    echo -e "  ${YELLOW}gpio group does not exist. Skipping (gpiomon should still work).${NC}"
fi

# --- 4. Make scripts executable ---
echo ""
echo "[4/4] Setting up scripts..."

chmod +x "$SCRIPT_DIR/powersave.sh" 2>/dev/null || true
echo -e "  ${GREEN}Scripts ready.${NC}"

# --- Verify ---
echo ""
echo "========================================="
echo -e " ${GREEN}Setup complete!${NC}"
echo "========================================="
echo ""
echo " Power save features:"
echo "   ✓ HDMI display off          (~0.5W saved)"
echo "   ✓ CPU downclocked to 600MHz (~0.5-1W saved)"
echo "   ✓ USB ports disabled        (~0.5W saved)"
echo "   ✓ LEDs turned off           (~0.1W saved)"
echo "   ─────────────────────────────────────"
echo "   Total savings: ~1.5-2W (from ~4W to ~2W)"
echo ""
echo " Next steps:"
echo "   1. Reboot your Pi for group changes: sudo reboot"
echo "   2. Add MMM-PirControl to your config.js"
echo "   3. Restart MagicMirror"
echo ""
