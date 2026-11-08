import {
  type AvatarManifest,
  avatarManifestSchema,
} from "@asset-studio/formats";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { TalkingAvatar } from "../src/index.js";

const BASE_URL = "/keeper/";

function App() {
  const [manifest, setManifest] = useState<AvatarManifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [playAll, setPlayAll] = useState(false);
  const [ended, setEnded] = useState<string[]>([]);

  useEffect(() => {
    fetch(`${BASE_URL}manifest.json`)
      .then((response) => response.json())
      .then((json) => setManifest(avatarManifestSchema.parse(json)))
      .catch((caught: Error) => setError(caught.message));
  }, []);

  if (error !== null) return <p role="alert">{error}</p>;
  if (manifest === null) return <p>Loading…</p>;
  const line = manifest.lines[index] ?? manifest.lines[0];
  if (line === undefined) return <p>No lines.</p>;

  // A new key gives a fresh player, so the tap that picked a line starts it.
  const pick = (next: number, all: boolean) => {
    setIndex(next);
    setPlayAll(all);
    setEnded([]);
    setRun((value) => value + 1);
  };

  return (
    <>
      <h1>{manifest.name}</h1>
      <TalkingAvatar
        key={run}
        className="avatar"
        manifest={manifest}
        lineId={line.line_id}
        baseUrl={BASE_URL}
        onEnd={() => {
          setEnded((list) => [...list, line.line_id]);
          if (playAll && index + 1 < manifest.lines.length) setIndex(index + 1);
        }}
        onError={(caught) => setError(caught.message)}
      />
      <div className="controls">
        {manifest.lines.map((entry, i) => (
          <button
            key={entry.line_id}
            type="button"
            onClick={() => pick(i, false)}
          >
            Line {i + 1}
          </button>
        ))}
        <button type="button" onClick={() => pick(0, true)}>
          Play all
        </button>
      </div>
      <p data-testid="ended">Ended: {ended.join(", ") || "none"}</p>
    </>
  );
}

const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
