// Dictation that needs no account, no key and no network after the first time.
//
// ⚠️ Asked for after three other answers were ruled out by measurement rather than opinion: VS Code's
// speech API is proposed and reachable only by its own extensions; the browser's recogniser answers
// `not-allowed` inside a webview; and the operating systems do not expose their dictation to a
// command except on Windows, where the scriptable engine is the old desktop one. What is left that
// works the same on all three is a model running on the machine — « oui construis le Whisper local ».
//
// whisper.cpp is the one that can be shipped this way: a single native binary with no runtime, under
// MIT, publishing prebuilt builds for Linux and Windows. Nothing here is an npm dependency; the
// extension downloads an archive once, with the user's consent, and runs a program.

/** The platforms a prebuilt build exists for, as Node names them. */
export interface Platform {
  platform: string;
  arch: string;
}

/**
 * The build this extension downloads, pinned.
 *
 * ⚠️ A tag, never "latest". A measurement has to be reproducible and so does a bug report: "it
 * stopped transcribing" is answerable when everyone has the same binary and unanswerable when the
 * answer depends on the day it was installed. Moving it is a commit, which is the point.
 */
export const WHISPER_BUILD = "b5454";

/**
 * The release asset for this machine, or nothing when there is no prebuilt one.
 *
 * ⚠️ macOS is the nothing, and it is stated rather than papered over: the project publishes an
 * `xcframework` for embedding in an app, not a command-line program. Pretending otherwise would mean
 * downloading 60 MB and then failing. Homebrew has `whisper-cpp`, which the caller offers instead —
 * one command, and then the same detection finds it on PATH.
 */
export function whisperAsset({ platform, arch }: Platform): string | undefined {
  if (platform === "linux") {
    if (arch === "x64") return "whisper-bin-ubuntu-x64.tar.gz";
    if (arch === "arm64") return "whisper-bin-ubuntu-arm64.tar.gz";
    return undefined;
  }
  if (platform === "win32") {
    if (arch === "x64") return "whisper-bin-x64.zip";
    if (arch === "ia32") return "whisper-bin-Win32.zip";
    if (arch === "arm64") return "whisper-bin-win-cpu-arm64.zip";
    return undefined;
  }
  return undefined;
}

export function whisperUrl(asset: string): string {
  return `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_BUILD}/${asset}`;
}

/** The program inside the archive. Windows names it with an extension; nothing else does. */
export function whisperBinary(platform: string): string {
  return platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

export interface WhisperModel {
  id: string;
  file: string;
  /** Megabytes, for the sentence that asks permission. A download nobody sized is a download nobody agreed to. */
  mb: number;
  hint: string;
}

/**
 * The models offered, smallest first.
 *
 * ⚠️ Only the English-only `.en` builds for the small sizes, because for dictation they are better
 * than the multilingual ones of the same size and no larger. `base` is the multilingual one, which is
 * the trade somebody dictating in French has to make: a bigger download for a model that knows their
 * language at all.
 */
export const WHISPER_MODELS: WhisperModel[] = [
  { id: "tiny.en", file: "ggml-tiny.en.bin", mb: 75, hint: "English only. The fastest, and enough for dictation." },
  { id: "base.en", file: "ggml-base.en.bin", mb: 142, hint: "English only. Noticeably steadier on names and numbers." },
  { id: "base", file: "ggml-base.bin", mb: 142, hint: "Every language Whisper knows, including French." },
  { id: "small", file: "ggml-small.bin", mb: 466, hint: "Every language, and the best of these. Slower on an old machine." },
];

export function modelUrl(file: string): string {
  return `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`;
}

export function modelFor(id: string): WhisperModel {
  return WHISPER_MODELS.find((m) => m.id === id) ?? WHISPER_MODELS[0]!;
}

/**
 * What to run, as argv.
 *
 * `-nt` drops the timestamps and `-np` the progress bars, which between them leave the transcript and
 * nothing else on stdout. The language is passed only when the user chose one: whisper's own
 * detection is better than a wrong hint, and an empty string is a wrong hint.
 */
export function whisperArgv(binary: string, model: string, wav: string, language?: string): string[] {
  return [binary, "-m", model, "-f", wav, "-nt", "-np", ...(language?.trim() ? ["-l", language.trim()] : [])];
}

/**
 * The transcript, out of what the program printed.
 *
 * ⚠️ It writes its own diagnostics to stdout as well — `read_audio_data: ...`, `whisper_init...` —
 * so taking the whole of stdout hands the model's own log to the user as though they had said it.
 * Every line that looks like a log is dropped, and what remains is joined.
 */
export function parseWhisperText(stdout: string): string {
  return stdout
    .split("\n")
    .filter((line) => !/^\s*(?:whisper_|read_audio_data|ggml_|main:|system_info|\[)/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
