# MMM-PirControl

A [MagicMirror²](https://magicmirror.builders) module that controls your display using a PIR motion sensor. The display turns on when motion is detected and automatically turns off after a configurable timeout.

**Key features:**
- Auto-detects `gpiomon` syntax (Debian Bookworm **and** Trixie compatible)
- Auto-detects display server (Wayland / X11 / vcgencmd)
- Zero npm dependencies — uses only `gpiomon` from the system package `gpiod`
- Configurable GPIO pin, timeout, and HDMI port
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
```

No `npm install` needed — this module has zero dependencies.

## Configuration

Add the following to your `config/config.js`:

```javascript
{
    module: "MMM-PirControl",
    config: {
        gpioPin: 17,
        timeout: 60000,
    }
},
```

### Options

| Option         | Description                                          | Default       |
|----------------|------------------------------------------------------|---------------|
| `gpioPin`      | BCM GPIO pin number connected to the PIR sensor      | `17`          |
| `timeout`      | Time in ms before display turns off (no motion)      | `60000` (60s) |
| `startScreenOff` | Turn display off when MagicMirror starts           | `false`       |
| `displayMode`  | Display control method: `"auto"`, `"wayland"`, `"x11"`, `"vcgencmd"` | `"auto"` |
| `hdmiPort`     | HDMI output name (for Wayland/X11)                   | `"HDMI-A-1"`  |
| `debug`        | Enable debug logging                                 | `false`       |

### Display Mode Auto-Detection

When `displayMode` is set to `"auto"` (default), the module detects your display server automatically:

1. **Wayland** → uses `wlr-randr` (requires `wlr-randr` package)
2. **X11** → uses `xrandr`
3. **vcgencmd** → fallback, uses `vcgencmd display_power`

If auto-detection doesn't work for your setup, set `displayMode` explicitly.

### Example Configurations

**Minimal (default GPIO 17, 60s timeout):**
```javascript
{
    module: "MMM-PirControl",
},
```

**Custom pin and longer timeout:**
```javascript
{
    module: "MMM-PirControl",
    config: {
        gpioPin: 4,
        timeout: 120000,
    }
},
```

**Force X11 mode with second HDMI port:**
```javascript
{
    module: "MMM-PirControl",
    config: {
        displayMode: "x11",
        hdmiPort: "HDMI-2",
        timeout: 90000,
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

### gpiomon not found
```bash
sudo apt install gpiod
```

### Screen doesn't turn on/off

1. Check which display server you're using:
   ```bash
   echo $WAYLAND_DISPLAY   # If set, you're on Wayland
   echo $DISPLAY            # If set, you're on X11
   ```

2. Test the display commands manually:
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

3. Enable debug mode in your config: `debug: true`

### Screen turns on by itself (Trixie)

Add to `/boot/firmware/cmdline.txt`:
```
vc4.force_hotplug=1
```

### HDMI port name

If `HDMI-A-1` doesn't work, find your port name:
```bash
# Wayland
wlr-randr

# X11
xrandr
```

## Compatibility

| OS               | Status |
|------------------|--------|
| Debian Trixie    | ✅      |
| Debian Bookworm  | ✅      |
| Debian Bullseye  | ✅ (vcgencmd mode) |
| Raspberry Pi 4   | ✅      |
| Raspberry Pi 5   | ✅      |

## License

MIT — see [LICENSE](LICENSE) for details.
