#!/bin/bash
# MMM-PirControl Powersave Helper
# Enables or disables aggressive power saving on the Raspberry Pi.
#
# Usage: sudo bash powersave.sh <on|off>

ACTION="${1:-on}"

case "$ACTION" in
  on)
    # CPU Governor → powersave (600 MHz on Pi 4)
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
      echo "powersave" > "$cpu" 2>/dev/null || true
    done

    # USB ports off (Pi 4 USB hub)
    for usb_power in /sys/devices/platform/soc/*.usb/power/control; do
      echo "auto" > "$usb_power" 2>/dev/null || true
    done

    # LEDs off
    for led in /sys/class/leds/*/brightness; do
      echo 0 > "$led" 2>/dev/null || true
    done

    echo "POWERSAVE_ON"
    ;;

  off)
    # CPU Governor → ondemand (back to normal)
    for cpu in /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor; do
      echo "ondemand" > "$cpu" 2>/dev/null || true
    done

    # USB ports on
    for usb_power in /sys/devices/platform/soc/*.usb/power/control; do
      echo "on" > "$usb_power" 2>/dev/null || true
    done

    # LEDs restore
    for trigger_file in /sys/class/leds/*/trigger; do
      led_dir=$(dirname "$trigger_file")
      led_name=$(basename "$led_dir")
      if echo "$led_name" | grep -q "pwr"; then
        echo "default-on" > "$trigger_file" 2>/dev/null || true
      elif echo "$led_name" | grep -q "act"; then
        echo "mmc0" > "$trigger_file" 2>/dev/null || true
      fi
    done

    echo "POWERSAVE_OFF"
    ;;

  *)
    echo "Usage: powersave.sh <on|off>"
    exit 1
    ;;
esac
