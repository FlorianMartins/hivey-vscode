// The microphone, and what to do when there isn't one.
//
// Recording happens here because this is the only part of the extension that runs in a browser
// context. Transcription happens in the extension host — see `core/dictation/dictation.ts` for why
// the Web Speech API is not an option in Electron and why the default path is a command on the
// user's own machine.
//
// ⚠️ CAPABILITY IS DETECTED, NOT ASSUMED. Whether a VS Code webview may open a microphone depends on
// the editor's version and on a permission the user grants to the window — so this asks, and when the
// answer is no it SAYS so instead of appearing to record. A button that looks like it is listening
// and is not is worse than no button: the user speaks a paragraph into nothing.

import { t } from "../shared/i18n.js";
import { encodeWav, SPEECH_SAMPLE_RATE } from "../core/dictation/wav.js";

export interface Recorder {
  stop: () => void;
  cancel: () => void;
}

/** Whether this host could even offer dictation. Cheap, and no permission prompt. */
export function microphonePossible(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";
}

/**
 * Start recording, and hand back the two ways it can end.
 *
 * `stop` transcribes what was captured; `cancel` throws it away. Both exist because they are
 * different intentions and the second one must never reach a transcriber: somebody who changes their
 * mind mid-sentence has not asked for their voice to be sent anywhere.
 *
 * @param onDone called with base64 audio and its duration, unless cancelled.
 * @param onError called with something a person can act on.
 */
export async function startRecording(
  onDone: (audio: string, ms: number) => void,
  onError: (why: string) => void,
  /**
   * Record a WAV instead of WebM.
   *
   * ⚠️ For the transcriber that runs on this machine, which decodes WAV, FLAC and MP3 — and not the
   * Opus-in-WebM every `MediaRecorder` produces. The remote services accept the WebM happily, which
   * is why nothing had ever had to care until something local tried to read it.
   */
  wav = false,
): Promise<Recorder | undefined> {
  if (!microphonePossible()) {
    onError(t("This editor does not give the panel a microphone."));
    return undefined;
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    // Told apart, because the two have different answers: one is a permission to grant, the other is
    // a device to plug in.
    const name = (err as { name?: string }).name;
    onError(
      name === "NotAllowedError"
        ? t("The microphone was refused. Allow it for this window and try again.")
        : name === "NotFoundError"
          ? t("No microphone was found.")
          : t("The microphone could not be opened: {0}", (err as Error).message),
    );
    return undefined;
  }

  const started = Date.now();
  let cancelled = false;

  if (wav) return recordWav(stream, started, onDone, onError, () => cancelled, (c) => (cancelled = c));

  const chunks: Blob[] = [];
  // Opus in WebM is what every Chromium `MediaRecorder` produces, and what every transcriber accepts.
  // The type is offered rather than demanded: a host that disagrees records in its own default
  // instead of refusing, and the transcriber sniffs the container anyway.
  const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined);
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  recorder.addEventListener("stop", () => {
    // The tracks are stopped whatever happened, or the editor keeps showing a recording indicator on
    // a window that is no longer listening.
    for (const track of stream.getTracks()) track.stop();
    if (cancelled) return;
    const ms = Date.now() - started;
    if (ms < 400 || !chunks.length) {
      onError(t("That was too short to transcribe."));
      return;
    }
    const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
    const reader = new FileReader();
    reader.onload = () => {
      // `data:audio/webm;base64,AAAA…` — only the payload travels.
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      onDone(comma >= 0 ? url.slice(comma + 1) : "", ms);
    };
    reader.onerror = () => onError(t("The recording could not be read."));
    reader.readAsDataURL(blob);
  });
  recorder.start();

  return {
    stop: () => {
      if (recorder.state !== "inactive") recorder.stop();
    },
    cancel: () => {
      cancelled = true;
      if (recorder.state !== "inactive") recorder.stop();
      else for (const track of stream.getTracks()) track.stop();
    },
  };
}

/**
 * The same recording, as a WAV.
 *
 * `ScriptProcessorNode` is deprecated in favour of `AudioWorklet`, and is used anyway: a worklet is a
 * separate script file, which means another resource for the panel's CSP to allow and another file to
 * ship, for a node that exists in every browser this extension can run in. When it stops existing,
 * this is the one place that changes.
 *
 * The context is asked for 16 kHz, which is the rate speech models want, and the file states the rate
 * it actually got — a host that refuses the request gives something else, and a WAV that lies about
 * its rate is a recording played at the wrong speed.
 */
function recordWav(
  stream: MediaStream,
  started: number,
  onDone: (audio: string, ms: number) => void,
  onError: (why: string) => void,
  cancelled: () => boolean,
  setCancelled: (c: boolean) => void,
): Recorder {
  const ctx = new AudioContext({ sampleRate: SPEECH_SAMPLE_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  node.onaudioprocess = (event) => {
    // Copied, not kept: the event's buffer is reused by the next callback, so holding a reference
    // records the same fraction of a second over and over.
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  source.connect(node);
  // Connected to the output because a `ScriptProcessorNode` that reaches nothing is never pulled, and
  // therefore never fires. Nothing is audible: it writes no output samples.
  node.connect(ctx.destination);

  const finish = () => {
    node.disconnect();
    source.disconnect();
    void ctx.close();
    for (const track of stream.getTracks()) track.stop();
    if (cancelled()) return;
    const ms = Date.now() - started;
    if (ms < 400 || !chunks.length) {
      onError(t("That was too short to transcribe."));
      return;
    }
    const bytes = encodeWav(chunks, ctx.sampleRate);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    onDone(btoa(binary), ms);
  };

  return {
    stop: finish,
    cancel: () => {
      setCancelled(true);
      finish();
    },
  };
}
