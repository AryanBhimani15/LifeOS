import { aiUnavailable } from "@/lib/errors";

/**
 * LLM provider abstraction.
 *
 * Everything above this file works against `AiProvider`, never against a vendor
 * SDK. Two reasons:
 *
 *  1. CI must not make network calls. Tests inject `FakeProvider` and exercise
 *     the entire parse → validate → resolve → confirm → execute chain against
 *     fixtures, so the security-relevant logic is tested deterministically.
 *  2. LifeOS is wired to Gemini because that is the key available in this
 *     environment. Swapping providers should be one file, not a refactor.
 *
 * The provider returns TEXT. It is never trusted: the caller parses it as JSON
 * and validates it against a Zod action schema before anything else happens.
 */

export interface AiRequest {
  system: string;
  user: string;
  /** Nudges the model toward JSON. Validation, not this flag, is the guarantee. */
  json?: boolean;
  maxOutputTokens?: number;
}

export interface AiResponse {
  text: string;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(request: AiRequest): Promise<AiResponse>;
}

/**
 * Gemini 3.x is served only on v1alpha; v1beta returns 404 for these models.
 * Free-tier keys report `limit: 0` for every Pro model, so the default is Flash.
 */
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1alpha/models/${model}:generateContent`;

export class GeminiProvider implements AiProvider {
  readonly name = "gemini";

  constructor(
    private readonly apiKey: string,
    private readonly model = process.env.AI_MODEL || "gemini-3.6-flash",
  ) {}

  async complete(request: AiRequest): Promise<AiResponse> {
    let response: Response;
    try {
      response = await fetch(`${ENDPOINT(this.model)}?key=${encodeURIComponent(this.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.user }] }],
          generationConfig: {
            temperature: 0.1, // Command parsing wants determinism, not creativity.
            maxOutputTokens: request.maxOutputTokens ?? 4096,
            ...(request.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      // Network failures must not leak the URL — it carries the API key.
      throw aiUnavailable(
        error instanceof Error && error.name === "TimeoutError"
          ? "The AI service timed out. Please try again."
          : "Could not reach the AI service.",
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // Logged server-side only; the client gets a generic message.
      console.error("[ai] gemini request failed", {
        status: response.status,
        detail: detail.slice(0, 500).replace(this.apiKey, "[redacted]"),
      });
      throw aiUnavailable(
        response.status === 429
          ? "The AI service is rate limited right now. Please try again in a minute."
          : "The AI service returned an error.",
      );
    }

    const payload = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text)
      .filter(Boolean)
      .join("");

    if (!text.trim()) {
      throw aiUnavailable("The AI service returned an empty response.");
    }

    return {
      text,
      model: this.model,
      promptTokens: payload.usageMetadata?.promptTokenCount,
      outputTokens: payload.usageMetadata?.candidatesTokenCount,
    };
  }
}

/** Deterministic provider for tests. Queue responses; each call shifts one off. */
export class FakeProvider implements AiProvider {
  readonly name = "fake";
  readonly calls: AiRequest[] = [];

  constructor(private readonly queue: (string | Error)[] = []) {}

  push(response: string | Error) {
    this.queue.push(response);
  }

  async complete(request: AiRequest): Promise<AiResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (next === undefined) throw new Error("FakeProvider: no queued response");
    if (next instanceof Error) throw next;
    return { text: next, model: "fake-model" };
  }
}

export function createProvider(): AiProvider {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw aiUnavailable("AI features are not configured. Set GEMINI_API_KEY — see docs/development.md.");
  }
  return new GeminiProvider(key);
}
