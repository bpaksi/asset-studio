import {
  existsSync,
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
  storeTestHooks,
  withStoryLock,
  workPaths,
  writeIndexAndNotes,
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

describe("withStoryLock", () => {
  afterEach(() => {
    storeTestHooks.lockTimeoutMs = undefined;
    storeTestHooks.beforeCommit = undefined;
    storeTestHooks.releaseLock = undefined;
  });

  it("AS-STORE-4 tells the user how to recover", () => {
    const paths = workPaths(dir, "s");
    storeTestHooks.lockTimeoutMs = 20;
    withStoryLock(
      paths,
      () => {
        expect(() => withStoryLock(paths, () => 1)).toThrow(
          /If no other asset-studio process is running, remove .*\.lock and try again/,
        );
      },
      { create: true },
    );
  });

  it("a missing story folder is never written unlocked", () => {
    const paths = workPaths(dir, "s");
    let ran = false;
    expect(() =>
      withStoryLock(
        paths,
        () => {
          ran = true;
        },
        {
          whenMissing: () => {
            throw new Error("no such asset");
          },
        },
      ),
    ).toThrow("no such asset");
    expect(ran).toBe(false);
    expect(existsSync(paths.root)).toBe(false);
    // Without a handler it fails coded, still without running or creating.
    expect(() => withStoryLock(paths, () => 1)).toThrow(
      /AS-STORE-5|does not exist/,
    );
    expect(existsSync(paths.root)).toBe(false);
  });

  it("if the folder appears while checking, the body runs under the lock", () => {
    const paths = workPaths(dir, "s");
    let lockedDuringBody = false;
    withStoryLock(
      paths,
      () => {
        lockedDuringBody = existsSync(join(paths.root, ".lock"));
      },
      { whenMissing: () => mkdirSync(paths.root) },
    );
    expect(lockedDuringBody).toBe(true);
  });

  it("a failed release keeps the body's own error", () => {
    const paths = workPaths(dir, "s");
    storeTestHooks.releaseLock = (lock) => {
      rmSync(lock, { recursive: true, force: true });
      throw new Error("release broke");
    };
    expect(() =>
      withStoryLock(
        paths,
        () => {
          throw new Error("body broke");
        },
        { create: true },
      ),
    ).toThrow("body broke");
    expect(() => withStoryLock(paths, () => 1, { create: true })).toThrow(
      /AS-STORE-7|could not be released/,
    );
  });

  it("AS-STORE-6: the notes write and the index restore both fail", () => {
    const paths = workPaths(dir, "s");
    recordDraft(paths, {
      id: "sound.x",
      kind: "k",
      data: bytes("1"),
      ext: "wav",
      size: { seconds: 1 },
      inputs: { v: 1 },
    });
    const entry = readIndex(paths)["sound.x"];
    if (entry === undefined) throw new Error("seed missing");
    storeTestHooks.beforeCommit = (path, purpose) => {
      if (path.endsWith("notes.json") || purpose === "restore") {
        throw new Error("fault");
      }
    };
    let code = "";
    try {
      writeIndexAndNotes(
        paths,
        { "sound.x": { ...entry, status: "rejected" } },
        {},
      );
    } catch (error) {
      code = (error as { code: string }).code;
    }
    expect(code).toBe("AS-STORE-6");
  });

  it("releases the lock when the body throws", () => {
    const paths = workPaths(dir, "s");
    expect(() =>
      withStoryLock(
        paths,
        () => {
          throw new Error("boom");
        },
        { create: true },
      ),
    ).toThrow("boom");
    expect(readdirSync(paths.root)).toEqual([]);
  });

  it("a held lock gives AS-STORE-4 after the timeout and is left alone", () => {
    const paths = workPaths(dir, "s");
    storeTestHooks.lockTimeoutMs = 50;
    withStoryLock(
      paths,
      () => {
        expect(() => withStoryLock(paths, () => 1)).toThrow(/in progress/);
      },
      { create: true },
    );
    expect(readdirSync(paths.root)).toEqual([]);
  });

  it("a failed commit leaves no temp file and keeps the old file", () => {
    const paths = workPaths(dir, "s");
    recordDraft(paths, {
      id: "sound.x",
      kind: "k",
      data: bytes("1"),
      ext: "wav",
      size: { seconds: 1 },
      inputs: { v: 1 },
    });
    const before = readFileSync(paths.index, "utf8");
    storeTestHooks.beforeCommit = () => {
      throw new Error("fault");
    };
    expect(() =>
      recordDraft(paths, {
        id: "sound.x",
        kind: "k",
        data: bytes("2"),
        ext: "wav",
        size: { seconds: 1 },
        inputs: { v: 2 },
      }),
    ).toThrow(/AS-STORE-5|fault/);
    expect(readFileSync(paths.index, "utf8")).toBe(before);
    expect(readdirSync(paths.root).sort()).toEqual(["index.json", "store"]);
  });
});
