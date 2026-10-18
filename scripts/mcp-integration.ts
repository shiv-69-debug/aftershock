import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { getDatabase, closeGraph } from "../src/lib/graph";
import {
  register,
  createWorkspace,
  createWorkspaceToken,
  inWorkspace,
  revokeWorkspaceTokens,
} from "../src/lib/workspaces/identity";
import { importDataset } from "../src/lib/workspaces/catalog";

process.env.AFTERSHOCK_CONTROL_GRAPH = `as_mcp_test_${randomUUID().replaceAll("-", "")}`;
const graphs: string[] = [];
async function main() {
  let client: Client | undefined;
  try {
    const user = await register("mcp-user", `mcp-${randomUUID()}`),
      workspace = await createWorkspace(user, "MCP isolated graph");
    graphs.push(workspace.graphName);
    await inWorkspace(workspace, () =>
      importDataset(
        {
          name: "MCP test dataset",
          source: { title: "Synthetic fixture" },
          services: [
            { id: "a", name: "Service A" },
            { id: "b", name: "Service B" },
          ],
          dependencies: [{ from: "a", to: "b" }],
        },
        user.id,
      ),
    );
    const token = await createWorkspaceToken(workspace);
    const environment = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        resolve("node_modules/tsx/dist/cli.mjs"),
        resolve("scripts/mcp-server.ts"),
      ],
      env: {
        ...environment,
        AFTERSHOCK_WORKSPACE_ID: workspace.id,
        AFTERSHOCK_MCP_TOKEN: token,
      },
      stderr: "pipe",
    });
    client = new Client({ name: "aftershock-integration", version: "1.0.0" });
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 8);
    assert.ok(
      !list.tools.some((tool) => /raw|delete|write_query/.test(tool.name)),
    );
    const result = await client.callTool({
      name: "shortest_dependency_path",
      arguments: { from: "a", to: "b", maxDepth: 3 },
    });
    const content = result.content?.find((item) => item.type === "text");
    assert.ok(content && content.type === "text");
    const path = JSON.parse(content.text);
    assert.equal(path.algorithm, "algo.SPpaths");
    assert.deepEqual(path.paths[0].path, ["Service A", "Service B"]);
    const invalid = await client.callTool({
      name: "trace_blast_radius",
      arguments: { serviceId: "b", depth: 100 },
    });
    assert.equal(invalid.isError, true);
    await revokeWorkspaceTokens(workspace);
    const revoked = await client.callTool({
      name: "list_services",
      arguments: {},
    });
    assert.equal(revoked.isError, true);
    console.log(
      "PASS: actual stdio MCP handshake, tool discovery, SPpaths execution, bounded argument validation, and live token revocation.",
    );
  } finally {
    await client?.close();
    const db = await getDatabase();
    for (const name of [...graphs, process.env.AFTERSHOCK_CONTROL_GRAPH!])
      await db
        .selectGraph(name)
        .delete()
        .catch(() => {});
    await closeGraph();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
