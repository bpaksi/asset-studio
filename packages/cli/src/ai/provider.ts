import type { Dimensions } from "../picture/images.js";

/** An image the job names (a style or cast reference), already read from disk. */
export type ImageInput = {
  /** The path as written in the job. */
  name: string;
  bytes: Uint8Array;
};

/** What the provider is asked to make. */
export type ImageRequest = {
  /** `picture` is a painting or other art, `still` a cast mood still, `mask` a glow mask. */
  kind: "picture" | "still" | "mask";
  /** The job's asset ID (not the per-profile key). */
  id: string;
  /** The job's prompt for this asset, if it has one. */
  prompt?: string;
  /** The job's `style.picture` text. */
  style?: string;
  /** Style references first, then (for a still) the cast member's references. */
  references: ImageInput[];
  /** Cast member name and mood, for a still. */
  subject?: { name: string; mood: string };
  /** Redo notes for this ID only. */
  notes: string[];
  /** The size to make. For a mask: the painting's exact size. */
  size: Dimensions;
  /** For a mask: the painting it lights. */
  painting?: Uint8Array;
};

export interface ImageProvider {
  /** The provider's id, part of the inputs hash. */
  id: string;
  /** The model behind it, part of the inputs hash. */
  model?: string;
  generate(request: ImageRequest): Promise<{
    image: Uint8Array;
    mimeType?: string;
  }>;
}
