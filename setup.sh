#!/bin/bash
# MMM-PirControl Setup Script
# Configures sudo permissions and GPIO wakeup for suspend mode.
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
echo "[1/5] Checking dependencies..."

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
echo "[2/5] Configuring sudo permissions..."

SUDOERS_FILE="/etc/sudoers.d/mmm-pircontrol"
cat > "$SUDOERS_FILE" << EOF
# MMM-PirControl: allow MagicMirror user to suspend/resume and control power
${ACTUAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl suspend
${ACTUAL_USER} ALL=(ALL) NOPASSWD: /bin/bash /*/MMM-PirControl/scripts/suspend.sh *
${ACTUAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/tee /sys/class/gpio/*
${ACTUAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/tee /sys/devices/platform/soc/*.usb/power/*
${ACTUAL_USER} ALL=(ALL) NOPASSWD: /usr/bin/tee /sys/class/leds/*/brightness
EOF

chmod 440 "$SUDOERS_FILE"

# Validate sudoers
if visudo -cf "$SUDOERS_FILE" > /dev/null 2>&1; then
    echo -e "  ${GREEN}Sudoers configured successfully.${NC}"
else
    echo -e "  ${RED}Sudoers validation failed! Removing file.${NC}"
    rm -f "$SUDOERS_FILE"
    exit 1
fi

# --- 3. Add user to gpio group ---
echo ""
echo "[3/5] Adding ${ACTUAL_USER} to gpio group..."

if getent group gpio > /dev/null 2>&1; then
    usermod -aG gpio "$ACTUAL_USER"
    echo -e "  ${GREEN}User added to gpio group.${NC}"
else
    echo -e "  ${YELLOW}gpio group does not exist. Skipping (gpiomon should still work).${NC}"
fi

# --- 4. Test suspend support ---
echo ""
echo "[4/5] Checking suspend support..."

if [ -f /sys/power/state ]; then
    STATES=$(cat /sys/power/state)
    if echo "$STATES" | grep -q "mem"; then
        echo -e "  ${GREEN}Suspend (mem) is supported: ${STATES}${NC}"
    else
        echo -e "  ${YELLOW}Warning: Suspend may not be fully supported. Available states: ${STATES}${NC}"
        echo -e "  ${YELLOW}The module will fall back to display-off mode if suspend fails.${NC}"
    fi
else
    echo -e "  ${RED}Warning: /sys/power/state not found. Suspend may not work.${NC}"
fi

# --- 5. Create scripts directory ---
echo ""
echo "[5/5] Creating helper scripts..."

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)/scripts"
mkdir -p "$SCRIPT_DIR"

# Create the suspend helper script
cat > "$SCRIPT_DIR/suspend.sh" << 'SCRIPT'
#!/bin/bash
# MMM-PirControl Suspend Helper
# Configures GPIO wakeup source, suspends the system, and cleans up on wake.
#
# Usage: sudo bash suspend.sh <gpio_pin>

GPIO_PIN="${1:-17}"
GPIO_CHIP="/dev/gpiochip0"

# Export GPIO and configure as wakeup source via sysfs
GPIO_SYSFS="/sys/class/gpio/gpio${GPIO_PIN}"

# Export if not already exported
if [ ! -d "$GPIO_SYSFS" ]; then
    echo "$GPIO_PIN" > /sys/class/gpio/export 2>/dev/null || true
    sleep 0.1
fi

# Configure as input with edge detection
if [ -d "$GPIO_SYSFS" ]; then
    echo "in" > "$GPIO_SYSFS/direction" 2>/dev/null || true
    echo "rising" > "$GPIO_SYSFS/edge" 2>/dev/null || true

    # Enable wakeup if supported
    if [ -f "$GPIO_SYSFS/power/wakeup" ]; then
        echo "enabled" > "$GPIO_SYSFS/power/wakeup" 2>/dev/null || true
    fi
fi

# Turn off USB to save power (Pi 4 USB hub)
USB_POWER="/sys/devices/platform/soc/fe980000.usb/power/control"
if [ -f "$USB_POWER" ]; then
    echo "auto" > "$USB_POWER" 2>/dev/null || true
fi

# Turn off LEDs
for led in /sys/class/leds/*/brightness; do
    echo 0 > "$led" 2>/dev/null || true
done

# Suspend the system — this call blocks until the system wakes up
systemctl suspend

# --- System has resumed ---

# Restore LEDs
for trigger_file in /sys/class/leds/*/trigger; do
    led_dir=$(dirname "$trigger_file")
    led_name=$(basename "$led_dir")
    if echo "$led_name" | grep -q "pwr"; then
        echo "default-on" > "$trigger_file" 2>/dev/null || true
    elif echo "$led_name" | grep -q "act"; then
        echo "mmc0" > "$trigger_file" 2>/dev/null || true
    fi
done

# Restore USB
if [ -f "$USB_POWER" ]; then
    echo "on" > "$USB_POWER" 2>/dev/null || true
fi

# Unexport GPIO (gpiomon will reclaim it)
if [ -d "$GPIO_SYSFS" ]; then
    echo "$GPIO_PIN" > /sys/class/gpio/unexport 2>/dev/null || true
fi

# Small delay for hardware to stabilize
sleep 1

echo "RESUMED"
SCRIPT

chmod +x "$SCRIPT_DIR/suspend.sh"
chown "$ACTUAL_USER":"$ACTUAL_USER" "$SCRIPT_DIR/suspend.sh"

echo -e "  ${GREEN}Helper scripts created.${NC}"

# --- Done ---
echo ""
echo "========================================="
echo -e " ${GREEN}Setup complete!${NC}"
echo "========================================="
echo ""
echo " Next steps:"
echo "   1. Reboot your Pi for group changes to take effect"
echo "   2. Add MMM-PirControl to your MagicMirror config.js"
echo "   3. Test suspend manually: sudo systemctl suspend"
echo "      (move mouse or press key to wake, or PIR if wired)"
echo ""
echo " If suspend doesn't wake via PIR, add to /boot/firmware/config.txt:"
echo "   dtoverlay=gpio-shutdown,gpio_pin=${GPIO_PIN:-17},active_low=0"
echo ""
