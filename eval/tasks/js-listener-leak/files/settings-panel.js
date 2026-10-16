/** The settings side panel. Opened and closed many times in a session. */
export class SettingsPanel {
  constructor(bus) {
    this.bus = bus;
    this.renders = 0;
    this.theme = "light";
  }

  open() {
    this.bus.on("settings:changed", this.onSettingsChanged.bind(this));
    this.bus.on("theme:changed", this.onThemeChanged.bind(this));
  }

  close() {
    this.bus.off("settings:changed", this.onSettingsChanged.bind(this));
    this.bus.off("theme:changed", this.onThemeChanged.bind(this));
  }

  onSettingsChanged(settings) {
    this.renders += 1;
    this.lastSettings = settings;
  }

  onThemeChanged(theme) {
    this.theme = theme;
  }
}
