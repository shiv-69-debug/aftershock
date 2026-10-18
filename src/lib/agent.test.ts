import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { toolOrder, tools } from "./queries";
import {
  verifiedDeployment,
  verifiedConstraint,
} from "../../tests/fixtures/evidence";

const graph = vi.hoisted(() => ({
  query: vi.fn(),
  saveInvestigation: vi.fn(),
}));
vi.mock("./graph", () => ({ ...graph, readQuery: graph.query }));
import { investigate } from "./agent";

beforeEach(() => {
  vi.stubEnv("AI_PROVIDER", "openai");
  vi.stubEnv("OPENAI_API_KEY", "test-only-key");
  graph.query.mockImplementation(async (cypher: string) => {
    if (cypher.includes("d.revision AS revision")) return [{ revision: 7 }];
    if (cypher === tools.inspect_deployment.query)
      return [{ ...verifiedDeployment }];
    if (cypher === tools.check_constraints.query)
      return [{ ...verifiedConstraint }];
    return [];
  });
  graph.saveInvestigation.mockResolvedValue(undefined);
});

it("completes required graph checks when Groq finishes selecting tools early", async () => {
  vi.stubEnv("AI_PROVIDER", "groq");
  vi.stubEnv("GROQ_API_KEY", "test-groq-key");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        choices: [
          { message: { role: "assistant", content: "I have enough context." } },
        ],
      }),
    ),
  );
  const result = await investigate();
  expect(result.traces).toHaveLength(5);
  expect(result.action).toBe("disable_flag");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("feeds graph evidence into the next LLM turn and persists only a complete decision", async () => {
  const requests: { messages: Record<string, unknown>[]; tools: unknown[] }[] =
    [];
  const order = [...toolOrder].reverse();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, options: RequestInit) => {
      requests.push(JSON.parse(String(options.body)));
      const name = order[requests.length - 1];
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: `call-${requests.length}`,
                  type: "function",
                  function: { name, arguments: "{}" },
                },
              ],
            },
          },
        ],
      });
    }),
  );
  const result = await investigate();
  expect(requests).toHaveLength(5);
  expect(
    requests[1].messages.some(
      (message) =>
        message.role === "tool" &&
        String(message.content).includes("migration-88"),
    ),
  ).toBe(true);
  expect(requests.map((request) => request.tools.length)).toEqual([
    5, 4, 3, 2, 1,
  ]);
  expect(result.action).toBe("disable_flag");
  expect(result.revision).toBe(7);
  expect(result.mode).toBe("llm");
  expect(graph.saveInvestigation).toHaveBeenCalledWith(result);
});

it("surfaces provider failure without publishing a fabricated or fallback result", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("Unauthorized", { status: 401 })),
  );
  await expect(investigate()).rejects.toThrow("OpenAI rejected the API key");
  expect(graph.saveInvestigation).not.toHaveBeenCalled();
});
