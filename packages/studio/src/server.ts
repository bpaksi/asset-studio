import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { join, resolve } from "node:path";

import { CliError, type Library, realLibrary } from "./library.js";
import { pageHtml } from "./page.js";
import { buildReview } from "./review.js";

/** The only address the studio ever listens on. */
export const LOOPBACK = "127.0.0.1";

export type StudioOptions = {
  env: Readonly<Record<string, string | undefined>>;
  cwd: string;
  /** Pins the work folder for this run (only a real `--work-folder`); leave unset to follow the saved setting. */
  workFolder?: string | undefined;
  /** A job file to open first (`--job`). */
  job?: string | undefined;
  /** 0 picks a free port. */
  port?: number;
  stdout?: (text: string) => void;
  /** Every error is logged here with its code. */
  stderr?: (text: string) => void;
  library?: Library;
};

export type StudioServer = {
  url: string;
  address: string;
  port: number;
  close(): Promise<void>;
};

const STATUS_BY_CODE: Record<string, number> = {
  "AS-STUDIO-4": 400,
  "AS-USAGE-1": 400,
  "AS-STUDIO-7": 403,
  "AS-STUDIO-8": 404,
  "AS-STUDIO-6": 409,
};

const TYPES: Record<string, string> = {
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  mp3: "audio/mpeg",
};

const MAX_BODY = 64 * 1024;
const STORE_FILE = /^([0-9a-f]{64})\.([a-z0-9]+)$/;
const STORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const studioError = (code: string, message: string) =>
  new CliError(code, message, 1);

type Handler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<void> | void;

const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
};

async function readBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) {
      throw studioError("AS-STUDIO-4", "The request body is too large.");
    }
    chunks.push(chunk as Buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw studioError("AS-STUDIO-4", "The request body is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw studioError("AS-STUDIO-4", "The request body is not a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function text(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value !== "string") {
    throw studioError("AS-STUDIO-4", `"${name}" must be text.`);
  }
  return value;
}

/** True when the store file exists and its bytes match its name. */
function requireHealthyFile(storeDir: string, file: string): Buffer {
  const match = STORE_FILE.exec(file);
  if (match === null) {
    throw studioError(
      "AS-STORE-1",
      `Index entry file "${file}" is not a store file name.`,
    );
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(storeDir, file));
  } catch (error) {
    throw studioError(
      "AS-STUDIO-3",
      `Store file ${file} cannot be read: ${(error as Error).message}`,
    );
  }
  if (createHash("sha256").update(bytes).digest("hex") !== match[1]) {
    throw studioError(
      "AS-STORE-1",
      `Store file ${file} exists but its content does not match its name.`,
    );
  }
  return bytes;
}

function sendMedia(
  req: IncomingMessage,
  res: ServerResponse,
  bytes: Buffer,
  ext: string,
): void {
  const headers = {
    "content-type": TYPES[ext] ?? "application/octet-stream",
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range === null) {
    res.writeHead(200, { ...headers, "content-length": bytes.length });
    res.end(bytes);
    return;
  }
  const start = range[1] === "" ? 0 : Number(range[1]);
  const end =
    range[2] === ""
      ? bytes.length - 1
      : Math.min(Number(range[2]), bytes.length - 1);
  if (start > end || start >= bytes.length) {
    res.writeHead(416, { "content-range": `bytes */${bytes.length}` });
    res.end();
    return;
  }
  res.writeHead(206, {
    ...headers,
    "content-range": `bytes ${start}-${end}/${bytes.length}`,
    "content-length": end - start + 1,
  });
  res.end(bytes.subarray(start, end + 1));
}

