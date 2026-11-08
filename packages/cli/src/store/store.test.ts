import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalJson,
  inputsHash,
  putFile,
  readIndex,
  recordDraft,
  sha256,
  workPaths,
} from "./store.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "as-store-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const bytes = (text: string) => new TextEncoder().encode(text);

describe("putFile", () => {
  it("names files by content hash and dedups the same bytes", () => {
    const store = join(dir, "store");
    const first = putFile(store, bytes("hello"), "wav");
    const second = putFile(store, bytes("hello"), "wav");
    expect(first.file).toBe(`${sha256("hello")}.wav`);
    expect(first.created).toBe(true);
    expect(second).toEqual({ ...first, created: false });
    expect(readdirSync(store)).toEqual([first.file]);
  });

  it("keeps different bytes in different files", () => {
    const store = join(dir, "store");
    const a = putFile(store, bytes("a"), "webp");
    const b = putFile(store, bytes("b"), "webp");
    expect(a.file).not.toBe(b.file);
    expect(readdirSync(store).sort()).toEqual([a.file, b.file].sort());
  });

  it("never overwrites: a tampered existing file is an error and stays as it was", () => {
    const store = join(dir, "store");
    const { file } = putFile(store, bytes("x"), "wav");
    writeFileSync(join(store, file), "tampered");
    expect(() => putFile(store, bytes("x"), "wav")).toThrow(
      /AS-STORE-1|does not match/,
    );
    expect(readFileSync(join(store, file), "utf8")).toBe("tampered");
    expect(readdirSync(store)).toEqual([file]);
  });

  it("rejects an unsafe extension", () => {
    expect(() => putFile(join(dir, "s"), bytes("x"), "../x")).toThrow(
      /extension/,
    );
  });
});

describe("inputsHash", () => {
  it("ignores key order and undefined values", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: undefined }] })).toBe(
      '{"a":[2,{"d":1}],"b":1}',
    );
    expect(inputsHash({ a: 1, b: 2 })).toBe(inputsHash({ b: 2, a: 1 }));
    expect(inputsHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(inputsHash({ a: 1 })).not.toBe(inputsHash({ a: 2 }));
  });
});

describe("recordDraft", () => {
  const draft = (text: string, inputs: unknown) => ({
    id: "painting.n1-house",
    kind: "painting",
    data: bytes(text),
    ext: "webp",
    size: { width: 4, height: 3 },
    inputs,
  });

  it("same inputs reuse the file and keep the status", () => {
    const paths = workPaths(dir, "dracula");
    expect(recordDraft(paths, draft("v1", { p: 1 })).reused).toBe(false);
    const index = readIndex(paths);
    writeFileSync(
      paths.index,
      JSON.stringify({
        "painting.n1-house": {
          ...index["painting.n1-house"],
          status: "final",
        },
      }),
    );
    const again = recordDraft(paths, draft("v1-different-bytes", { p: 1 }));
    expect(again.reused).toBe(true);
    expect(again.entry.status).toBe("final");
    expect(readdirSync(paths.store)).toHaveLength(1);
  });

  const fileOf = (entry: { file?: string | null }): string => {
    if (!entry.file) throw new Error("entry has no file");
    return entry.file;
  };

  const approve = (paths: ReturnType<typeof workPaths>) => {
    const index = readIndex(paths);
    writeFileSync(
      paths.index,
      JSON.stringify({
        "painting.n1-house": {
          ...index["painting.n1-house"],
          status: "final",
        },
      }),
    );
  };

  it("healthy cache hit preserves final approval and the file", () => {
    const paths = workPaths(dir, "dracula");
    const first = recordDraft(paths, draft("v1", { p: 1 })).entry;
    approve(paths);
    const again = recordDraft(paths, draft("v1", { p: 1 }));
    expect(again.reused).toBe(true);
    expect(again.entry.status).toBe("final");
    expect(readIndex(paths)["painting.n1-house"]?.status).toBe("final");
    expect(readdirSync(paths.store)).toEqual([fileOf(first)]);
  });

  it("cache hit with a missing artifact regenerates it as a draft", () => {
    const paths = workPaths(dir, "dracula");
    const first = recordDraft(paths, draft("v1", { p: 1 })).entry;
    approve(paths);
    rmSync(join(paths.store, fileOf(first)));
    const again = recordDraft(paths, draft("v1", { p: 1 }));
    expect(again.reused).toBe(false);
    expect(again.entry.status).toBe("draft");
    expect(readFileSync(join(paths.store, fileOf(again.entry)), "utf8")).toBe(
      "v1",
    );
    expect(readIndex(paths)["painting.n1-house"]?.file).toBe(again.entry.file);
  });

  it("cache hit with a corrupt artifact fails and overwrites nothing", () => {
    const paths = workPaths(dir, "dracula");
    const first = recordDraft(paths, draft("v1", { p: 1 })).entry;
    approve(paths);
    const indexBefore = readFileSync(paths.index, "utf8");
    writeFileSync(join(paths.store, fileOf(first)), "tampered");
    expect(() => recordDraft(paths, draft("v1", { p: 1 }))).toThrow(
      /AS-STORE-1|does not match/,
    );
    expect(readFileSync(join(paths.store, fileOf(first)), "utf8")).toBe(
      "tampered",
    );
    expect(readdirSync(paths.store)).toEqual([fileOf(first)]);
    expect(readFileSync(paths.index, "utf8")).toBe(indexBefore);
  });

  it("new inputs add a file, keep the old one and go back to draft", () => {
    const paths = workPaths(dir, "dracula");
    const first = recordDraft(paths, draft("v1", { p: 1 })).entry;
    const second = recordDraft(paths, draft("v2", { p: 2 }));
    expect(second.reused).toBe(false);
    expect(second.entry.file).not.toBe(first.file);
    expect(second.entry.status).toBe("draft");
    expect(readdirSync(paths.store).sort()).toEqual(
      [first.file, second.entry.file].sort(),
    );
  });
});

describe("index files", () => {
  it("rejects a corrupt index with AS-STORE-3", () => {
    const paths = workPaths(dir, "dracula");
    mkdirSync(paths.root, { recursive: true });
    writeFileSync(paths.index, '{"bad id": {}}');
    expect(() => readIndex(paths)).toThrow(/valid work folder file/);
  });

  it("reads a missing index as empty", () => {
    expect(readIndex(workPaths(dir, "none"))).toEqual({});
  });
});
