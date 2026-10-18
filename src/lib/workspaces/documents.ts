import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { query, readQuery } from "../graph";
import { AccessError, inWorkspace, type WorkspaceAccess } from "./identity";

export const documentInput = z.object({
  title: z.string().trim().min(1).max(200),
  sourceUrl: z.string().max(1500).default(""),
  fileType: z.enum(["text", "markdown", "pdf"]).default("text"),
  text: z.string().max(20000).optional(),
  contentBase64: z.string().max(2_800_000).optional(),
});
type DocumentRow = {
  id: string;
  title: string;
  sourceUrl: string;
  state: string;
  createdAt: string;
  error: string | null;
  stats: string | null;
};
type RagResult = {
  sources?: {
    sourceId: string;
    chunkId: string;
    chunkIndex: number;
    text: string;
  }[];
  ingestion?: Record<string, unknown>;
  finalize?: Record<string, unknown>;
  graphNodes?: number;
  error?: string;
  [key: string]: unknown;
};
const running = new Set<string>();

export async function runGraphRag(
  access: WorkspaceAccess,
  request: Record<string, unknown>,
): Promise<RagResult> {
  if (!/^asw_[a-f0-9]{32}_knowledge$/.test(access.knowledgeGraph))
    throw new AccessError("Invalid internal knowledge-graph scope.");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      [
        "compose",
        "run",
        "--rm",
        "--no-deps",
        "-T",
        "graphrag-worker",
        "--graph",
        access.knowledgeGraph,
      ],
      { cwd: process.cwd(), env: process.env, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      bytes = 0,
      settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      finish(
        new Error(
          "GraphRAG worker timed out. The document remains unavailable until a successful retry.",
        ),
      );
    }, 600000);
    function finish(error?: Error, data?: RagResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(data!);
    }
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 2_000_000) {
        child.kill();
        finish(new Error("GraphRAG output exceeded the response limit."));
      } else output += chunk.toString();
    });
    // Drain stderr but never return provider payloads or credentials to a browser.
    child.stderr.on("data", () => {});
    child.on("error", () =>
      finish(
        new Error(
          "Could not start Docker. Build the GraphRAG worker and keep Docker Desktop running.",
        ),
      ),
    );
    child.on("close", (code) => {
      if (settled) return;
      try {
        const line = output
          .trim()
          .split("\n")
          .filter((value) => value.startsWith("{"))
          .at(-1);
        const data: RagResult = JSON.parse(line || "{}");
        if (code !== 0 || data.error)
          finish(
            new Error(
              `GraphRAG ingestion/retrieval failed (${data.error || "worker unavailable"}). Check the worker image and provider quota, then retry.`,
            ),
          );
        else finish(undefined, data);
      } catch {
        finish(new Error("GraphRAG returned an invalid response."));
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(request));
  });
}

export async function uploadDocument(
  access: WorkspaceAccess,
  input: z.infer<typeof documentInput>,
) {
  if (access.role === "reader") throw new AccessError("Read-only workspace.");
  if (input.fileType === "pdf" ? !input.contentBase64 : !input.text?.trim())
    throw new AccessError("Document content is required.", 400);
  if (!process.env.GROQ_API_KEY)
    throw new AccessError(
      "GraphRAG document extraction requires GROQ_API_KEY on the server.",
      409,
    );
  const id = randomUUID(),
    at = new Date().toISOString();
  const content = input.fileType === "pdf" ? input.contentBase64! : input.text!;
  await query(
    "CREATE (d:SourceDocument {id:$id,title:$title,sourceUrl:$url,fileType:$type,content:$content,contentHash:$hash,state:'queued',createdAt:$at,createdBy:$user})",
    {
      id,
      title: input.title,
      url: input.sourceUrl,
      type: input.fileType,
      content,
      hash: createHash("sha256").update(content).digest("hex"),
      at,
      user: access.userId,
    },
  );
  void processDocument(access, id).catch(() => {});
  return { id, state: "queued" };
}

export async function processDocument(access: WorkspaceAccess, id: string) {
  const key = `${access.id}:${id}`;
  if (running.has(key) || running.size >= 2) return;
  running.add(key);
  try {
    await inWorkspace(access, async () => {
      // One extraction per workspace. A timed-out lease can be retried explicitly.
      const claimed = await query<{ type: string; content: string }>(
        `MATCH (m:WorkspaceMeta {id:'workspace'}), (d:SourceDocument {id:$id})
        WHERE (m.ragLeaseUntil IS NULL OR m.ragLeaseUntil<$now) AND (d.state='queued' OR d.state='failed' OR (d.state='running' AND d.leaseUntil<$now))
        SET m.ragLeaseUntil=$expiry,m.ragJob=$id,d.state='running',d.leaseUntil=$expiry,d.error=''
        RETURN d.fileType AS type,d.content AS content`,
        { id, now: Date.now(), expiry: Date.now() + 650000 },
      );
      if (!claimed.length) return;
      try {
        const result = await runGraphRag(access, {
          op: "ingest",
          source_id: id,
          ...(claimed[0].type === "pdf"
            ? { fileType: "pdf", contentBase64: claimed[0].content }
            : { text: claimed[0].content }),
        });
        await query(
          "MATCH (d:SourceDocument {id:$id}), (m:WorkspaceMeta {id:'workspace'}) WHERE m.ragJob=$id SET d.state='ready',d.stats=$stats,d.completedAt=$at,m.ragLeaseUntil=0,m.ragJob=''",
          { id, stats: JSON.stringify(result), at: new Date().toISOString() },
        );
      } catch (error) {
        await query(
          "MATCH (d:SourceDocument {id:$id}), (m:WorkspaceMeta {id:'workspace'}) WHERE m.ragJob=$id SET d.state='failed',d.error=$error,m.ragLeaseUntil=0,m.ragJob=''",
          {
            id,
            error: error instanceof Error ? error.message : "GraphRAG failed.",
          },
        );
      }
    });
  } finally {
    running.delete(key);
  }
}

export async function documents(access: WorkspaceAccess) {
  const rows = await readQuery<DocumentRow>(
    "MATCH (d:SourceDocument) RETURN d.id AS id,d.title AS title,d.sourceUrl AS sourceUrl,d.state AS state,d.createdAt AS createdAt,d.error AS error,d.stats AS stats ORDER BY d.createdAt DESC LIMIT 100",
  );
  const queued = rows.find((row) => row.state === "queued");
  if (queued) void processDocument(access, queued.id).catch(() => {});
  return rows;
}

export async function searchDocuments(
  access: WorkspaceAccess,
  question: string,
) {
  const ready = await readQuery<{
    id: string;
    title: string;
    sourceUrl: string;
  }>(
    "MATCH (d:SourceDocument {state:'ready'}) RETURN d.id AS id,d.title AS title,d.sourceUrl AS sourceUrl LIMIT 100",
  );
  if (!ready.length)
    return {
      tool: "search_documents",
      sources: [],
      note: "No successfully indexed documents are available in this workspace.",
    };
  const result = await runGraphRag(access, {
    op: "retrieve",
    question: question.slice(0, 1500),
  });
  const allowed = new Map(ready.map((document) => [document.id, document]));
  return {
    tool: "search_documents",
    sources: (result.sources || [])
      .filter((source) => allowed.has(source.sourceId))
      .map((source) => ({
        ...source,
        title: allowed.get(source.sourceId)!.title,
        sourceUrl: allowed.get(source.sourceId)!.sourceUrl,
      })),
    note: "GraphRAG SDK retrieval over the workspace knowledge graph, with persisted document/chunk provenance. Extracted statements are unverified evidence, not action permission.",
  };
}
