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
  /** Of the prompt tokens, how many were read from the provider's cache. */
  cachedTokens: number | null;
  /** Of the completion tokens, how many were hidden reasoning. */
  reasoningTokens: number | null;
  /** US dollars, as OpenRouter reports it; null if it didn't. */
  costUsd: number | null;
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Under the page's maxDuration, so a slow model fails here with a sentence.
 * Background jobs pass a longer one — see src/lib/ai/jobs.ts.
 */
const TIMEOUT_MS = 55_000;

export function openRouterConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Messages as sent. For Anthropic models the system prompt is marked
 * cacheable: it is identical on every call and is most of the input, and
 * Claude only caches what a request marks (OpenAI and DeepSeek cache a
 * repeated prefix by themselves). A cached read costs a tenth of input.
 */
function wire(model: string, messages: ChatMessage[]) {
  if (!model.startsWith("anthropic/")) return messages;
  return messages.map((m) =>
    m.role === "system"
      ? {
          role: m.role,
          content: [{ type: "text", text: m.content, cache_control: { type: "ephemeral" } }],
        }
      : m,
  );
}

export async function completeJson(options: {
  model: string;
  messages: ChatMessage[];
  schemaName: string;
  schema: Record<string, unknown>;
  /** The `reasoning` field, already fitted to this model — see models.ts. */
  reasoning?: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<Completion> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
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
        messages: wire(options.model, options.messages),
        response_format: {
          type: "json_schema",
          json_schema: { name: options.schemaName, strict: true, schema: options.schema },
        },
        // Only providers that honour every parameter sent. Which is why there
        // is no `temperature` here: Claude 5.5 and GPT-6 don't accept it, and
        // with this flag set its presence made those requests fail outright.
        provider: { require_parameters: true },
        // Asks OpenRouter to include what the call cost, which the
        // generation log averages per model.
        usage: { include: true },
        ...(options.reasoning ? { reasoning: options.reasoning } : {}),
        // Room for reasoning as well as the answer: on a model that must
        // reason, its thinking counts against this too.
        max_tokens: 16000,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`The model took longer than ${timeoutMs / 1000}s. Try again, or a faster model.`);
    }
    throw new Error("Couldn't reach OpenRouter.");
  }

  const payload = (await response.json().catch(() => null)) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
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
    cachedTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? null,
    reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    costUsd: typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
  };
}

/**
 * A plain-text completion, for answers rather than documents — the builder's
 * follow-up questions. Same model, routing and reasoning handling as
 * completeJson(), without a response schema.
 */
export async function completeText(options: {
  model: string;
  messages: ChatMessage[];
  reasoning?: Record<string, unknown>;
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
        "X-Title": "Trueward Guru",
      },
      body: JSON.stringify({
        model: options.model,
        messages: wire(options.model, options.messages),
        provider: { require_parameters: true },
        usage: { include: true },
        ...(options.reasoning ? { reasoning: options.reasoning } : {}),
        max_tokens: 4000,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(`The model took longer than ${TIMEOUT_MS / 1000}s. Try again.`);
    }
    throw new Error("Couldn't reach OpenRouter.");
  }

  const payload = (await response.json().catch(() => null)) as {
    model?: string;
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
      completion_tokens_details?: { reasoning_tokens?: number };
    };
    error?: { message?: string };
  } | null;

  if (!response.ok || !payload || payload.error) {
    throw new Error(`OpenRouter refused the request: ${payload?.error?.message ?? `HTTP ${response.status}`}`);
  }
  const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("The model returned nothing.");

  return {
    content,
    model: payload.model ?? options.model,
    promptTokens: payload.usage?.prompt_tokens ?? null,
    completionTokens: payload.usage?.completion_tokens ?? null,
    cachedTokens: payload.usage?.prompt_tokens_details?.cached_tokens ?? null,
    reasoningTokens: payload.usage?.completion_tokens_details?.reasoning_tokens ?? null,
    costUsd: typeof payload.usage?.cost === "number" ? payload.usage.cost : null,
  };
}
