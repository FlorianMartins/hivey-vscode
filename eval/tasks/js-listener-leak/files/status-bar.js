/** The status bar shows the last saved settings. It lives as long as the window. */
export function mountStatusBar(bus) {
  const state = { text: "" };
  bus.on("settings:changed", (settings) => {
    state.text = `saved: ${Object.keys(settings).length} settings`;
  });
  return state;
}
