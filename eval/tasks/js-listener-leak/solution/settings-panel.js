/** The settings side panel. Opened and closed many times in a session. */
export class SettingsPanel {
  constructor(bus) {
    this.bus = bus;
    this.renders = 0;
    this.theme = "light";
    // Bound ONCE. `bind` returns a new function every time it is called, so `close()` used to hand
    // the bus a function it had never seen: `off` found nothing to remove, and every open() added
    // one more handler for the life of the window. The bus was right; the identities were not.
    this.onSettingsChanged = this.onSettingsChanged.bind(this);
    this.onThemeChanged = this.onThemeChanged.bind(this);
  }

  open() {
    this.bus.on("settings:changed", this.onSettingsChanged);
    this.bus.on("theme:changed", this.onThemeChanged);
  }

  close() {
    this.bus.off("settings:changed", this.onSettingsChanged);
    this.bus.off("theme:changed", this.onThemeChanged);
  }

  onSettingsChanged(settings) {
    this.renders += 1;
    this.lastSettings = settings;
  }

  onThemeChanged(theme) {
    this.theme = theme;
  }
}
