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
  /**
   * How it is told to stop.
   *
   * ⚠️ `signal` for the recorders that finalise their WAV header on SIGINT, which is all of the Unix
   * ones. `stdin` for the Windows one, which cannot use a signal at all: the file is written by an
   * explicit `save` call that has to RUN, and a killed process runs nothing. It waits for a line
   * instead.
   */
  stop: "signal" | "stdin";
  /** True when it is part of the system and need not be looked for on PATH. */
  builtin?: boolean;
}

/**
 * Recording on Windows, with what Windows already has.
 *
 * ⚠️ This exists because Windows ships nothing that records to a file from a command line — reported
 * from a real machine: « je suis sur Windows et j'ai ce message ». Telling somebody to install ffmpeg
 * before they can speak is not "as simple as a cloud service", which was the whole brief.
 *
 * `winmm` is the multimedia layer every Windows has had for thirty years, and `mciSendString` is its
 * command interface. PowerShell can call it through `Add-Type`, so the recorder is a script rather
 * than a program — nothing to install, on any Windows.
 *
 * It stops on a LINE OF INPUT rather than on a signal, and that is the whole reason `stop` exists: the
 * WAV is produced by an explicit `save`, and a process that has been killed does not reach it. The
 * recording would be lost exactly when somebody had finished speaking.
 */
export function windowsRecorderScript(wav: string): string {
  // Single quotes are PowerShell's literal string, and a single quote inside one is doubled. A
  // temporary path has no quote in it today; a path is not the place to find that out.
  const file = wav.split("'").join("''");
  return [
    "$ErrorActionPreference='Stop'",
    'Add-Type -Name M -Namespace Hv -MemberDefinition \'[DllImport("winmm.dll",CharSet=CharSet.Auto)] public static extern int mciSendString(string c, System.Text.StringBuilder r, int l, System.IntPtr h);\'',
    "[Hv.M]::mciSendString('open new type waveaudio alias hv',$null,0,0)|Out-Null",
    // 16 kHz, mono, 16-bit: the shape a speech model reads, asked for before recording rather than
    // converted afterwards.
    "[Hv.M]::mciSendString('set hv bitspersample 16 channels 1 samplespersec 16000 alignment 2 bytespersec 32000',$null,0,0)|Out-Null",
    "[Hv.M]::mciSendString('record hv',$null,0,0)|Out-Null",
    // Blocks until the extension writes a line. This is the stop button.
    "[Console]::In.ReadLine()|Out-Null",
    "[Hv.M]::mciSendString('stop hv',$null,0,0)|Out-Null",
    `[Hv.M]::mciSendString('save hv "${file}"',$null,0,0)|Out-Null`,
    "[Hv.M]::mciSendString('close hv',$null,0,0)|Out-Null",
  ].join("; ");
}

/**
 * The recorders worth trying, in order.
 *
 * Ordered by how likely they are to be there already rather than by quality: all of them write the
 * same PCM, and a tool the user already has is worth more than a better one they would have to
 * install. How each is stopped is on the entry itself: SIGINT for the ones that finalise their WAV
 * header on it, a line of input for the Windows one, which has to reach an explicit `save`.
 */
export function recorders(platform: string): Recorder[] {
  if (platform === "darwin") {
    return [
      { program: "rec", args: (w) => ["-q", "-r", "16000", "-c", "1", "-b", "16", w], from: "sox", stop: "signal" },
      { program: "ffmpeg", args: (w) => ["-hide_banner", "-loglevel", "error", "-f", "avfoundation", "-i", ":0", "-ar", "16000", "-ac", "1", "-y", w], from: "ffmpeg", stop: "signal" },
    ];
  }
  if (platform === "win32") {
    return [
      // ⚠️ FIRST, and `builtin`, so nothing has to be installed before anybody can speak. Windows is
      // the one platform that ships no command-line recorder, and "install ffmpeg first" is not the
      // brief. `winmm` has been part of Windows for thirty years.
      {
        program: "powershell",
        args: (w) => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsRecorderScript(w)],
        from: "Windows",
        stop: "stdin",
        builtin: true,
      },
      { program: "ffmpeg", args: (w) => ["-hide_banner", "-loglevel", "error", "-f", "dshow", "-i", "audio=default", "-ar", "16000", "-ac", "1", "-y", w], from: "ffmpeg", stop: "signal" },
    ];
  }
  return [
    { program: "arecord", args: (w) => ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", w], from: "alsa-utils", stop: "signal" },
    { program: "pw-record", args: (w) => ["--rate", "16000", "--channels", "1", w], from: "pipewire", stop: "signal" },
    { program: "parecord", args: (w) => ["--rate=16000", "--channels=1", "--file-format=wav", w], from: "pulseaudio-utils", stop: "signal" },
    { program: "rec", args: (w) => ["-q", "-r", "16000", "-c", "1", "-b", "16", w], from: "sox", stop: "signal" },
    { program: "ffmpeg", args: (w) => ["-hide_banner", "-loglevel", "error", "-f", "alsa", "-i", "default", "-ar", "16000", "-ac", "1", "-y", w], from: "ffmpeg", stop: "signal" },
  ];
}

/** The one line to show when none of them is installed. Named packages, not "install something". */
export function howToRecord(platform: string): string {
  if (platform === "darwin") return "brew install sox";
  // Windows needs nothing: it records with what it already has. Reaching this line there means the
  // built-in recorder itself failed, and naming a package would be answering a different question.
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
