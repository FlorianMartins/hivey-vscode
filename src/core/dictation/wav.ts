// A WAV file, read by hand.
//
// ⚠️ Because whisper.cpp decodes WAV, FLAC and MP3 — and `MediaRecorder` produces Opus in WebM, which
// is none of them. Found by running the transcriber against a real recording rather than by reading
// its documentation: the remote services accept the WebM happily, so nothing upstream had ever had to
// care. A local transcriber is the first consumer that does.
//
// The recorder on the machine writes the file; what lives here is the look at it before it is handed
// over. The format is forty-four bytes of header and then the samples, which is why that can be done
// here instead of with a dependency.

/** The header is a fixed 44 bytes: RIFF, fmt and data, in that order. */
export const WAV_HEADER_BYTES = 44;

export interface WavFacts {
  ok: boolean;
  /** Why it cannot be transcribed, in words somebody can act on. */
  why?: string;
  seconds: number;
  rate: number;
  channels: number;
  bits: number;
}

/**
 * What a recording actually is, before it is handed to a transcriber.
 *
 * ⚠️ This exists because a broken recording reached whisper.cpp and the person got ITS error:
 * `failed to read the frames of the audio data (Invalid argument)`, followed by a temporary path.
 * That sentence is true, useless, and frightening — it describes a C++ reader's opinion of a file
 * nobody asked about. The useful sentence is "nothing was recorded", and it can only be said by
 * looking at the file first.
 *
 * Deliberately permissive about everything that does not stop a transcription: a WAV may carry
 * `LIST` or `fact` chunks, any order, and still be perfectly readable. What is checked is what makes
 * it unreadable — not a WAV at all, no `data` chunk, or no frames in it.
 */
export function describeWav(buf: Uint8Array): WavFacts {
  const none = { ok: false, seconds: 0, rate: 0, channels: 0, bits: 0 };
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const tag = (at: number) => String.fromCharCode(buf[at]!, buf[at + 1]!, buf[at + 2]!, buf[at + 3]!);
  if (buf.length < WAV_HEADER_BYTES || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    return { ...none, why: "that file is not a recording" };
  }
  let at = 12;
  let rate = 0;
  let channels = 0;
  let bits = 0;
  let data = -1;
  while (at + 8 <= buf.length) {
    const kind = tag(at);
    const size = view.getUint32(at + 4, true);
    if (kind === "fmt " && at + 24 <= buf.length) {
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    }
    if (kind === "data") {
      // The declared size can exceed what is on disk when a recorder was interrupted; what is
      // actually there is what can be read.
      data = Math.min(size, buf.length - at - 8);
      break;
    }
    at += 8 + size + (size % 2);
  }
  const frame = (channels || 1) * ((bits || 16) / 8);
  const seconds = data > 0 && rate ? data / frame / rate : 0;
  if (data <= 0) return { ...none, rate, channels, bits, why: "nothing was recorded" };
  // A tenth of a second is below anything anybody meant to say, and is what an input device that
  // opened and captured silence leaves behind.
  if (seconds < 0.1) return { ok: false, seconds, rate, channels, bits, why: "the recording is empty" };
  return { ok: true, seconds, rate, channels, bits };
}
