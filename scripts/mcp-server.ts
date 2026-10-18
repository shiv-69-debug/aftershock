import { loadEnvConfig } from "@next/env";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { authenticateWorkspaceToken } from "../src/lib/workspaces/identity";
import { createWorkspaceMcpServer } from "../src/lib/workspaces/mcp";
import { closeGraph } from "../src/lib/graph";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
loadEnvConfig(process.cwd());
async function main() {
  const access = await authenticateWorkspaceToken(
    process.env.AFTERSHOCK_MCP_TOKEN || "",
    process.env.AFTERSHOCK_WORKSPACE_ID || "",
  );
  const server = createWorkspaceMcpServer(access, () =>
    authenticateWorkspaceToken(
      process.env.AFTERSHOCK_MCP_TOKEN || "",
      process.env.AFTERSHOCK_WORKSPACE_ID || "",
    ),
  );
  await server.connect(new StdioServerTransport());
  process.on("SIGINT", () => {
    void server.close().finally(closeGraph);
  });
}
main().catch(() => {
  console.error(
    "MCP startup failed. Check the workspace ID, scoped token, and database connection.",
  );
  process.exitCode = 1;
});