export async function startStudio(
  options: StudioOptions,
): Promise<StudioServer> {
  const lib = options.library ?? realLibrary;
  const stderr = options.stderr ?? ((t: string) => process.stderr.write(t));
  const log = (code: string, message: string) =>
    stderr(`${code}: ${message}\n`);

  const effectiveFolder = (): string =>
    lib.resolveWorkFolder(options.env, options.cwd, options.workFolder);

  const readJob = (jobPath: unknown) => {
    if (typeof jobPath !== "string" || jobPath.trim() === "") {
      throw studioError("AS-STUDIO-4", "A job file path is needed.");
    }
    const path = resolve(options.cwd, jobPath);
    return { path, job: lib.loadJob(path) };
  };

  const state: Handler = (_req, res) => {
    const saved = lib.savedWorkFolder(options.env);
    sendJson(res, 200, {
      workFolder: options.workFolder ?? saved ?? null,
      saved: saved ?? null,
      fromFlag: options.workFolder !== undefined,
      job: options.job ?? null,
    });
  };

  const config: Handler = async (req, res) => {
    const value = text(await readBody(req), "workFolder");
    if (value.trim() !== "") {
      // The library only resolves the path; the studio makes sure it is a folder.
      const absolute = resolve(options.cwd, value);
      let isDir = false;
      try {
        isDir = statSync(absolute).isDirectory();
      } catch (error) {
        throw studioError(
          "AS-STUDIO-2",
          `${absolute} cannot be used as the work folder: ${(error as Error).message}`,
        );
      }
      if (!isDir) {
        throw studioError(
          "AS-STUDIO-2",
          `${absolute} is not a folder, so it cannot be the work folder.`,
        );
      }
    }
    let saved: string;
    try {
      saved = lib.setWorkFolder(options.env, value, options.cwd);
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw studioError(
        "AS-STUDIO-10",
        `The setting could not be saved: ${(error as Error).message}`,
      );
    }
    sendJson(res, 200, { workFolder: saved });
  };

  const review: Handler = (_req, res, url) => {
    const folder = effectiveFolder();
    const { path, job } = readJob(url.searchParams.get("job"));
    sendJson(res, 200, buildReview(lib, folder, job, path));
  };

  const decide = async (
    req: IncomingMessage,
    res: ServerResponse,
    action: "approve" | "reject",
  ) => {
    const body = await readBody(req);
    const folder = effectiveFolder();
    const { job } = readJob(body.job);
    const key = text(body, "id");
    const file = body.file === null ? null : text(body, "file");
    const status = text(body, "status");
    const note = action === "reject" ? text(body, "note") : "";
    const paths = lib.workPaths(folder, job.story);
    const before = lib.readIndex(paths)[key];
    // What the person looked at must still be what is stored: a re-render, or
    // an earlier click since then, makes this review stale (D5).
    if (
      before !== undefined &&
      (before.file !== file || before.status !== status)
    ) {
      throw studioError(
        "AS-STUDIO-6",
        `"${key}" changed since you opened it (now ${before.status}, file ${before.file ?? "none"}). Nothing was saved; look at it again first.`,
      );
    }
    if (action === "approve" && before?.file != null) {
      requireHealthyFile(paths.store, before.file);
    }
    if (action === "approve") lib.approve(job, paths, key);
    else lib.reject(job, paths, key, note);
    const want = action === "approve" ? "final" : "rejected";
    const after = lib.readIndex(paths)[key];
    if (after === undefined || after.status !== want || after.file !== file) {
      throw studioError(
        "AS-STUDIO-6",
        `"${key}" changed while it was being saved; check it and try again.`,
      );
    }
    sendJson(res, 200, { ok: true, id: key, status: want });
  };

  const media: Handler = (req, res, url) => {
    const [, , story, file] = url.pathname.split("/");
    if (story === undefined || file === undefined || !STORY.test(story)) {
      throw studioError("AS-STUDIO-8", "No such media file.");
    }
    const paths = lib.workPaths(effectiveFolder(), story);
    const bytes = requireHealthyFile(paths.store, file);
    sendMedia(
      req,
      res,
      bytes,
      (STORE_FILE.exec(file) as RegExpExecArray)[2] ?? "",
    );
  };

  const clientError: Handler = async (req, res) => {
    const body = await readBody(req);
    // One log line, no control characters: the page's text must not forge log lines.
    const clean = (value: string) =>
      // biome-ignore lint/suspicious/noControlCharactersInRegex: this strips them
      value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").slice(0, 500);
    log(
      clean(text(body, "code")),
      `(shown in the page) ${clean(text(body, "message"))}`,
    );
    sendJson(res, 200, { ok: true });
  };

  let port = 0;
  const hostAllowed = (host: string | undefined): boolean =>
    host === `${LOOPBACK}:${port}` || host === `localhost:${port}`;

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    if (!hostAllowed(req.headers.host)) {
      throw studioError(
        "AS-STUDIO-7",
        `Host "${req.headers.host ?? ""}" is not allowed; the studio answers only on ${LOOPBACK}.`,
      );
    }
    const url = new URL(req.url ?? "/", `http://${LOOPBACK}:${port}`);
    const method = req.method ?? "GET";
    const where = `${method} ${url.pathname}`;
    if (method === "POST") {
      const origin = req.headers.origin;
      if (
        origin !== undefined &&
        !hostAllowed(origin.replace(/^http:\/\//, ""))
      ) {
        throw studioError("AS-STUDIO-7", `Origin "${origin}" is not allowed.`);
      }
      if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
        throw studioError(
          "AS-STUDIO-4",
          "POST needs content-type application/json.",
        );
      }
    }
    if (where === "GET /") {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(pageHtml);
    } else if (where === "GET /api/state") await state(req, res, url);
    else if (where === "POST /api/config") await config(req, res, url);
    else if (where === "GET /api/review") await review(req, res, url);
    else if (where === "POST /api/approve") await decide(req, res, "approve");
    else if (where === "POST /api/reject") await decide(req, res, "reject");
    else if (where === "POST /api/client-error")
      await clientError(req, res, url);
    else if (method === "GET" && url.pathname.startsWith("/media/")) {
      await media(req, res, url);
    } else throw studioError("AS-STUDIO-8", `No such page: ${where}`);
  };

  const server: Server = createServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      const known = error instanceof CliError;
      const code = known ? error.code : "AS-INTERNAL-1";
      const message = (error as Error).message;
      log(code, message);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, known ? (STATUS_BY_CODE[code] ?? 422) : 500, {
        error: { code, message, lines: known ? [...error.extraLines] : [] },
      });
    });
  });

  await new Promise<void>((done, fail) => {
    server.once("error", (error) => {
      fail(
        studioError(
          "AS-STUDIO-9",
          `The studio could not listen on ${LOOPBACK}:${options.port ?? 0}: ${error.message}`,
        ),
      );
    });
    server.listen(options.port ?? 0, LOOPBACK, () => done());
  });
  const bound = server.address();
  if (bound === null || typeof bound === "string") {
    server.close();
    throw studioError("AS-STUDIO-9", "The studio has no network address.");
  }
  port = bound.port;
  // A later socket error must not vanish.
  server.on("error", (error) => log("AS-STUDIO-9", error.message));
  return {
    url: `http://${LOOPBACK}:${port}/`,
    address: bound.address,
    port,
    close: () =>
      new Promise<void>((done, fail) => {
        server.close((error) => (error ? fail(error) : done()));
        server.closeAllConnections();
      }),
  };
}

/** Run until SIGINT/SIGTERM (or `signal`), as `asset-studio studio` does. */
export async function runStudio(
  options: StudioOptions & { signal?: AbortSignal },
): Promise<void> {
  const studio = await startStudio(options);
  const stdout = options.stdout ?? ((t: string) => process.stdout.write(t));
  stdout(
    `Studio listening on ${studio.url} (127.0.0.1 only). Press Ctrl+C to stop.\n`,
  );
  await new Promise<void>((done) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      done();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    options.signal?.addEventListener("abort", stop, { once: true });
  });
  await studio.close();
}
