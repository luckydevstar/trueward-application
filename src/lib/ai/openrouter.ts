import "server-only";

/**
 * A chat completion through OpenRouter, asking for JSON that matches a schema.
 *
 * OpenRouter rather than one provider's SDK, so the model is a setting: the
 * resume builder is meant to be benchmarked across models for cost and
 * quality, and switching should be a string, not a dependency.
 *
 * Structured output is requested strictly, with `require_parameters` so
 * OpenRouter only routes to providers that honour it — a provider that
 * ignored the schema would hand back prose, and the request would look like
 * it worked. The result is still validated by the caller; the schema narrows
 * what can come back, it does not replace checking it.
 */

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type Completion = {
  content: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  /** US dollars, as OpenRouter reports it; null if it didn't. */
  costUsd: number | null;
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Under the page's maxDuration, so a slow model fails here with a sentence. */
const TIMEOUT_MS = 55_000;

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export async function completeJson(options: {
  model: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
}): Promise<Completion> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set, so generation is off.");

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        // Optional attribution OpenRouter shows on its dashboard.
        "X-Title": "Trueward Guru",
        ...(process.env.NEXT_PUBLIC_SITE_URL
          ? { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL }
          : {}),
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        response_format: {
          type: "json_schema",
          json_schema: { name: options.schemaName, strict: true, schema: options.schema },
        },
        provider: { require_parameters: true },
        // Asks OpenRouter to include what the call cost, which the
        // generation log averages per model.
        usage: { include: true },
        temperature: 0.4,
        max_tokens: 6000,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`The model took longer than ${TIMEOUT_MS / 1000}s. Try again, or a faster model.`);
    }
    throw new Error("Couldn't reach OpenRouter.");
  }

  const payload = (await response.json().catch(() => null)) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string; code?: number | string };
  } | null;

  if (!response.ok || !payload || payload.error) {
    const detail = payload?.error?.message ?? `HTTP ${response.status}`;
    throw new Error(`OpenRouter refused the request: ${detail}`);
  }

  const choice = payload.choices?.[0];
  const content = choice?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error(
      choice?.finish_reason === "length"
        ? "The model ran out of room before finishing. Try a shorter job description."
        : "The model returned nothing.",
    );
  }

  return {
    content,
    model: payload.model ?? options.model,
    promptTokens: payload.usage?.prompt_tokens ?? null,
    completionTokens: payload.usage?.completion_tokens ?? null,
    costUsd: typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
  };
}
