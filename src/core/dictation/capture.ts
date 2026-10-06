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
  /**
   * Its arguments, given the file to write and the input to listen to.
   *
   * ⚠️ The device is the second argument because of a real machine with several inputs: « mon ami qui
   * a plusieurs sources d'entrée de son […] son micro n'a rien entendu ». A recorder that always takes
   * the system default works perfectly for anybody with one microphone and silently records nothing
   * for anybody with two.
   */
  args: (wav: string, device?: string) => string[];
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
  /**
   * How its inputs are listed, when it can be told which one to use.
   *
   * ⚠️ Absent means the recorder takes whatever the system calls the default and cannot be told
   * otherwise — which is true of the Windows fallback: MCI's `waveaudio` opens the WAVE_MAPPER, and
   * the WAVE_MAPPER is the Windows default recording device. Somebody with two microphones has to
   * change it in Windows, or use a recorder that can be told. Saying so is the difference between a
   * limitation and a mystery.
   */
  devices?: "dshow" | "alsa" | "avfoundation";
  /**
   * True when it writes the file as it records, rather than only at the end.
   *
   * ⚠️ This is what decides whether the edge of the box can follow the voice: the loudness is read
   * from the file as it grows, because the panel has no microphone of its own to listen to. The
   * Windows fallback saves once, at the end — so with it there is nothing to read until there is
   * nothing left to show, and the ring has to say "listening" some other way rather than pretend.
   */
  streams: boolean;
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
    'Add-Type -Name M -Namespace Hv -MemberDefinition \'[DllImport("winmm.dll",CharSet=CharSet.Auto)] public static extern int mciSendString(string c, System.Text.StringBuilder r, int l, System.IntPtr h); [DllImport("winmm.dll",CharSet=CharSet.Auto)] public static extern bool mciGetErrorString(int e, System.Text.StringBuilder s, int l);\'',
    // ⚠️ Every call is CHECKED. They were all piped to `Out-Null`, so a device that refused to open —
    // no input, or another program holding it — produced a perfectly quiet failure and a file with a
    // header and no frames. The person then got whisper.cpp's opinion of that file, which named a
    // temporary path and said `Invalid argument`. The error belongs where it happens.
    "function mci($c){ $r=New-Object System.Text.StringBuilder 256; $e=[Hv.M]::mciSendString($c,$r,256,0); if($e -ne 0){ $m=New-Object System.Text.StringBuilder 256; [void][Hv.M]::mciGetErrorString($e,$m,256); [Console]::Error.WriteLine($m.ToString()); exit 1 } }",
    "mci('open new type waveaudio alias hv')",
    // 16 kHz, mono, 16-bit PCM: the shape a speech model reads, asked for before recording rather
    // than converted afterwards. `format tag pcm` is what makes the rest of the line stick.
    "mci('set hv format tag pcm')",
    "mci('set hv bitspersample 16 channels 1 samplespersec 16000 alignment 2 bytespersec 32000')",
    "mci('record hv')",
    // Blocks until the extension writes a line. This is the stop button.
    "[Console]::In.ReadLine()|Out-Null",
    "mci('stop hv')",
    `mci('save hv "${file}"')`,
    "mci('close hv')",
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
/**
 * ⚠️ `-flush_packets 1` on every ffmpeg line, and it is not a flourish.
 *
 * ffmpeg buffers its output, so without it the WAV arrives in one piece and the edge of the box never
 * moves — which is exactly the symptom reported. Measured rather than reasoned: a nine-second
 * real-time capture produced 71 level readings with it and 0 without.
 */
