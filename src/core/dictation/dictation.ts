// Speaking instead of typing.
//
// Florian: « je voudrais que tu rajoutes une option pour dicter (parler) ».
//
// Three decisions shape this, and the first two are forced:
//
//   • NOT the Web Speech API. `SpeechRecognition` exists in Chromium and is inert in Electron: the
//     implementation calls out to a Google speech service that an Electron build has no key for. A
//     feature built on it would appear to work in a browser test and do nothing in the product.
//     So: record audio in the panel, transcribe it here.
//
//   • LOCAL BY DEFAULT, and off until configured. A recording of somebody's voice is more personal
//     than the code around it, and it is one of the two things this extension cannot pseudonymise —
//     an image is the other. Sending it anywhere is a decision, not a default. So the first-class
//     path is a command on the user's own machine (whisper.cpp, faster-whisper, whatever they have),
//     and the remote path exists, goes through the same egress gate as everything else, and says
//     plainly that what is leaving is a recording of their voice.
//
//   • THE TRANSCRIPT LANDS IN THE COMPOSER, never in a sent question. Speech recognition
//     mis-hears, and a dictated question that sends itself is a question nobody proof-read. It
//     arrives as text the user can edit, which is also what makes a wrong transcription a
//     non-event rather than a wasted turn.

/**
 * Where a recording is turned into words.
 *
 * `local` is a command the user configured; `whisper` is the one this extension installs itself;
 * `remote` is a service. The two local ones are kept apart because only one of them is something the
 * extension can offer to set up, and the message when there is nothing has to know the difference.
 */
export type DictationMode = "off" | "local" | "whisper" | "remote";

export interface DictationSettings {
  /** A command on this machine. `{file}` is where the recording is written. */
  command: string;
  /** An OpenAI-compatible `/audio/transcriptions` endpoint. Only used when there is no command. */
  endpoint: string;
  model: string;
  /** A BCP-47 hint for the recogniser, or empty to let it decide. */
  language: string;
  /**
   * Which model the transcriber on this machine uses — see `core/dictation/local.ts`.
   *
   * Separate from `model`, which names the one a SERVICE is asked for. They are different catalogues
   * with different names, and one setting for both would have to be wrong for one of them.
   */
  localModel: string;
  /**
   * A command that records a WAV, with `{file}` for where to write it.
   *
   * ⚠️ It exists because the panel cannot have a microphone — VS Code withholds `media` from a
   * webview — so the recording is made by a program, and Windows ships nothing that records to a file
   * from a command line. Detection covers the usual tools; this covers the machine where it does not.
   */
  recordCommand: string;
}

/**
 * Providers whose endpoint is known to transcribe audio, so dictation can borrow it.
 *
 * ⚠️ KNOWN, not guessed, and that is the whole care in this list. Asked for: « il faudrait que ce
 * soit aussi simple d'utilsiation qu'un service cloud comme google mic » — so dictation should not
 * make you configure a second service when you have already configured one. But borrowing an
 * endpoint that does not answer `/audio/transcriptions` produces a microphone that records your
 * voice, sends it, and fails — which is worse than a microphone that says it needs setting up.
 *
 * OpenRouter is the instructive absence: it is the provider most people here have a key for, and it
 * offers no transcription endpoint at all. Local servers are absent for the same reason — Ollama and
 * LM Studio serve text, and the audio models they can run are not reached this way.
 */
const CAN_TRANSCRIBE = new Set(["openai", "azure", "groq"]);

/**
 * Which model each house calls its transcriber.
 *
 * ⚠️ Because `whisper-1` is OpenAI's NAME for it, not the model's. Sending that name to Groq is a 404
 * on a request that already carries your voice — the exact failure this whole file is arranged to
 * avoid. A single default could only ever be right for one provider.
 *
 * Groq is the one worth knowing about: its OpenAI-compatible transcription endpoint runs
 * whisper-large-v3-turbo, and its free tier is two thousand requests a day without a card. That is as
 * close to "it just works, on any machine, for nothing" as this gets without downloading a model.
 */
const TRANSCRIBER: Record<string, string> = {
  openai: "whisper-1",
  azure: "whisper-1",
  groq: "whisper-large-v3-turbo",
};

/**
 * The model to ask for, given what is configured and where the audio is going.
 *
 * A model the user typed always wins: they may have a fine-tune, or a gateway with its own names.
 */
export function transcriptionModel(settings: DictationSettings, chatProvider?: string): string {
  const chosen = settings.model.trim();
  if (chosen) return chosen;
  return (chatProvider && TRANSCRIBER[chatProvider]) || "whisper-1";
}

/**
 * Which path a dictation takes.
 *
 * The local command WINS when both are configured, and that order is the privacy stance made
 * operational: somebody who has set up both has the means to transcribe on their own machine, and
 * nothing should quietly prefer the network because it is faster.
 *
 * ⚠️ And when nothing is configured at all, the CHAT provider is borrowed — but only one already
 * known to transcribe. That is the difference between "it just works" and "it fails later": every
 * other provider still has to be told, because being told is better than being recorded for nothing.
 */
