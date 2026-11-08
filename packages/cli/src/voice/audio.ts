import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CliError } from "../config/errors.js";

const run = promisify(execFile);

/** Turns a WAV master into the m4a draft, and measures other audio files. */
export interface AudioConverter {
  /** WAV PCM bytes in, m4a (AAC) bytes out. */
  wavToM4a(wav: Uint8Array): Promise<Uint8Array>;
  /** Length in seconds of an audio file that is not a WAV. */
  durationSeconds(file: Uint8Array, ext: string): Promise<number>;
}

function needMac(): never {
  throw new CliError(
    "AS-VOICE-7",
    "Audio conversion needs macOS afconvert, which is not available on this system.",
  );
}

/** macOS `afconvert` / `afinfo`. */
export const afconvertConverter: AudioConverter = {
  async wavToM4a(wav) {
    if (process.platform !== "darwin") needMac();
    const dir = await mkdtemp(join(tmpdir(), "as-voice-"));
    try {
      const input = join(dir, "in.wav");
      const output = join(dir, "out.m4a");
      await writeFile(input, wav);
      await run("afconvert", ["-f", "m4af", "-d", "aac", input, output]);
      return new Uint8Array(await readFile(output));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  async durationSeconds(file, ext) {
    if (process.platform !== "darwin") needMac();
    const dir = await mkdtemp(join(tmpdir(), "as-voice-"));
    try {
      const input = join(dir, `in.${ext}`);
      await writeFile(input, file);
      const { stdout } = await run("afinfo", [input]);
      const match = /estimated duration:\s*([0-9.]+)\s*sec/.exec(stdout);
      if (match?.[1] === undefined) {
        throw new Error("afinfo gave no duration");
      }
      return Number(match[1]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
};
