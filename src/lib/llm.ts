export class ModelError extends Error {}

export class ModelRateLimitError extends ModelError {
  constructor(
    message: string,
    public readonly retryAfterSeconds: number | null,
  ) {
    super(message);
  }
}

function retryDelay(response: Response, message: string): number | null {
  const header = response.headers.get("retry-after");
  if (header) {
    const numeric = Number(header);
    const seconds = Number.isFinite(numeric)
      ? numeric
      : (Date.parse(header) - Date.now()) / 1000;
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  }
  // Groq sometimes provides the wait only in its error message (e.g. 1m12.5s).
  const duration = /try again in\s+((?:\d+(?:\.\d+)?(?:ms|[hms])\s*)+)/i.exec(
    message,
  )?.[1];
  if (!duration) return null;
  let seconds = 0;
  for (const part of duration.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g))
    seconds +=
      Number(part[1]) * ({ ms: 0.001, h: 3600, m: 60, s: 1 }[part[2]] || 0);
  return seconds > 0 ? Math.ceil(seconds) : null;
}

export function modelConfiguration() {
  const groq =
    process.env.AI_PROVIDER === "groq" ||
    (!process.env.AI_PROVIDER && Boolean(process.env.GROQ_API_KEY));
  return {
    provider: groq ? "Groq" : "OpenAI",
    configured: Boolean(
      (groq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY)?.trim(),
    ),
    keyVariable: groq ? "GROQ_API_KEY" : "OPENAI_API_KEY",
    model: groq
      ? process.env.GROQ_MODEL || "openai/gpt-oss-120b"
      : process.env.OPENAI_MODEL || "gpt-4.1-mini",
    url: groq
      ? "https://api.groq.com/openai/v1/chat/completions"
      : "https://api.openai.com/v1/chat/completions",
  };
}

/** Centralizes provider failures without exposing credentials or raw provider payloads. */
export async function requestModel(
  body: Record<string, unknown>,
  options: { onRetry?: (seconds: number) => void } = {},
): Promise<unknown> {
  const config = modelConfiguration();
  if (!config.configured) {
    throw new ModelError(
      `${config.provider} is not connected. Add ${config.keyVariable} to .env.local and restart the app to enable conversational answers.`,
    );
  }
  let response: Response;
  const payload = { ...body };
  if (config.provider === "Groq") {
    // Llama supports JSON mode; enforce our schema locally after parsing.
    if (payload.response_format) {
      const schema = payload.response_format;
      payload.response_format = { type: "json_object" };
      payload.messages = [
        ...((payload.messages as Record<string, unknown>[]) || []),
        {
          role: "system",
          content: `Return only a JSON object conforming to this schema: ${JSON.stringify(schema)}`,
        },
      ];
    }
    if (Array.isArray(payload.tools)) {
      payload.tools = payload.tools.map((tool) => {
        const definition = tool as { function: Record<string, unknown> };
        const { strict: _strict, ...fn } = definition.function;
        return { ...definition, function: fn };
      });
    }
  }
  for (let attempt = 0; ; attempt++) {
    try {
      response = await fetch(config.url, {
        method: "POST",
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env[config.keyVariable]?.trim()}`,
        },
        body: JSON.stringify({
          model: config.model,
          ...(config.provider === "Groq" &&
          config.model.startsWith("openai/gpt-oss")
            ? { reasoning_effort: "low" }
            : {}),
          ...payload,
        }),
      });
    } catch {
      throw new ModelError(
        `${config.provider} could not be reached. Check the internet connection and retry; the request may have timed out.`,
      );
    }
    if (response.status === 429) {
      const data = await response.json().catch(() => null);
      const quota = [
        "insufficient_quota",
        "billing_hard_limit_reached",
      ].includes(data?.error?.code);
      const seconds = quota
        ? null
        : retryDelay(response, String(data?.error?.message || ""));
      if (attempt === 0 && seconds !== null && seconds <= 8) {
        options.onRetry?.(seconds);
        await new Promise((resolve) =>
          setTimeout(resolve, seconds * 1000 + 100),
        );
        continue;
      }
      throw new ModelRateLimitError(
        seconds !== null
          ? `${config.provider} is temporarily rate limited. Try again in ${seconds} seconds; your question has been kept.`
          : `${config.provider} reported a rate or quota limit without a retry time. Wait for the provider limit to reset or check your account's usage allowance.`,
        seconds,
      );
    }
    if (!response.ok) {
      const message =
        response.status === 401
          ? `${config.provider} rejected the API key. Check ${config.keyVariable} in .env.local and restart the app.`
          : response.status === 429
            ? `${config.provider} reported a rate or quota limit. Check the API project's billing and usage limits, then retry.`
            : response.status === 403 || response.status === 404
              ? `This ${config.provider} project cannot access the configured model. Check the model name and API permissions.`
              : `${config.provider} request failed (${response.status}). Retry or check the configured model's API compatibility.`;
      throw new ModelError(message);
    }
    return response.json();
  }
}
