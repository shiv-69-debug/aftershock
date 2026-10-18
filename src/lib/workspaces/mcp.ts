import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import { readQuery } from "../graph";
import { inWorkspace, type WorkspaceAccess } from "./identity";
import {
  catalog,
  resolveEntity,
  serviceRank,
  shortestDependencyPath,
  traceImpact,
} from "./catalog";
import { listProcedures, recallWorkspace } from "./memory";
import { searchDocuments } from "./documents";

export const toolNames = [
  "list_services",
  "inspect_service",
  "trace_blast_radius",
  "shortest_dependency_path",
  "rank_services",
  "recall_memory",
  "list_procedures",
  "search_documents",
] as const;
export type WorkspaceTool = (typeof toolNames)[number];

export function createWorkspaceMcpServer(
  access: WorkspaceAccess,
  reauthorize?: () => Promise<WorkspaceAccess>,
) {
  const server = new McpServer({
    name: "aftershock-workspace-tools",
    version: "1.0.0",
  });
  const respond = async (operation: () => Promise<unknown>) => {
    try {
      if (reauthorize) await reauthorize();
      const value = await inWorkspace(access, operation);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(value) }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text:
              error instanceof Error ? error.message : "Workspace tool failed.",
          },
        ],
      };
    }
  };
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    "list_services",
    {
      description:
        "List known services in the authorized workspace's active dataset. Never guess a service ID.",
      inputSchema: z.object({}),
      annotations,
    },
    () =>
      respond(async () => {
        const data = await catalog();
        return {
          dataset: data.dataset,
          services: data.nodes.filter((node) => node.kind === "Service"),
        };
      }),
  );
  server.registerTool(
    "inspect_service",
    {
      description:
        "Read one known service, its direct dependencies, owners, and source records.",
      inputSchema: z.object({ serviceId: z.string().min(1).max(250) }),
      annotations,
    },
    ({ serviceId }) =>
      respond(async () => {
        const service = await resolveEntity(serviceId, true);
        const [dependencies, owners] = await Promise.all([
          readQuery(
            "MATCH (:Service {id:$id})-[:DEPENDS_ON]->(s:Service) RETURN s.id AS id,s.name AS name,s.detail AS detail,s.source AS source LIMIT 100",
            { id: service.id },
          ),
          readQuery(
            "MATCH (t:Team)-[:OWNS]->(:Service {id:$id}) RETURN t.id AS id,t.name AS name,t.detail AS detail,t.source AS source LIMIT 30",
            { id: service.id },
          ),
        ]);
        return { service, dependencies, owners };
      }),
  );
  server.registerTool(
    "trace_blast_radius",
    {
      description:
        "Follow incoming DEPENDS_ON and USES relationships, with exact paths and a validated depth of 1–6. Empty means no recorded connection, not no impact.",
      inputSchema: z.object({
        serviceId: z.string().min(1).max(250),
        depth: z.number().int().min(1).max(6).default(3),
      }),
      annotations,
    },
    ({ serviceId, depth }) => respond(() => traceImpact(serviceId, depth)),
  );
  server.registerTool(
    "shortest_dependency_path",
    {
      description:
        "Use FalkorDB algo.SPpaths to find one bounded directed shortest path between known entities. Returns exact node paths and weight.",
      inputSchema: z.object({
        from: z.string().min(1).max(250),
        to: z.string().min(1).max(250),
        maxDepth: z.number().int().min(1).max(6).default(6),
      }),
      annotations,
    },
    ({ from, to, maxDepth }) =>
      respond(() => shortestDependencyPath(from, to, maxDepth)),
  );
  server.registerTool(
    "rank_services",
    {
      description:
        "Run FalkorDB algo.pageRank on service dependencies. Structural ranking only; not a risk/severity estimate.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(20).default(10),
      }),
      annotations,
    },
    ({ limit }) => respond(() => serviceRank(limit)),
  );
  server.registerTool(
    "recall_memory",
    {
      description:
        "Retrieve historical episodes separately from recent notes, current semantic facts and versioned procedures. Respects owner visibility and temporal validity.",
      inputSchema: z.object({
        topic: z.string().max(120).default(""),
        asOf: z.string().datetime().optional(),
      }),
      annotations,
    },
    ({ topic, asOf }) => respond(() => recallWorkspace(access, topic, asOf)),
  );
  server.registerTool(
    "list_procedures",
    {
      description:
        "List versioned sandbox procedures ranked by linked verified sandbox outcomes. Drafts and source references remain explicit.",
      inputSchema: z.object({ topic: z.string().max(120).default("") }),
      annotations,
    },
    ({ topic }) => respond(() => listProcedures(access, topic)),
  );
  server.registerTool(
    "search_documents",
    {
      description:
        "Retrieve passages and graph entity context through the GraphRAG SDK from this workspace's indexed source documents. Returns exact source/chunk IDs.",
      inputSchema: z.object({ question: z.string().min(1).max(1500) }),
      annotations,
    },
    ({ question }) => respond(() => searchDocuments(access, question)),
  );
  return server;
}

/** The UI agent uses the actual MCP client/protocol, not a direct function-call substitute. */
export async function withMcpClient<T>(
  access: WorkspaceAccess,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createWorkspaceMcpServer(access),
    client = new Client({ name: "aftershock-investigator", version: "1.0.0" });
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    return await operation(client);
  } finally {
    await client.close();
    await server.close();
  }
}

export async function callWorkspaceTool(
  access: WorkspaceAccess,
  name: WorkspaceTool,
  args: Record<string, unknown>,
) {
  return withMcpClient(access, async (client) => {
    const result = await client.callTool(
      { name, arguments: args },
      { timeout: name === "search_documents" ? 600000 : 15000 },
    );
    const text = result.content?.find((item) => item.type === "text");
    if (!text || text.type !== "text")
      throw new Error("MCP tool returned no text result.");
    if (result.isError) throw new Error(text.text);
    return JSON.parse(text.text) as Record<string, unknown>;
  });
}