export function recorders(platform: string): Recorder[] {
  if (platform === "darwin") {
    return [
      { program: "rec", args: (w) => ["-q", "-r", "16000", "-c", "1", "-b", "16", w], from: "sox", stop: "signal", streams: true },
      {
        program: "ffmpeg",
        // `:0` is avfoundation's first audio input; a chosen device replaces the index.
        args: (w, d) => ["-hide_banner", "-loglevel", "error", "-flush_packets", "1", "-f", "avfoundation", "-i", `:${d?.trim() || "0"}`, "-ar", "16000", "-ac", "1", "-y", w],
        from: "ffmpeg", stop: "signal", streams: true, devices: "avfoundation",
      },
    ];
  }
  if (platform === "win32") {
    return [
      // ⚠️ ffmpeg FIRST, and the `builtin` one after it — the other way round was a real defect: a
      // `builtin` recorder matches every time, so the search never reached ffmpeg and a machine that
      // HAD it was served the lesser path anyway. Lesser in one specific way: ffmpeg streams, so the
      // edge of the box can follow the voice, and the Windows fallback writes once at the end.
      {
        program: "ffmpeg",
        args: (w, d) => ["-hide_banner", "-loglevel", "error", "-flush_packets", "1", "-f", "dshow", "-i", `audio=${d?.trim() || "default"}`, "-ar", "16000", "-ac", "1", "-y", w],
        from: "ffmpeg", stop: "signal", streams: true, devices: "dshow",
      },
      // Nothing to install before anybody can speak: `winmm` has been part of Windows for thirty
      // years, and "install ffmpeg first" was never the brief.
      {
        program: "powershell",
        args: (w) => ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsRecorderScript(w)],
        from: "Windows",
        stop: "stdin",
        builtin: true,
        streams: false,
      },
    ];
  }
  return [
    {
      program: "arecord",
      args: (w, d) => ["-q", ...(d?.trim() ? ["-D", d.trim()] : []), "-f", "S16_LE", "-r", "16000", "-c", "1", w],
      from: "alsa-utils", stop: "signal", streams: true, devices: "alsa",
    },
    { program: "pw-record", args: (w) => ["--rate", "16000", "--channels", "1", w], from: "pipewire", stop: "signal", streams: true },
    { program: "parecord", args: (w) => ["--rate=16000", "--channels=1", "--file-format=wav", w], from: "pulseaudio-utils", stop: "signal", streams: true },
    { program: "rec", args: (w) => ["-q", "-r", "16000", "-c", "1", "-b", "16", w], from: "sox", stop: "signal", streams: true },
    {
      program: "ffmpeg",
      args: (w, d) => ["-hide_banner", "-loglevel", "error", "-flush_packets", "1", "-f", "alsa", "-i", d?.trim() || "default", "-ar", "16000", "-ac", "1", "-y", w],
      from: "ffmpeg", stop: "signal", streams: true, devices: "alsa",
    },
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

// ── Which microphone ─────────────────────────────────────────────────────────────────────────────

export interface InputDevice {
  /** What to pass to the recorder. */
  id: string;
  /** What to show a person choosing. */
  label: string;
}

/**
 * How to ask a recorder what inputs exist.
 *
 * Each tool answers on **stderr**, which is where "informational output that is not the thing you
 * asked for" goes, and each of them exits non-zero afterwards because listing was never what the
 * command said it was doing. Both are normal and neither is a failure.
 */
export function listDevicesArgv(kind: NonNullable<Recorder["devices"]>): { program: string; args: string[] } {
  if (kind === "dshow") return { program: "ffmpeg", args: ["-hide_banner", "-list_devices", "true", "-f", "dshow", "-i", "dummy"] };
  if (kind === "avfoundation") return { program: "ffmpeg", args: ["-hide_banner", "-list_devices", "true", "-f", "avfoundation", "-i", ""] };
  return { program: "arecord", args: ["-L"] };
}

/**
 * The inputs, out of what the tool printed.
 *
 * ⚠️ Written from each tool's documented output rather than invented, and kept forgiving: a parser
 * that returns nothing when a line is a shade different leaves somebody with several microphones
 * exactly where they started — which is the situation this exists for. Anything unrecognised is
 * skipped, never guessed at.
 */
export function parseDevices(kind: NonNullable<Recorder["devices"]>, text: string): InputDevice[] {
  const out: InputDevice[] = [];
  if (kind === "dshow") {
    // `[dshow @ …] "Microphone (Realtek Audio)" (audio)` — the quoted name is what `-i audio=` takes.
    // Video devices are listed the same way and are not microphones.
    for (const line of text.split("\n")) {
      const m = /"([^"]+)"\s*\(audio\)/.exec(line);
      if (m?.[1]) out.push({ id: m[1], label: m[1] });
    }
    return out;
  }
  if (kind === "avfoundation") {
    // Two lists in one output; only what follows "AVFoundation audio devices:" counts.
    const after = text.split(/AVFoundation audio devices:/)[1] ?? "";
    for (const line of after.split("\n")) {
      const m = /\[(\d+)\]\s*(.+?)\s*$/.exec(line.replace(/^\[[^\]]*\]\s*/, ""));
      if (m?.[1] && m[2]) out.push({ id: m[1], label: m[2] });
    }
    return out;
  }
  // `arecord -L`: a name on its own line, then indented description lines. Only the capture-capable
  // ones are worth offering, and `null` is a device that records silence perfectly.
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const name = lines[i] ?? "";
    if (/^\s/.test(name) || !name.trim() || name.trim() === "null") continue;
    const described = (lines[i + 1] ?? "").trim();
    out.push({ id: name.trim(), label: described ? `${name.trim()} — ${described}` : name.trim() });
  }
  return out;
}
