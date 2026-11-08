/** Wrap 16-bit little-endian PCM in a 44-byte WAV header. */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = 24000,
  channels = 1,
  bits = 16,
): Uint8Array {
  const out = Buffer.alloc(44 + pcm.byteLength);
  out.write("RIFF", 0);
  out.writeUInt32LE(36 + pcm.byteLength, 4);
  out.write("WAVE", 8);
  out.write("fmt ", 12);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE((sampleRate * channels * bits) / 8, 28);
  out.writeUInt16LE((channels * bits) / 8, 32);
  out.writeUInt16LE(bits, 34);
  out.write("data", 36);
  out.writeUInt32LE(pcm.byteLength, 40);
  out.set(pcm, 44);
  return out;
}

export type ParsedWav = {
  pcm16: Uint8Array;
  sampleRate: number;
  channels: number;
  frames: number;
};

/** Read a PCM 16-bit WAV. Throws a plain Error naming what is wrong. */
export function parseWav(bytes: Uint8Array): ParsedWav {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    buf.length < 12 ||
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  ) {
    throw new Error("not a RIFF/WAVE file");
  }
  let format: { channels: number; sampleRate: number } | undefined;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === "fmt ") {
      if (start + 16 > buf.length) throw new Error("truncated fmt chunk");
      const tag = buf.readUInt16LE(start);
      const bits = buf.readUInt16LE(start + 14);
      if (tag !== 1 || bits !== 16) {
        throw new Error("only 16-bit PCM WAV is supported");
      }
      format = {
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
      };
    } else if (id === "data") {
      if (format === undefined) throw new Error("data chunk before fmt chunk");
      if (start + size > buf.length) throw new Error("truncated data chunk");
      const end = start + size;
      const bytesPerFrame = format.channels * 2;
      if (format.channels <= 0 || format.sampleRate <= 0) {
        throw new Error("bad WAV format");
      }
      const length = end - start;
      if (length % bytesPerFrame !== 0) {
        throw new Error("data is not a whole number of frames");
      }
      return {
        pcm16: buf.subarray(start, end),
        sampleRate: format.sampleRate,
        channels: format.channels,
        frames: length / bytesPerFrame,
      };
    }
    offset = start + size + (size % 2);
  }
  throw new Error("no data chunk");
}
