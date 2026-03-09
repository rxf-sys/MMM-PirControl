/* MMM-PirControl - Node Helper
 * Handles PIR sensor GPIO monitoring and HDMI display control.
 * Auto-detects gpiomon version (Bookworm vs Trixie) and display server.
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const { exec, spawn } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

module.exports = NodeHelper.create({
  name: "MMM-PirControl",

  start() {
    this.config = null;
    this.gpiomonProcess = null;
    this.gpiomonVersion = null; // "trixie" or "bookworm"
    this.displayMode = null;
    this.screenOn = true;
  },

  stop() {
    this._killGpiomon();
  },

  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case "INIT":
        this.config = payload;
        this._initialize();
        break;
      case "SCREEN_ON":
        this._screenOn();
        break;
      case "SCREEN_OFF":
        this._screenOff();
        break;
    }
  },

  async _initialize() {
    try {
      // Detect gpiomon version
      this.gpiomonVersion = await this._detectGpiomonVersion();
      this._debug(`Detected gpiomon syntax: ${this.gpiomonVersion}`);

      // Detect display mode
      this.displayMode = await this._detectDisplayMode();
      this._debug(`Detected display mode: ${this.displayMode}`);

      // Install wlr-randr hint
      if (this.displayMode === "wayland") {
        try {
          await execAsync("which wlr-randr");
        } catch {
          this._error("wlr-randr not found. Install it: sudo apt install wlr-randr");
          return;
        }
      }

      // Start GPIO monitoring
      this._startGpiomon();

      this.sendSocketNotification("STARTED", {
        displayMode: this.displayMode,
        gpiomonVersion: this.gpiomonVersion,
      });
    } catch (err) {
      this._error(`Initialization failed: ${err.message}`);
    }
  },

  async _detectGpiomonVersion() {
    try {
      const { stdout } = await execAsync("gpiomon --version 2>&1 || true");
      // gpiomon v2.x (Trixie) uses -e/-c syntax
      // gpiomon v1.x (Bookworm) uses -r/-b syntax
      if (stdout.includes("v2") || stdout.includes("gpiomon (libgpiod) 2")) {
        return "trixie";
      }

      // Try to detect by testing the help output
      const { stdout: helpOut } = await execAsync("gpiomon --help 2>&1 || true");
      if (helpOut.includes("-e ") || helpOut.includes("--edge")) {
        return "trixie";
      }

      return "bookworm";
    } catch {
      // Fallback: try trixie syntax first since that's what Robin uses
      return "trixie";
    }
  },

  async _detectDisplayMode() {
    // If user specified a mode, use it
    if (this.config.displayMode && this.config.displayMode !== "auto") {
      return this.config.displayMode;
    }

    // Auto-detect
    try {
      // Check for Wayland
      const waylandDisplay = process.env.WAYLAND_DISPLAY;
      if (waylandDisplay) {
        return "wayland";
      }

      // Check if wlr-randr is available and works
      try {
        await execAsync("wlr-randr 2>/dev/null");
        return "wayland";
      } catch {
        // Not Wayland or wlr-randr not available
      }

      // Check for X11
      if (process.env.DISPLAY) {
        try {
          await execAsync("xrandr --version 2>/dev/null");
          return "x11";
        } catch {
          // xrandr not available
        }
      }

      // Fallback to vcgencmd
      try {
        await execAsync("vcgencmd display_power 2>/dev/null");
        return "vcgencmd";
      } catch {
        // vcgencmd not available
      }

      this._error("Could not detect display mode. Defaulting to vcgencmd.");
      return "vcgencmd";
    } catch {
      return "vcgencmd";
    }
  },

  _getGpiomonCommand() {
    const pin = this.config.gpioPin;

    if (this.gpiomonVersion === "trixie") {
      return {
        cmd: "gpiomon",
        args: ["-e", "rising", "-c", "0", String(pin)],
      };
    }

    // Bookworm syntax
    return {
      cmd: "gpiomon",
      args: ["-r", "-b", "gpiochip0", String(pin)],
    };
  },

  _startGpiomon() {
    this._killGpiomon();

    const { cmd, args } = this._getGpiomonCommand();
    this._debug(`Starting: ${cmd} ${args.join(" ")}`);

    this.gpiomonProcess = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    this.gpiomonProcess.stdout.on("data", (data) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        if (line.length > 0) {
          this._debug(`PIR event: ${line}`);
          this.sendSocketNotification("MOTION_DETECTED");
        }
      }
    });

    this.gpiomonProcess.stderr.on("data", (data) => {
      const msg = data.toString().trim();
      if (msg.length > 0) {
        this._error(`gpiomon stderr: ${msg}`);
      }
    });

    this.gpiomonProcess.on("error", (err) => {
      this._error(`gpiomon failed to start: ${err.message}. Is gpiod installed? (sudo apt install gpiod)`);
    });

    this.gpiomonProcess.on("close", (code) => {
      if (code !== null && code !== 0) {
        this._error(`gpiomon exited with code ${code}. Check your GPIO pin configuration.`);
      }
    });
  },

  _killGpiomon() {
    if (this.gpiomonProcess) {
      this.gpiomonProcess.kill("SIGTERM");
      this.gpiomonProcess = null;
    }
  },

  async _screenOn() {
    if (this.screenOn) return;

    const cmd = this._getScreenOnCommand();
    this._debug(`Screen ON: ${cmd}`);

    try {
      await execAsync(cmd);
      this.screenOn = true;
      this.sendSocketNotification("SCREEN_STATE", { state: true });
    } catch (err) {
      this._error(`Failed to turn screen on: ${err.message}`);
    }
  },

  async _screenOff() {
    if (!this.screenOn) return;

    const cmd = this._getScreenOffCommand();
    this._debug(`Screen OFF: ${cmd}`);

    try {
      await execAsync(cmd);
      this.screenOn = false;
      this.sendSocketNotification("SCREEN_STATE", { state: false });
    } catch (err) {
      this._error(`Failed to turn screen off: ${err.message}`);
    }
  },

  _getScreenOnCommand() {
    const port = this.config.hdmiPort;

    switch (this.displayMode) {
      case "wayland":
        return `wlr-randr --output ${port} --on`;
      case "x11":
        return `xrandr --output ${port} --auto`;
      case "vcgencmd":
      default:
        return "vcgencmd display_power 1";
    }
  },

  _getScreenOffCommand() {
    const port = this.config.hdmiPort;

    switch (this.displayMode) {
      case "wayland":
        return `wlr-randr --output ${port} --off`;
      case "x11":
        return `xrandr --output ${port} --off`;
      case "vcgencmd":
      default:
        return "vcgencmd display_power 0";
    }
  },

  _debug(message) {
    if (this.config && this.config.debug) {
      console.log(`[${this.name}] [DEBUG] ${message}`);
      this.sendSocketNotification("DEBUG", { message });
    }
  },

  _error(message) {
    console.error(`[${this.name}] [ERROR] ${message}`);
    this.sendSocketNotification("ERROR", { message });
  },
});
