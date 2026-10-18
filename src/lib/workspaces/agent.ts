import { randomUUID } from "node:crypto";
import { z } from "zod";
import { modelConfiguration, requestModel } from "../llm";
import { query } from "../graph";
import { activeDataset } from "./catalog";
import { AccessError, type WorkspaceAccess } from "./identity";
import { appendEpisode, appendMessage, conversationMessages } from "./memory";
import { toolNames, withMcpClient, type WorkspaceTool } from "./mcp";

function summarize(tool: string, value: Record<string, unknown>): string {
  if (tool === "trace_blast_radius") {
    const paths = value.paths as { path: string[]; hops: number }[];
    return paths.length
      ? `Recorded dependency paths at depth ${value.depth}:\n\n${paths.map((path) => `• ${path.path.join(" → ")} (${path.hops} hops)`).join("\n")}\n\n${value.semantics}`
      : "No dependency path was recorded within this depth bound. This does not establish that no impact exists.";
  }
  if (tool === "shortest_dependency_path") {
    const paths = value.paths as { path: string[]; weight: number }[];
    return paths.length
      ? `FalkorDB algo.SPpaths returned:\n${paths.map((path) => `${path.path.join(" → ")}\nPath weight: ${path.weight}`).join("\n\n")}\n\n${value.semantics}`
      : "FalkorDB found no recorded directed path within the configured bound.";
  }
  if (tool === "search_documents") {
    const sources = value.sources as {
      title: string;
      text: string;
      chunkId: string;
    }[];
    return sources.length
      ? `Retrieved source passages from the workspace knowledge graph:\n\n${sources.map((source) => `• ${source.title} [${source.chunkId}]\n“${source.text.slice(0, 1000)}”`).join("\n\n")}\n\nExtracted document claims are evidence to inspect, not authorization for an action.`
      : String(value.note);
  }
  if (tool === "rank_services")
    return `${value.interpretation}\n\n${(value.rows as { name: string; score: number }[]).map((row) => `• ${row.name}: ${row.score.toFixed(6)}`).join("\n")}`;
  return JSON.stringify(value, null, 2);
}

