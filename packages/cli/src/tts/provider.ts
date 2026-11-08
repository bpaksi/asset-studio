/**
 * A text-to-speech provider. `synthesize` is called once per spoken segment;
 * `style` is its own field and is never part of `text`. There is no failover:
 * a failure fails the line (caption-only), it never tries another provider.
 */
export interface TtsProvider {
  /** The id a job's `voice.provider` names, e.g. `gemini-tts`. */
  id: string;
  /** Known voice ids. Omit to accept any voice id. */
  voices?: readonly string[];
  synthesize(req: { text: string; voiceId: string; style?: string }): Promise<{
    audio: Uint8Array;
    /** WAV PCM, or Ogg Vorbis. Only `wav` can be spliced in 0.2. */
    format: "wav" | "ogg";
    sampleRate: number;
    channels: number;
  }>;
}

/**
 * Builds providers by id for one run. `create` throws a CliError (for example
 * AS-VOICE-1 for a missing key) when the provider cannot be used.
 */
export type TtsProviderRegistry = {
  has(id: string): boolean;
  create(
    id: string,
    env: Readonly<Record<string, string | undefined>>,
  ): TtsProvider;
};

export function providerRegistry(
  factories: Record<
    string,
    (env: Readonly<Record<string, string | undefined>>) => TtsProvider
  >,
): TtsProviderRegistry {
  return {
    has: (id) => Object.hasOwn(factories, id),
    create(id, env) {
      const factory = factories[id];
      if (factory === undefined) throw new Error(`unknown provider ${id}`);
      return factory(env);
    },
  };
}
