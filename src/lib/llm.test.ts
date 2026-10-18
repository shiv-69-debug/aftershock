import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { requestModel } from "./llm";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("GROQ_API_KEY", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("waits for a short Retry-After once, then returns the successful response", async () => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const provider = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json(
        { error: { code: "rate_limit_exceeded" } },
        { status: 429, headers: { "Retry-After": "1" } },
      ),
    )
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", provider);
  const onRetry = vi.fn();
  const result = requestModel({}, { onRetry });
  await vi.advanceTimersByTimeAsync(1100);
  await expect(result).resolves.toEqual({ ok: true });
  expect(provider).toHaveBeenCalledTimes(2);
  expect(onRetry).toHaveBeenCalledWith(1);
});

it("does not sleep through a long limit and returns a usable retry time", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const provider = vi.fn(async () =>
    Response.json(
      { error: { message: "Please try again in 1m12.5s." } },
      { status: 429 },
    ),
  );
  vi.stubGlobal("fetch", provider);
  await expect(requestModel({})).rejects.toMatchObject({
    retryAfterSeconds: 73,
  });
  expect(provider).toHaveBeenCalledTimes(1);
});

it("does not retry an exhausted quota even if a short wait header is present", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const provider = vi.fn(async () =>
    Response.json(
      { error: { code: "insufficient_quota" } },
      { status: 429, headers: { "Retry-After": "1" } },
    ),
  );
  vi.stubGlobal("fetch", provider);
  await expect(requestModel({})).rejects.toMatchObject({
    retryAfterSeconds: null,
  });
  expect(provider).toHaveBeenCalledTimes(1);
});

it("never loops when the provider keeps returning a rate limit", async () => {
  vi.useFakeTimers();
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  const provider = vi.fn(async () =>
    Response.json(
      { error: { code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": "1" } },
    ),
  );
  vi.stubGlobal("fetch", provider);
  const failure = requestModel({}).catch((error) => error);
  await vi.advanceTimersByTimeAsync(1100);
  expect(await failure).toMatchObject({ retryAfterSeconds: 1 });
  expect(provider).toHaveBeenCalledTimes(2);
});

it("uses Groq credentials and adapts structured output and tool schemas", async () => {
  vi.stubEnv("AI_PROVIDER", "groq");
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubEnv("GROQ_MODEL", "openai/gpt-oss-120b");
  const provider = vi.fn(async () => Response.json({ choices: [] }));
  vi.stubGlobal("fetch", provider);
  await requestModel({
    messages: [{ role: "user", content: "Explain this incident" }],
    response_format: {
      type: "json_schema",
      json_schema: { name: "answer", schema: { type: "object" } },
    },
    tools: [
      {
        type: "function",
        function: {
          name: "inspect_deployment",
          strict: true,
          parameters: { type: "object", properties: {} },
        },
      },
    ],
  });
  const [url, options] = provider.mock.calls[0] as unknown as [
    string,
    RequestInit,
  ];
  expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
  const body = JSON.parse(String(options.body));
  expect(body.model).toBe("openai/gpt-oss-120b");
  expect(body.response_format).toEqual({ type: "json_object" });
  expect(body.tools[0].function.strict).toBeUndefined();
  expect(body.messages.at(-1).content).toContain("Return only a JSON object");
});

it("reports missing configuration without making a provider call", async () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  const provider = vi.fn();
  vi.stubGlobal("fetch", provider);
  await expect(requestModel({})).rejects.toThrow(
    "Add OPENAI_API_KEY to .env.local",
  );
  expect(provider).not.toHaveBeenCalled();
});

it.each([
  [401, "rejected the API key"],
  [429, "rate or quota limit"],
  [404, "cannot access the configured model"],
])(
  "explains provider status %s without exposing provider details",
  async (status, message) => {
    vi.stubEnv("OPENAI_API_KEY", "test-only-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("sensitive provider details", {
            status: Number(status),
          }),
      ),
    );
    await expect(requestModel({})).rejects.toThrow(String(message));
  },
);

it("distinguishes provider network failure from a stopped local server", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-only-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("fetch failed");
    }),
  );
  await expect(requestModel({})).rejects.toThrow("OpenAI could not be reached");
});
