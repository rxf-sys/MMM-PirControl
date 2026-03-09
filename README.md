# MMM-PirControl

A [MagicMirror²](https://magicmirror.builders) module that controls your display and system power using a PIR motion sensor. The display turns on when motion is detected and the system enters **suspend mode** after a configurable timeout — saving maximum power.

**Key features:**
- **System suspend** — puts the Pi into real sleep mode (< 1W), wakes via PIR sensor
- Auto-detects `gpiomon` syntax (Debian Bookworm **and** Trixie compatible)
- Auto-detects display server (Wayland / X11 / vcgencmd)
- Zero npm dependencies — uses only `gpiomon` from the system package `gpiod`
- Configurable GPIO pin, timeout, and HDMI port
- Automatic fallback to display-off mode if suspend is not available
- Sends `USER_PRESENCE` notification for other modules to react to

## Prerequisites

Make sure `gpiod` is installed on your Raspberry Pi:

```bash
sudo apt install gpiod
```

If you are running **Wayland** (default on Trixie), you also need:

```bash
sudo apt install wlr-randr
```

## Hardware Setup

Connect your PIR sensor (e.g. HC-SR501) to the Raspberry Pi:

| PIR Sensor | Raspberry Pi         |
|------------|----------------------|
| VCC        | Pin 2 (5V)           |
| GND        | Pin 6 (GND)          |
| OUT        | Pin 11 (GPIO 17)\*   |

\* GPIO pin is configurable — see [Configuration](#configuration).

### Verify your sensor

Before installing the module, test that your PIR sensor works:

**Debian Trixie:**
```bash
gpiomon -e rising -c 0 17
```

**Debian Bookworm:**
```bash
gpiomon -r -b gpiochip0 17
```

Wave your hand in front of the sensor — you should see events printed in the terminal.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/rxf-sys/MMM-PirControl.git
cd MMM-PirControl
sudo bash setup.sh
```

The setup script will:
- Install required packages (`gpiod`, `wlr-randr`)
- Configure sudo permissions for suspend/resume
- Add your user to the `gpio` group
- Check if your Pi supports suspend
- Create the helper scripts for suspend/resume

**Reboot after setup** for group changes to take effect.

No `npm install` needed — this module has zero dependencies.

## Configuration

Add the following to your `config/config.js`:

```javascript
{
    module: "MMM-PirControl",
    config: {
        gpioPin: 17,
        timeout: 60000,
        powerSaveMode: "suspend",
    }
},
```

### Options

| Option          | Description                                                    | Default       |
|-----------------|----------------------------------------------------------------|---------------|
| `gpioPin`       | BCM GPIO pin number connected to the PIR sensor                | `17`          |
| `timeout`       | Time in ms before power save activates (no motion)             | `60000` (60s) |
| `powerSaveMode` | `"suspend"` (full system sleep) or `"display"` (HDMI off only) | `"suspend"`   |
| `startScreenOff`| Turn display off when MagicMirror starts                       | `false`       |
| `displayMode`   | Display control: `"auto"`, `"wayland"`, `"x11"`, `"vcgencmd"` | `"auto"`      |
| `hdmiPort`      | HDMI output name (for Wayland/X11)                             | `"HDMI-A-1"`  |
| `debug`         | Enable debug logging                                           | `false`       |

### Power Save Modes

#### `"suspend"` (default, recommended)
Puts the entire Raspberry Pi into real suspend/sleep mode. This reduces power consumption from ~3-4W to under 1W. When the PIR sensor detects motion, the system wakes up automatically. After resume:
- Display turns on immediately
- WiFi reconnects automatically (may take a few seconds)
- MagicMirror modules refresh their data

The suspend script also:
- Turns off USB ports (saves ~0.5W)
- Turns off activity/power LEDs
- Everything restores automatically on wake

#### `"display"` (fallback)
Only turns off the HDMI signal. The Pi stays fully powered but the monitor enters standby. Use this if suspend doesn't work reliably on your setup.

### Display Mode Auto-Detection

When `displayMode` is set to `"auto"` (default), the module detects your display server automatically:

1. **Wayland** → uses `wlr-randr` (requires `wlr-randr` package)
2. **X11** → uses `xrandr`
3. **vcgencmd** → fallback, uses `vcgencmd display_power`

### Example Configurations

**Full suspend with default settings:**
```javascript
{
    module: "MMM-PirControl",
},
```

**Display-off only (no suspend):**
```javascript
{
    module: "MMM-PirControl",
    config: {
        powerSaveMode: "display",
        timeout: 120000,
    }
},
```

**Custom pin, longer timeout, force X11:**
```javascript
{
    module: "MMM-PirControl",
    config: {
        gpioPin: 4,
        timeout: 180000,
        displayMode: "x11",
        hdmiPort: "HDMI-2",
    }
},
```

## Notifications

### Sent Notifications

| Notification     | Payload   | Description                    |
|------------------|-----------|--------------------------------|
| `USER_PRESENCE`  | `true`    | Motion detected, screen is on  |
| `USER_PRESENCE`  | `false`   | Timeout reached, screen is off |

### Received Notifications

| Notification                 | Description                  |
|------------------------------|------------------------------|
| `MMM_PIRCONTROL_SCREEN_ON`   | Manually turn the screen on  |
| `MMM_PIRCONTROL_SCREEN_OFF`  | Manually turn the screen off |

## Troubleshooting

### Setup script fails
```bash
# Make sure you run it with sudo
sudo bash setup.sh
```

### gpiomon not found
```bash
sudo apt install gpiod
```

### Suspend doesn't work
1. Check if your kernel supports it:
   ```bash
   cat /sys/power/state
   # Should contain "mem"
   ```

2. Test suspend manually:
   ```bash
   sudo systemctl suspend
   # Press a key or move mouse to wake
   ```

3. If the Pi doesn't wake from PIR, add to `/boot/firmware/config.txt`:
   ```
   dtoverlay=gpio-shutdown,gpio_pin=17,active_low=0
   ```

### Screen doesn't turn on/off

1. Check which display server you're using:
   ```bash
   echo $WAYLAND_DISPLAY   # If set → Wayland
   echo $DISPLAY            # If set → X11
   ```

2. Test commands manually:
   ```bash
   # Wayland
   wlr-randr --output HDMI-A-1 --off
   wlr-randr --output HDMI-A-1 --on

   # X11
   xrandr --output HDMI-1 --off
   xrandr --output HDMI-1 --auto

   # vcgencmd
   vcgencmd display_power 0
   vcgencmd display_power 1
   ```

3. Enable debug mode: `debug: true`

### Screen turns on by itself (Trixie)

Add to `/boot/firmware/cmdline.txt`:
```
vc4.force_hotplug=1
```

### WiFi slow after resume

This is normal — WiFi needs 2-5 seconds to reconnect after suspend. The module waits up to 15 seconds for network connectivity before signaling ready.

### HDMI port name

Find your actual port name:
```bash
# Wayland
wlr-randr

# X11
xrandr
```

## How It Works

```
PIR detects motion
        │
        ▼
   gpiomon fires event
        │
        ▼
   node_helper receives event
        │
        ▼
   Is system suspended? ──yes──► Wake from suspend
        │                              │
        no                             ▼
        │                        Restart gpiomon
        ▼                        Turn on display
   Reset timeout timer           Wait for WiFi
        │                              │
        ▼                              ▼
   Timeout expires               Notify frontend
        │
        ▼
   powerSaveMode?
     /         \
  suspend    display
     │          │
     ▼          ▼
  Kill gpiomon  HDMI off
  USB off       (Pi stays on)
  LEDs off
  systemctl suspend
  (Pi sleeps at <1W)
```

## Compatibility

| OS               | Suspend | Display-off |
|------------------|---------|-------------|
| Debian Trixie    | ✅       | ✅           |
| Debian Bookworm  | ✅       | ✅           |
| Debian Bullseye  | ⚠️       | ✅           |
| Raspberry Pi 5   | ✅       | ✅           |
| Raspberry Pi 4   | ✅       | ✅           |
| Raspberry Pi 3   | ❌       | ✅           |

## File Structure

```
MMM-PirControl/
├── MMM-PirControl.js     # Frontend module
├── MMM-PirControl.css    # Styles (hidden module)
├── node_helper.js        # Backend (GPIO, display, suspend)
├── package.json
├── setup.sh              # Setup script (run once)
├── scripts/
│   └── suspend.sh        # Suspend/resume helper (created by setup.sh)
├── LICENSE
└── README.md
```

## License

MIT — see [LICENSE](LICENSE) for details.
