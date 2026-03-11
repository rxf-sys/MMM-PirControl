#!/bin/bash
# MMM-PirControl Powersave Helper
# Enables or disables aggressive power saving on the Raspberry Pi.
# Saves original LED/CPU states before changing them, restores on "off".
#
# Usage: sudo bash powersave.sh <on|off>

ACTION="${1:-on}"
STATE_DIR="/tmp/mmm-pircontrol"

case "$ACTION" in
  on)
    mkdir -p "$STATE_DIR"

    # CPU Governor → powersave (save original first)
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
      cpu_id=$(basename "$(dirname "$(dirname "$cpu")")")
      cat "$cpu" > "$STATE_DIR/${cpu_id}_governor" 2>/dev/null
      echo "powersave" > "$cpu" 2>/dev/null || true
    done

    # USB ports off (Pi 4 USB hub)
    for usb_power in /sys/devices/platform/soc/*.usb/power/control; do
      usb_id=$(basename "$(dirname "$usb_power")")
      cat "$usb_power" > "$STATE_DIR/${usb_id}_usb" 2>/dev/null
      echo "auto" > "$usb_power" 2>/dev/null || true
    done

    # LEDs off (save original trigger + brightness)
    for led_dir in /sys/class/leds/*/; do
      led_name=$(basename "$led_dir")
      if [ -f "${led_dir}trigger" ]; then
        # Extract active trigger (the one in brackets)
        sed -n 's/.*\[\(.*\)\].*/\1/p' "${led_dir}trigger" > "$STATE_DIR/${led_name}_trigger" 2>/dev/null
      fi
      if [ -f "${led_dir}brightness" ]; then
        cat "${led_dir}brightness" > "$STATE_DIR/${led_name}_brightness" 2>/dev/null
      fi
      echo 0 > "${led_dir}brightness" 2>/dev/null || true
    done

    echo "POWERSAVE_ON"
    ;;

  off)
    # CPU Governor → restore original (fallback to ondemand)
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
      cpu_id=$(basename "$(dirname "$(dirname "$cpu")")")
      saved="$STATE_DIR/${cpu_id}_governor"
      if [ -f "$saved" ]; then
        cat "$saved" > "$cpu" 2>/dev/null || true
      else
        echo "ondemand" > "$cpu" 2>/dev/null || true
      fi
    done

    # USB ports → restore original (fallback to on)
    for usb_power in /sys/devices/platform/soc/*.usb/power/control; do
      usb_id=$(basename "$(dirname "$usb_power")")
      saved="$STATE_DIR/${usb_id}_usb"
      if [ -f "$saved" ]; then
        cat "$saved" > "$usb_power" 2>/dev/null || true
      else
        echo "on" > "$usb_power" 2>/dev/null || true
      fi
    done

    # LEDs → restore original trigger + brightness
    for led_dir in /sys/class/leds/*/; do
      led_name=$(basename "$led_dir")
      saved_trigger="$STATE_DIR/${led_name}_trigger"
      saved_brightness="$STATE_DIR/${led_name}_brightness"

      if [ -f "$saved_trigger" ]; then
        cat "$saved_trigger" > "${led_dir}trigger" 2>/dev/null || true
      fi
      if [ -f "$saved_brightness" ]; then
        cat "$saved_brightness" > "${led_dir}brightness" 2>/dev/null || true
      fi
    done

    # Clean up saved state
    rm -rf "$STATE_DIR"

    echo "POWERSAVE_OFF"
    ;;

  *)
    echo "Usage: powersave.sh <on|off>"
    exit 1
    ;;
esac