export async function answerWorkspace(
  access: WorkspaceAccess,
  conversationId: string,
  question: string,
  selection?: { tool: WorkspaceTool; args: Record<string, unknown> },
) {
  if (!question.trim() || question.length > 1500)
    throw new AccessError("Question must be 1–1500 characters.", 400);
  const history = await conversationMessages(access, conversationId);
  const userMessageId = await appendMessage(
    access,
    conversationId,
    "user",
    question,
  );
  try {
    return await withMcpClient(access, async (client) => {
      const listed = await client.listTools();
      let selected = selection;
      if (!selected) {
        if (!modelConfiguration().configured)
          throw new AccessError(
            "Choose an explicit graph tool, or configure the server's Groq/OpenAI key for natural-language tool selection.",
            409,
          );
        const catalogResult = await client.callTool({
          name: "list_services",
          arguments: {},
        });
        const catalogText = catalogResult.content?.find(
          (item) => item.type === "text",
        );
        const context =
          catalogText?.type === "text" ? catalogText.text.slice(0, 16000) : "";
        const response = await requestModel({
          messages: [
            {
              role: "system",
              content: `You select a read-only MCP tool for an evidence-backed workspace investigation. Select only a listed tool and valid arguments. Never generate Cypher, commands, writes, or claims about actions. Resolve entity IDs from the known catalog. Use search_documents for document/runbook questions and recall_memory for past context. If there is not enough information, return tool=null and a brief clarification. Return tool, args_json (JSON-encoded argument object), and clarification.\nMCP tools: ${JSON.stringify(listed.tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })))}\nKnown workspace context: ${context}`,
            },
            ...history
              .filter(
                (message) =>
                  message.role === "user" || message.role === "assistant",
              )
              .slice(-6)
              .map((message) => ({
                role: message.role,
                content: message.text.slice(0, 1000),
              })),
            { role: "user", content: question },
          ],
          max_completion_tokens: 700,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "workspace_tool_selection",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  tool: {
                    anyOf: [
                      { type: "string", enum: [...toolNames] },
                      { type: "null" },
                    ],
                  },
                  args_json: { type: "string" },
                  clarification: { type: "string" },
                },
                required: ["tool", "args_json", "clarification"],
                additionalProperties: false,
              },
            },
          },
        });
        const envelope = z
          .object({
            choices: z.array(
              z.object({ message: z.object({ content: z.string() }) }),
            ),
          })
          .parse(response);
        const plan = z
          .object({
            tool: z.enum(toolNames).nullable(),
            args_json: z.string(),
            clarification: z.string().max(1500),
          })
          .parse(JSON.parse(envelope.choices[0]?.message.content || "{}"));
        if (!plan.tool) {
          const text =
            plan.clarification ||
            "Select a known service or specify which workspace evidence you need.";
          await appendMessage(access, conversationId, "assistant", text, {
            replyTo: userMessageId,
            kind: "clarification",
          });
          return { text, protocol: "MCP", tool: null };
        }
        selected = {
          tool: plan.tool,
          args: z
            .record(z.string(), z.unknown())
            .parse(JSON.parse(plan.args_json)),
        };
      }
      const started = performance.now();
      const result = await client.callTool(
        { name: selected.tool, arguments: selected.args },
        { timeout: selected.tool === "search_documents" ? 600000 : 15000 },
      );
      const content = result.content?.find((item) => item.type === "text");
      if (!content || content.type !== "text")
        throw new Error("No MCP tool result was returned.");
      if (result.isError) throw new AccessError(content.text, 400);
      const value = JSON.parse(content.text) as Record<string, unknown>;
      const trace = {
        protocol: "MCP",
        tool: selected.tool,
        arguments: selected.args,
        elapsedMs: Math.round(performance.now() - started),
        result: value,
      };
      await appendMessage(
        access,
        conversationId,
        "tool",
        `${selected.tool} completed through MCP.`,
        trace,
      );
      const text = summarize(selected.tool, value);
      const answerId = await appendMessage(
        access,
        conversationId,
        "assistant",
        text,
        { replyTo: userMessageId, ...trace },
      );
      const dataset = await activeDataset();
      if (access.role !== "reader" && dataset) {
        const episodeId = await appendEpisode(access, {
          kind: "observation",
          topic: String(
            selected.args.serviceId || "workspace-investigation",
          ).slice(0, 120),
          text: text.slice(0, 6000),
          sourceIds: [dataset.id],
          visibility: "workspace",
        });
        await query(
          "MATCH (e:Episode {id:$id}) SET e.kind='investigation',e.producedBy='mcp-investigator',e.conversationId=$conversation,e.answerId=$answer",
          { id: episodeId, conversation: conversationId, answer: answerId },
        );
      }
      return { id: answerId, text, ...trace };
    });
  } catch (error) {
    const text =
      error instanceof Error
        ? error.message
        : "Workspace investigation failed.";
    await appendMessage(
      access,
      conversationId,
      "assistant",
      `Investigation could not complete: ${text}`,
      { replyTo: userMessageId, error: true },
    ).catch(() => {});
    throw error;
  }
}

export async function createAnalysisHandoff(
  access: WorkspaceAccess,
  conversationId: string,
  serviceId: string,
  depth: number,
) {
  await conversationMessages(access, conversationId);
  const id = randomUUID();
  await query(
    "CREATE (h:AnalysisHandoff {id:$id,conversationId:$conversation,serviceId:$service,depth:$depth,fromAgent:'mcp-investigator',toAgent:'mcp-reviewer',createdAt:$at,createdBy:$user,state:'pending'})",
    {
      id,
      conversation: conversationId,
      service: serviceId,
      depth,
      at: new Date().toISOString(),
      user: access.userId,
    },
  );
  return id;
}