export function dictationMode(
  settings: DictationSettings,
  chatProvider?: string,
  /** True when this extension's own transcriber is already installed on this machine. */
  hasWhisper = false,
): DictationMode {
  if (settings.command.trim()) return "local";
  // ⚠️ BEFORE any service, and that order is the privacy stance made operational — the same reasoning
  // that already puts a configured command first. Somebody who has a transcriber on their machine has
  // the means to keep their voice on it, and nothing should quietly prefer the network because it is
  // faster or because a key happens to be lying around.
  if (hasWhisper) return "whisper";
  if (settings.endpoint.trim()) return "remote";
  if (chatProvider && CAN_TRANSCRIBE.has(chatProvider)) return "remote";
  return "off";
}

/**
 * Where a recording goes, given what is configured and what can be borrowed.
 *
 * Returns nothing when there is nowhere, which the caller turns into the offer to set one up.
 */
export function transcriptionEndpoint(
  settings: DictationSettings,
  chat: { provider?: string; baseUrl?: string },
): string | undefined {
  if (settings.endpoint.trim()) return settings.endpoint.trim();
  if (chat.provider && CAN_TRANSCRIBE.has(chat.provider) && chat.baseUrl?.trim()) return chat.baseUrl.trim();
  return undefined;
}

/** What the audio is written as. `webm/opus` is what every Chromium `MediaRecorder` produces. */
export const AUDIO_EXTENSION = "webm";
export const AUDIO_MIME = "audio/webm";

export interface LocalCommandProblem {
  message: string;
}

/**
 * The command to run, with the recording's path substituted in.
 *
 * ⚠️ A template with no `{file}` in it is REFUSED rather than having the path appended. Appending
 * would guess at the tool's argument order, and the first thing a wrong guess does is run a command
 * the user did not write — on a configuration they will read as working. The settings description
 * says `{file}`; this makes it true.
 *
 * Returned as argv, never as a shell line. A path with a space in it — `~/My Recordings/` — is two
 * arguments to a shell and one to `spawn`, and the project already learned that with task prompts:
 * text that goes through `sh -c` is a command.
 */
export function localCommand(template: string, audioPath: string): { argv: string[] } | LocalCommandProblem {
  const trimmed = template.trim();
  if (!trimmed) return { message: "No dictation command is configured." };
  if (!trimmed.includes("{file}")) {
    return {
      message:
        "The dictation command must say where the recording goes, with {file}. " +
        "For example: whisper-cli -f {file} --output-txt -",
    };
  }
  // Split on whitespace that is not inside quotes, then unquote. Enough for a command somebody typed
  // into a settings box, and it does not hand the string to a shell.
  const parts = trimmed.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const argv = parts.map((part) =>
    (part.startsWith('"') && part.endsWith('"')) || (part.startsWith("'") && part.endsWith("'"))
      ? part.slice(1, -1)
      : part,
  );
  const substituted = argv.map((part) => part.split("{file}").join(audioPath));
  const [program, ...rest] = substituted;
  if (!program) return { message: "No dictation command is configured." };
  return { argv: [program, ...rest] };
}

/**
 * A `multipart/form-data` body, built by hand.
 *
 * Zero runtime dependencies is the project's rule, and `FormData` in a Node 18 extension host does
 * not serialise a file the way every transcription endpoint expects. So the bytes are assembled
 * here, which is a dozen lines and removes a dependency from a path that carries somebody's voice.
 */
export function transcriptionBody(
  audio: Uint8Array,
  opts: { model: string; language?: string; filename?: string },
): { body: Uint8Array; contentType: string } {
  const boundary = `----hivey${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const field = (name: string, value: string): void => {
    parts.push(encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  };
  field("model", opts.model);
  if (opts.language) field("language", opts.language);
  // `text` rather than `json`: there is nothing in the JSON this needs, and a plain body cannot
  // surprise the parser.
  field("response_format", "text");
  parts.push(
    encoder.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${opts.filename ?? `speech.${AUDIO_EXTENSION}`}"\r\n` +
        `Content-Type: ${AUDIO_MIME}\r\n\r\n`,
    ),
  );
  parts.push(audio);
  parts.push(encoder.encode(`\r\n--${boundary}--\r\n`));

  const total = parts.reduce((n, p) => n + p.length, 0);
  const body = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    body.set(part, at);
    at += part.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * What a recogniser printed, as text to put in the composer.
 *
 * Recognisers are inconsistent about what they return: some print JSON even when asked for text,
 * some wrap the line in quotes, all of them add a trailing newline, and whisper.cpp prefixes
 * timestamps unless told not to. None of that belongs in a question.
 */
export function cleanTranscript(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  // A recogniser that answered in JSON despite being asked for text.
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as { text?: unknown };
      if (typeof parsed.text === "string") text = parsed.text.trim();
    } catch {
      /* not JSON after all; use it as it came */
    }
  }
  // `[00:00:00.000 --> 00:00:02.000]  Hello` — whisper.cpp's default output.
  text = text
    .split("\n")
    .map((line) => line.replace(/^\[[\d:.\s>-]+\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ");
  // A whole answer wrapped in quotes is a serialisation artefact, not emphasis.
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("“") && text.endsWith("”"))) {
    text = text.slice(1, -1).trim();
  }
  // Recognisers emit `[BLANK_AUDIO]`, `(silence)`, `[inaudible]` for nothing at all. A question made
  // of those is worse than an empty one, because it looks deliberate.
  if (/^[([][^)\]]*[)\]]$/.test(text) && /blank|silence|inaudible|music|noise/i.test(text)) return "";
  return text;
}
