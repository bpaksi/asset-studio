"use client";

import {
  type AvatarManifest,
  effectiveMouthMode,
  type RhubarbLetter,
  rhubarbJsonSchema,
} from "@asset-studio/formats";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { assetUrl, captionFor, mouthFiles } from "./assets.js";
import { createMouthClock, type MouthCue, REST_LETTER } from "./cues.js";

export type TalkingAvatarProps = {
  /** A parsed `manifest.json` (asset contract v2). */
  manifest: AvatarManifest;
  /** The line to play; changing it plays the next line on the same audio element. */
  lineId: string;
  /** URL of the character folder, e.g. `/avatars/keeper/`. Manifest paths resolve against it. */
  baseUrl: string;
  /** Called once when the line's audio ends. */
  onEnd?: () => void;
  /** Called when the line, its timing or its audio cannot be used. The caption still shows. */
  onError?: (error: Error) => void;
  /** Start the line as soon as it is set (default `true`). If the browser blocks it, a play button asks for a tap. */
  autoPlay?: boolean;
  className?: string;
  style?: CSSProperties;
};

// Layout effects run inside the click that changed the line, which keeps
// play() within the user gesture iOS Safari asks for. No-op on the server.
const useGestureEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

type Timing = MouthCue[] | Error;

// Shared by every player on the page, so a remount or a second avatar reuses
// timing already loaded instead of fetching it as playback starts. Failures
// are not kept; the next mount tries again.
const loadedTimings = new Map<string, MouthCue[]>();
const pendingTimings = new Map<string, Promise<MouthCue[]>>();

function loadTiming(url: string): Promise<MouthCue[]> {
  let pending = pendingTimings.get(url);
  if (pending === undefined) {
    pending = fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const cues = rhubarbJsonSchema.parse(await response.json()).mouthCues;
        loadedTimings.set(url, cues);
        return cues;
      })
      .finally(() => pendingTimings.delete(url));
    pendingTimings.set(url, pending);
  }
  return pending;
}

function cachedTimings(
  manifest: AvatarManifest,
  baseUrl: string,
): Map<string, Timing> {
  const timings = new Map<string, Timing>();
  for (const line of manifest.lines) {
    const cues = loadedTimings.get(assetUrl(baseUrl, line.timing));
    if (cues !== undefined) timings.set(line.line_id, cues);
  }
  return timings;
}

function useTimings(
  manifest: AvatarManifest,
  baseUrl: string,
): ReadonlyMap<string, Timing> {
  const [timings, setTimings] = useState<ReadonlyMap<string, Timing>>(() =>
    cachedTimings(manifest, baseUrl),
  );
  useEffect(() => {
    // Every line's timing loads up front, so playback never waits on the
    // network beyond the audio.
    let cancelled = false;
    setTimings(cachedTimings(manifest, baseUrl));
    for (const line of manifest.lines) {
      const url = assetUrl(baseUrl, line.timing);
      if (loadedTimings.has(url)) continue;
      loadTiming(url)
        .catch(
          (error: unknown) =>
            new Error(
              `timing for ${line.line_id} could not be loaded: ${(error as Error).message}`,
            ),
        )
        .then((timing) => {
          if (cancelled) return;
          setTimings((previous) => new Map(previous).set(line.line_id, timing));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [manifest, baseUrl]);
  return timings;
}

export function TalkingAvatar({
  manifest,
  lineId,
  baseUrl,
  onEnd,
  onError,
  autoPlay = true,
  className,
  style,
}: TalkingAvatarProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [letter, setLetter] = useState<RhubarbLetter>(REST_LETTER);
  const [needsTap, setNeedsTap] = useState(false);
  const timings = useTimings(manifest, baseUrl);

  const line = manifest.lines.find((entry) => entry.line_id === lineId);
  const timing = timings.get(lineId);
  const mode = effectiveMouthMode(manifest);
  const frames = useMemo(() => mouthFiles(manifest.mouths), [manifest.mouths]);

  const cuesRef = useRef<readonly MouthCue[]>([]);
  cuesRef.current = Array.isArray(timing) ? timing : [];
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (line === undefined) {
      onErrorRef.current?.(
        new Error(`line_id "${lineId}" is not in manifest "${manifest.id}"`),
      );
    } else if (timing instanceof Error) {
      onErrorRef.current?.(timing);
    }
  }, [line, lineId, manifest.id, timing]);

  useEffect(() => {
    if (mode !== "frame") {
      onErrorRef.current?.(
        new Error(
          `mouthMode "${mode}" is not supported by this player yet; showing the portrait only`,
        ),
      );
    }
  }, [mode]);

  // The audio element is the clock.
  useEffect(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    const clock = createMouthClock({
      audio,
      cues: () => cuesRef.current,
      onLetter: setLetter,
      scheduler: {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (id) => cancelAnimationFrame(id),
      },
    });
    const onPlaying = () => clock.start();
    const onSample = () => clock.sample();
    const onEnded = () => {
      clock.stop();
      clock.sample();
      onEndRef.current?.();
    };
    const onAudioError = () => {
      clock.stop();
      setLetter(REST_LETTER);
      onErrorRef.current?.(
        new Error(`audio could not be played: ${audio.currentSrc}`),
      );
    };
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onSample);
    audio.addEventListener("seeked", onSample);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onAudioError);
    return () => {
      clock.stop();
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onSample);
      audio.removeEventListener("seeked", onSample);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onAudioError);
    };
  }, []);

  const play = useCallback(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    setNeedsTap(false);
    audio.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        setNeedsTap(true);
      } else if (
        !(error instanceof DOMException && error.name === "AbortError")
      ) {
        onErrorRef.current?.(error as Error);
      }
    });
  }, []);

  // A new line (audioPath) starts from REST and plays on the same element.
  const audioPath = line?.audio;
  useGestureEffect(() => {
    setLetter(REST_LETTER);
    if (audioPath !== undefined && autoPlay) play();
  }, [audioPath, autoPlay, play]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const shownFrame = mode === "frame" ? manifest.mouths[letter] : undefined;
  const fill: CSSProperties = {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
  };

  return (
    <figure
      className={className}
      style={{ margin: 0, ...style }}
      data-talking-avatar={manifest.id}
      data-letter={letter}
    >
      <div style={{ position: "relative" }}>
        <img
          src={assetUrl(baseUrl, manifest.portrait)}
          alt={manifest.name}
          style={{ display: "block", width: "100%", height: "auto" }}
        />
        {mode === "frame" &&
          frames.map((path) => (
            // All frames stay mounted (preloaded); a swap only flips visibility.
            <img
              key={path}
              src={assetUrl(baseUrl, path)}
              alt=""
              aria-hidden="true"
              draggable={false}
              style={{
                ...fill,
                visibility: path === shownFrame ? "visible" : "hidden",
              }}
            />
          ))}
        {needsTap && (
          <button
            type="button"
            onClick={play}
            aria-label={`Play ${manifest.name}`}
            style={{
              ...fill,
              border: 0,
              background: "rgba(0, 0, 0, 0.35)",
              color: "white",
              font: "inherit",
              fontSize: "1.25em",
              cursor: "pointer",
            }}
          >
            ▶ Tap to play
          </button>
        )}
      </div>
      {line !== undefined && (
        <figcaption aria-live="polite">{captionFor(line.text)}</figcaption>
      )}
      {/* biome-ignore lint/a11y/useMediaCaption: the line text is shown as the figcaption above */}
      <audio
        ref={audioRef}
        src={audioPath === undefined ? undefined : assetUrl(baseUrl, audioPath)}
        preload="auto"
      />
    </figure>
  );
}
