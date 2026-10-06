// Recording a voice, from outside the panel.
//
// ⚠️⚠️ Because the panel cannot. VS Code decides this in its Electron main process, and the decision
// is not configurable: an origin of `vscode-webview://` is granted {pointerLock, notifications,
// clipboard…} and the workbench is granted {…, media, local-fonts}. An extension's panel is the first
// list, so `getUserMedia` answers `NotAllowedError` with no prompt and no setting — which is exactly
// what was reported, « aucun moyen d'activer ». It is also why the editor's own microphone works:
// that one is not in a panel.
//
// So the recording is made by a program on the machine and handed over as a file. Which program is
// detected rather than assumed, and when there is none the message says what to install instead of
// asking for a permission that cannot be given.

export interface Recorder {
  /** The program to look for on PATH. */
  program: string;
  /** Its arguments, given the file to write. 16 kHz mono WAV, which is what a speech model wants. */
  args: (wav: string) => string[];
  /** What it belongs to, for the sentence that tells somebody what to install. */
  from: string;
}

/**
 * The recorders worth trying, in order.
 *
 * Ordered by how likely they are to be there already rather than by quality: all of them write the
 * same PCM, and a tool the user already has is worth more than a better one they would have to
 * install. Each stops on SIGINT and leaves a complete file, which is what makes "press again to stop"
 * possible at all.
 */
export function recorders(platform: string): Recorder[] {
  if (platform === "darwin") {
    return [
      { program: "rec", args: (w) => ["-q", "-r", "16000", "-c", "1", "-b", "16", w], from: "sox" },
      { program: "ffmpeg", args: (w) => ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", ":0", "-ar", "16000", "-ac", "1", "-y", w], from: "ffmpeg" },
    ];
  }
  if (platform === "win32") {
    // ⚠️ One entry, and it needs the device named — `dshow` has no "default". Windows ships nothing
    // that records to a file from a command line, so this is where `dictation.recordCommand` earns
    // its place: whatever works on that machine, written once.
    return [
      { program: "ffmpeg", args: (w) => ["-hide_banner", "-loglevel", "error", "-f", "dshow", "-i", "audio=default", "-ar", "16000", "-ac", "1", "-y", w], from: "ffmpeg" },
    ];
  }
  return [
    { program: "arecord", args: (w) => ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", w], from: "alsa-utils" },
    { program: "pw-record", args: (w) => ["--rate", "16000", "--channels", "1", w], from: "pipewire" },
    { program: "parecord", args: (w) => ["--rate=16000", "--channels=1", "--file-format=wav", w], from: "pulseaudio-utils" },
    { program: "rec", args: (w) => ["-q", "-r", "16000", "-c", "1", "-b", "16", w], from: "sox" },
    { program: "ffmpeg", args: (w) => ["-hide_banner", "-loglevel", "error", "-f", "alsa", "-i", "default", "-ar", "16000", "-ac", "1", "-y", w], from: "ffmpeg" },
  ];
}

/** The one line to show when none of them is installed. Named packages, not "install something". */
export function howToRecord(platform: string): string {
  if (platform === "darwin") return "brew install sox";
  if (platform === "win32") return "winget install ffmpeg";
  return "apt install alsa-utils   (or: dnf install alsa-utils)";
}

/**
 * A command the user wrote, split for `spawn`.
 *
 * `{file}` is where the recording must be written — the same placeholder the transcription command
 * already uses, so somebody who has configured one knows the shape of the other. Quotes are honoured
 * because a path on Windows has spaces in it, and splitting on whitespace alone is how that breaks.
 */
export function recordArgv(template: string, wav: string): string[] | undefined {
  const text = template.trim();
  if (!text) return undefined;
  const parts = text.match(/"[^"]*"|'[^']*'|\S+/g);
  if (!parts) return undefined;
  const argv = parts.map((p) => p.replace(/^["']|["']$/g, "").split("{file}").join(wav));
  // A template that never says where to write is one that will write somewhere else, and the first
  // sign of it would be a transcription of silence.
  return text.includes("{file}") ? argv : undefined;
}
