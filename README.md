# MMM-PirControl

A [MagicMirror²](https://magicmirror.builders) module that controls your display and system power using a PIR motion sensor. The display turns on when motion is detected and the system enters **power save mode** after a configurable timeout.

**Key features:**
- **Aggressive power saving** — HDMI off, CPU downclocked, USB disabled, LEDs off (~1.5-2W saved)
- Auto-detects `gpiomon` syntax (Debian Bookworm **and** Trixie compatible)
- Auto-detects display server (Wayland / X11 / vcgencmd)
- Zero npm dependencies — uses only `gpiomon` from the system package `gpiod`
- Configurable GPIO pin, timeout, and HDMI port
- Instant wake-up when PIR detects motion
- Sends `USER_PRESENCE` notification for other modules to react to

## Power Savings

| Measure                | Savings    |
|------------------------|------------|
| HDMI display off       | ~0.5W      |
| CPU 1.5GHz → 600MHz   | ~0.5-1W    |
| USB ports disabled     | ~0.5W      |
| LEDs off               | ~0.1W      |
| **Total**              | **~1.5-2W** (from ~4W to ~2W) |

## Prerequisites

```bash
sudo apt install gpiod wlr-randr
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

**Debian Trixie:**
```bash
gpiomon -e rising -c 0 17
```

**Debian Bookworm:**
```bash
gpiomon -r -b gpiochip0 17
```

Wave your hand in front of the sensor — you should see events in the terminal.

## Installation

```bash
cd ~/MagicMirror/modules
git clone https://github.com/rxf-sys/MMM-PirControl.git
cd MMM-PirControl
sudo bash setup.sh
sudo reboot
```

The setup script installs dependencies, configures sudo permissions for power management, and adds your user to the `gpio` group.

No `npm install` needed — zero dependencies.

## Configuration

Add to your `config/config.js`:

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

| Option          | Description                                                        | Default        |
|-----------------|--------------------------------------------------------------------|----------------|
| `gpioPin`       | BCM GPIO pin number connected to the PIR sensor                    | `17`           |
| `timeout`       | Time in ms before power save activates (no motion)                 | `60000` (60s)  |
| `powerSaveMode` | `"aggressive"` (HDMI+CPU+USB+LEDs) or `"display"` (HDMI off only) | `"aggressive"` |
| `startScreenOff`| Turn display off when MagicMirror starts                           | `false`        |
| `displayMode`   | Display control: `"auto"`, `"wayland"`, `"x11"`, `"vcgencmd"`     | `"auto"`       |
| `hdmiPort`      | HDMI output name (for Wayland/X11)                                 | `"HDMI-A-1"`   |
| `debug`         | Enable debug logging                                               | `false`        |

### Power Save Modes

#### `"aggressive"` (default, recommended)
Turns off HDMI, downclocks the CPU to 600MHz, disables USB ports, and turns off LEDs. The Pi stays running but at minimal power. Wake-up is instant — no reconnection delays.

#### `"display"` (lightweight)
Only turns off the HDMI signal. Use this if you need USB devices to stay active or don't want CPU frequency changes.

### Example Configurations

**Default (aggressive power save, GPIO 17, 60s timeout):**
```javascript
{
    module: "MMM-PirControl",
},
```

**Longer timeout, display-only mode:**
```javascript
{
    module: "MMM-PirControl",
    config: {
        powerSaveMode: "display",
        timeout: 120000,
    }
},
```

**Custom pin, force X11, debug on:**
```javascript
{
    module: "MMM-PirControl",
    config: {
        gpioPin: 4,
        timeout: 90000,
        displayMode: "x11",
        hdmiPort: "HDMI-2",
        debug: true,
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

### Permission denied on power save
```bash
cd ~/MagicMirror/modules/MMM-PirControl
sudo bash setup.sh
sudo reboot
```

### Screen doesn't turn on/off

1. Check your display server:
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

### HDMI port name

Find your port name:
```bash
wlr-randr   # Wayland
xrandr      # X11
```

## How It Works

```
PIR detects motion
        │
        ▼
   gpiomon fires event
        │
        ▼
   node_helper notifies frontend
        │
        ▼
   Is screen off? ──yes──► Wake up:
        │                    CPU → ondemand
        no                   USB → on
        │                    LEDs → restore
        ▼                    HDMI → on
   Reset timeout timer       │
        │                    ▼
        ▼               Notify frontend
   Timeout expires       USER_PRESENCE=true
        │
        ▼
   Power save:
     HDMI → off
     CPU → powersave (600MHz)
     USB → off
     LEDs → off
     USER_PRESENCE=false
```

## Compatibility

| OS               | Status |
|------------------|--------|
| Debian Trixie    | ✅      |
| Debian Bookworm  | ✅      |
| Debian Bullseye  | ✅ (vcgencmd) |
| Raspberry Pi 5   | ✅      |
| Raspberry Pi 4   | ✅      |
| Raspberry Pi 3   | ✅      |

## File Structure

```
MMM-PirControl/
├── MMM-PirControl.js     # Frontend module
├── MMM-PirControl.css    # Styles (hidden module)
├── node_helper.js        # Backend (GPIO, display, power)
├── package.json
├── setup.sh              # Setup script (run once with sudo)
├── scripts/
│   └── powersave.sh      # Power save helper (CPU, USB, LEDs)
├── LICENSE
└── README.md
```

## License

MIT — see [LICENSE](LICENSE) for details.
