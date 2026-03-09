/* MMM-PirControl
 * A MagicMirror² module to control display power via a PIR motion sensor.
 * Compatible with Debian Bookworm and Trixie (auto-detects gpiomon syntax).
 * Supports Wayland (wlr-randr), X11 (xrandr), and vcgencmd fallback.
 *
 * https://github.com/rxf-sys/MMM-PirControl
 * MIT Licensed.
 */

Module.register("MMM-PirControl", {
  defaults: {
    gpioPin: 17,
    timeout: 60 * 1000,
    startScreenOff: false,
    displayMode: "auto", // "auto", "wayland", "x11", "vcgencmd"
    hdmiPort: "HDMI-A-1",
    debug: false,
  },

  getStyles() {
    return ["MMM-PirControl.css"];
  },

  start() {
    Log.info(`[${this.name}] Starting module...`);
    this.screenOn = true;
    this.timer = null;
    this.lastMotion = null;
    this.sendSocketNotification("INIT", this.config);
  },

  socketNotificationReceived(notification, payload) {
    switch (notification) {
      case "MOTION_DETECTED":
        this._onMotionDetected();
        break;
      case "SCREEN_STATE":
        this.screenOn = payload.state;
        this.updateDom();
        break;
      case "STARTED":
        Log.info(`[${this.name}] Backend started. Display mode: ${payload.displayMode}, gpiomon syntax: ${payload.gpiomonVersion}`);
        if (this.config.startScreenOff) {
          this.sendSocketNotification("SCREEN_OFF");
        } else {
          this._resetTimer();
        }
        break;
      case "ERROR":
        Log.error(`[${this.name}] ${payload.message}`);
        break;
      case "DEBUG":
        if (this.config.debug) {
          Log.info(`[${this.name}] [DEBUG] ${payload.message}`);
        }
        break;
    }
  },

  getDom() {
    const wrapper = document.createElement("div");
    wrapper.className = "mmm-pircontrol";

    if (!this.screenOn) {
      wrapper.classList.add("screen-off");
    }

    return wrapper;
  },

  notificationReceived(notification, payload, sender) {
    if (notification === "MMM_PIRCONTROL_SCREEN_ON") {
      this._onMotionDetected();
    } else if (notification === "MMM_PIRCONTROL_SCREEN_OFF") {
      this._screenOff();
    }
  },

  _onMotionDetected() {
    this.lastMotion = new Date();

    if (!this.screenOn) {
      this.sendSocketNotification("SCREEN_ON");
      this.screenOn = true;
      this.updateDom();
      this.sendNotification("USER_PRESENCE", true);
    }

    this._resetTimer();
  },

  _resetTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this._screenOff();
    }, this.config.timeout);
  },

  _screenOff() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.screenOn) {
      this.sendSocketNotification("SCREEN_OFF");
      this.screenOn = false;
      this.updateDom();
      this.sendNotification("USER_PRESENCE", false);
    }
  },
});
