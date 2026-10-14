import "server-only";

/**
 * What OpenRouter says about each model: price, and what it accepts.
 *
 * Needed for more than display. Requests go out with
 * `provider.require_parameters`, so a parameter a model doesn't support makes
 * OpenRouter find no endpoint and the call fail outright — which is how
 * sending `temperature` broke every Claude 5.5 and GPT-6 request. And
 * reasoning differs per model: mandatory on some, optional on others, with
 * different effort names, so "as little as possible" has to be worked out
 * per model rather than sent as one value.
 *
 * Fetched from the public list and cached for an hour; prices and support
 * change, but not by the minute. Allowed to fail: callers then send the
 * minimum and let OpenRouter decide.
 */

export type ModelInfo = {
  id: string;
  /** Dollars per million tokens. */
  price: { input: number; output: number; cacheRead: number; cacheWrite: number };
  structured: boolean;
  supportsReasoning: boolean;
  reasoningMandatory: boolean;
  /** Effort names the model accepts, e.g. ["low", "medium", "high"]. */
  efforts: string[];
  defaultEffort: string | null;
};

type Raw = {
  id: string;
  supported_parameters?: string[];
  pricing?: Record<string, string | undefined>;
  reasoning?: { mandatory?: boolean; supported_efforts?: string[]; default_effort?: string };
};

const perMillion = (value: string | undefined) => Number(value ?? 0) * 1e6;

export async function modelCatalog(): Promise<Map<string, ModelInfo>> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return new Map();
    const { data } = (await response.json()) as { data: Raw[] };
    return new Map(
      data
        .filter((m) => !m.id.endsWith(":batch"))
        .map((m) => {
          const params = new Set(m.supported_parameters ?? []);
          return [
            m.id,
            {
              id: m.id,
              price: {
                input: perMillion(m.pricing?.prompt),
                output: perMillion(m.pricing?.completion),
                cacheRead: perMillion(m.pricing?.input_cache_read),
                cacheWrite: perMillion(m.pricing?.input_cache_write),
              },
              structured: params.has("structured_outputs"),
              supportsReasoning: params.has("reasoning"),
              reasoningMandatory: Boolean(m.reasoning?.mandatory),
              efforts: m.reasoning?.supported_efforts ?? [],
              defaultEffort: m.reasoning?.default_effort ?? null,
            } satisfies ModelInfo,
          ] as const;
        }),
    );
  } catch {
    return new Map();
  }
}

/** Cheapest first, so "the lowest" is the first one present. */
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

/**
 * The `reasoning` request field for a setting, or undefined to send none.
 *
 *   default  — leave it to the model
 *   lowest   — off where the model allows, else its cheapest effort
 *   an effort — that effort if offered, else the nearest the model has
 */
export function reasoningParam(
  setting: string,
  model: ModelInfo | undefined,
): Record<string, unknown> | undefined {
  if (setting === "default" || !model?.supportsReasoning) return undefined;

  const offered = EFFORT_ORDER.filter((e) => model.efforts.includes(e));

  if (setting === "lowest") {
    if (offered.includes("none")) return { effort: "none", exclude: true };
    if (!model.reasoningMandatory) return { enabled: false };
    return offered.length ? { effort: offered[0], exclude: true } : undefined;
  }

  if (offered.includes(setting)) return { effort: setting, exclude: true };
  // Nearest offered effort to the one asked for.
  const want = EFFORT_ORDER.indexOf(setting);
  const nearest = offered.sort(
    (a, b) => Math.abs(EFFORT_ORDER.indexOf(a) - want) - Math.abs(EFFORT_ORDER.indexOf(b) - want),
  )[0];
  return nearest ? { effort: nearest, exclude: true } : undefined;
}
