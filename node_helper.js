/* MMM-PirControl - Node Helper
 * Handles PIR sensor GPIO monitoring, HDMI display control, and system suspend.
 * Auto-detects gpiomon version (Bookworm vs Trixie) and display server.
 *
 * MIT Licensed.
 */

const NodeHelper = require("node_helper");
const { exec, spawn } = require("child_process");
const path = require("path");
const util = require("util");
const execAsync = util.promisify(exec);

module.exports = NodeHelper.create({
  name: "MMM-PirControl",

  start() {
    this.config = null;
    this.gpiomonProcess = null;
    this.gpiomonVersion = null;
    this.displayMode = null;
    this.screenOn = true;
    this.isSuspending = false;
    this.suspendSupported = false;
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
        this._enterPowerSave();
        break;
    }
  },

  async _initialize() {
    try {
      this.gpiomonVersion = await this._detectGpiomonVersion();
      this._debug(`Detected gpiomon syntax: ${this.gpiomonVersion}`);

      this.displayMode = await this._detectDisplayMode();
      this._debug(`Detected display mode: ${this.displayMode}`);

      this.suspendSupported = await this._checkSuspendSupport();
      this._debug(`Suspend supported: ${this.suspendSupported}`);

      if (this.config.powerSaveMode === "suspend" && !this.suspendSupported) {
        this._error("Suspend requested but not supported. Falling back to display-off mode.");
        this._error("Run 'sudo bash setup.sh' in the module directory to configure suspend.");
      }

      if (this.displayMode === "wayland") {
        try {
          await execAsync("which wlr-randr");
        } catch {
          this._error("wlr-randr not found. Install it: sudo apt install wlr-randr");
          return;
        }
      }

      this._startGpiomon();

      this.sendSocketNotification("STARTED", {
        displayMode: this.displayMode,
        gpiomonVersion: this.gpiomonVersion,
        suspendSupported: this.suspendSupported,
      });
    } catch (err) {
      this._error(`Initialization failed: ${err.message}`);
    }
  },

  async _checkSuspendSupport() {
    try {
      const { stdout } = await execAsync("cat /sys/power/state 2>/dev/null || echo ''");
      if (!stdout.includes("mem")) return false;

      try {
        await execAsync("sudo -n -l systemctl suspend 2>/dev/null");
        return true;
      } catch {
        this._debug("sudo systemctl suspend not configured. Run setup.sh first.");
        return false;
      }
    } catch {
      return false;
    }
  },

  async _detectGpiomonVersion() {
    try {
      const { stdout } = await execAsync("gpiomon --version 2>&1 || true");
      if (stdout.includes("v2") || stdout.includes("gpiomon (libgpiod) 2")) {
        return "trixie";
      }

      const { stdout: helpOut } = await execAsync("gpiomon --help 2>&1 || true");
      if (helpOut.includes("-e ") || helpOut.includes("--edge")) {
        return "trixie";
      }

      return "bookworm";
    } catch {
      return "trixie";
    }
  },

  async _detectDisplayMode() {
    if (this.config.displayMode && this.config.displayMode !== "auto") {
      return this.config.displayMode;
    }

    try {
      if (process.env.WAYLAND_DISPLAY) return "wayland";

      try {
        await execAsync("wlr-randr 2>/dev/null");
        return "wayland";
      } catch {}

      if (process.env.DISPLAY) {
        try {
          await execAsync("xrandr --version 2>/dev/null");
          return "x11";
        } catch {}
      }

      try {
        await execAsync("vcgencmd display_power 2>/dev/null");
        return "vcgencmd";
      } catch {}

      this._error("Could not detect display mode. Defaulting to vcgencmd.");
      return "vcgencmd";
    } catch {
      return "vcgencmd";
    }
  },

  // ==========================================
  // Power Save: Suspend or Display-Off
  // ==========================================

  async _enterPowerSave() {
    if (this.isSuspending) return;

    const useSuspend =
      this.config.powerSaveMode === "suspend" && this.suspendSupported;

    if (useSuspend) {
      await this._suspend();
    } else {
      await this._screenOff();
    }
  },

  async _suspend() {
    if (this.isSuspending) return;
    this.isSuspending = true;

    this._debug("Entering suspend mode...");

    // 1. Turn off display first
    await this._displayOff();

    // 2. Kill gpiomon (GPIO will be managed by suspend script)
    this._killGpiomon();

    // 3. Notify frontend
    this.screenOn = false;
    this.sendSocketNotification("SCREEN_STATE", { state: false, suspended: true });

    // 4. Execute suspend script — BLOCKS until system resumes
    const scriptPath = path.join(__dirname, "scripts", "suspend.sh");
    const gpioPin = this.config.gpioPin;

    this._debug(`Executing: sudo bash ${scriptPath} ${gpioPin}`);

    try {
      const { stdout } = await execAsync(
        `sudo bash "${scriptPath}" ${gpioPin}`,
        { timeout: 0 }
      );

      // --- System has resumed ---
      this._debug(`Resume output: ${stdout.trim()}`);
      this._debug("System resumed from suspend!");

      // 5. Restart gpiomon
      this._startGpiomon();

      // 6. Turn on display
      await this._displayOn();

      // 7. Wait for WiFi reconnection
      await this._waitForNetwork();

      // 8. Notify frontend
      this.screenOn = true;
      this.isSuspending = false;
      this.sendSocketNotification("SCREEN_STATE", { state: true, resumed: true });
      this.sendSocketNotification("MOTION_DETECTED");
    } catch (err) {
      this._error(`Suspend failed: ${err.message}`);
      this.isSuspending = false;

      // Recovery: restart everything
      this._startGpiomon();
      await this._displayOn();
      this.screenOn = true;
      this.sendSocketNotification("SCREEN_STATE", { state: true });
    }
  },

  async _waitForNetwork() {
    this._debug("Waiting for network reconnection...");
    const maxRetries = 15;

    for (let i = 0; i < maxRetries; i++) {
      try {
        await execAsync("ping -c 1 -W 1 1.1.1.1 2>/dev/null");
        this._debug(`Network reconnected after ${i + 1}s`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    this._debug("Network reconnection timeout — modules may need a moment to refresh.");
  },

  // ==========================================
  // Display Control
  // ==========================================

  async _screenOn() {
    if (this.screenOn) return;
    await this._displayOn();
    this.screenOn = true;
    this.sendSocketNotification("SCREEN_STATE", { state: true });
  },

  async _screenOff() {
    if (!this.screenOn) return;
    await this._displayOff();
    this.screenOn = false;
    this.sendSocketNotification("SCREEN_STATE", { state: false });
  },

  async _displayOn() {
    const cmd = this._getScreenOnCommand();
    this._debug(`Display ON: ${cmd}`);
    try {
      await execAsync(cmd);
    } catch (err) {
      this._error(`Failed to turn display on: ${err.message}`);
    }
  },

  async _displayOff() {
    const cmd = this._getScreenOffCommand();
    this._debug(`Display OFF: ${cmd}`);
    try {
      await execAsync(cmd);
    } catch (err) {
      this._error(`Failed to turn display off: ${err.message}`);
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

  // ==========================================
  // GPIO Monitoring
  // ==========================================

  _getGpiomonCommand() {
    const pin = this.config.gpioPin;
    if (this.gpiomonVersion === "trixie") {
      return { cmd: "gpiomon", args: ["-e", "rising", "-c", "0", String(pin)] };
    }
    return { cmd: "gpiomon", args: ["-r", "-b", "gpiochip0", String(pin)] };
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
      if (msg.length > 0) this._error(`gpiomon stderr: ${msg}`);
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

  // ==========================================
  // Logging
  // ==========================================

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
