// A WAV file, written by hand.
//
// ⚠️ Because whisper.cpp decodes WAV, FLAC and MP3 — and `MediaRecorder` produces Opus in WebM, which
// is none of them. Found by running the transcriber against a real recording rather than by reading
// its documentation: the remote services accept the WebM happily, so nothing upstream had ever had to
// care. A local transcriber is the first consumer that does.
//
// The format is forty-four bytes of header and then the samples, which is why it can live here
// instead of being a dependency. Mono, 16-bit, at whatever rate the capture ran — Whisper wants
// 16 kHz and the capture asks for it, but the file states the rate it actually got rather than the
// one that was hoped for.

/** The header is a fixed 44 bytes: RIFF, fmt and data, in that order. */
export const WAV_HEADER_BYTES = 44;

/**
 * One WAV file from the chunks a recording arrived in.
 *
 * Samples are floats in [-1, 1], which is what the Web Audio API hands over, and are written as
 * signed 16-bit — the format every speech model expects and half the size of 32-bit float for no
 * audible difference at this sample rate.
 */
export function encodeWav(chunks: Float32Array[], sampleRate: number): Uint8Array {
  const count = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(WAV_HEADER_BYTES + count * 2);
  const view = new DataView(out.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true); // everything after this field
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // the size of this chunk: 16 for PCM
  view.setUint16(20, 1, true); // 1 = uncompressed PCM
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes per second: rate × channels × 2
  view.setUint16(32, 2, true); // bytes per frame
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, count * 2, true);

  let at = WAV_HEADER_BYTES;
  for (const chunk of chunks) {
    for (const sample of chunk) {
      // Clamped before scaling: a sample above 1 wraps around to a loud click when it overflows, and
      // a recording with the gain up is full of them.
      const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
      view.setInt16(at, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      at += 2;
    }
  }
  return out;
}

/** The rate a speech model wants. Asked of the capture; what the file states is what was given. */
export const SPEECH_SAMPLE_RATE = 16_000;
