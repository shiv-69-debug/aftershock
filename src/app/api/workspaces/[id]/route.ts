import { z } from "zod";
import {
  AccessError,
  accessWorkspace,
  authenticate,
  checkOrigin,
  createWorkspaceToken,
  inWorkspace,
  inviteMember,
  revokeWorkspaceTokens,
} from "@/lib/workspaces/identity";
import {
  activeDataset,
  catalog,
  importDataset,
  parseCompose,
  serviceRank,
  shortestDependencyPath,
  traceImpact,
} from "@/lib/workspaces/catalog";
import {
  appendEpisode,
  conversationMessages,
  conversations,
  createConversation,
  episodeInput,
  factInput,
  learnFromReceipt,
  procedureInput,
  recallWorkspace,
  recordFact,
  saveProcedure,
} from "@/lib/workspaces/memory";
import {
  documentInput,
  documents,
  processDocument,
  uploadDocument,
} from "@/lib/workspaces/documents";
import { callWorkspaceTool, toolNames } from "@/lib/workspaces/mcp";
import { answerWorkspace } from "@/lib/workspaces/agent";
import { ModelError } from "@/lib/llm";
import { seedGraph } from "@/lib/graph";
import { setConstraint } from "@/lib/graph";
import { modelConfiguration } from "@/lib/llm";
import { workflowStatus } from "@/lib/workflow";
import { investigate } from "@/lib/agent";
import { nodes, edges } from "@/lib/scenario";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;
const publicCompose =
  "https://raw.githubusercontent.com/open-telemetry/opentelemetry-demo/85c2cb253ae3519ef2b3a02984c32614106de5ea/compose.yaml";

async function body(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError("Request body required.", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > 3_000_000) {
      await reader.cancel();
      throw new AccessError("Request exceeds 3 MB.", 413);
    }
    chunks.push(value);
  }
  return z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof AccessError || error instanceof ModelError
          ? error.message
          : error instanceof z.ZodError
            ? "Invalid request fields."
            : "Workspace operation failed. Check the source data and server logs.",
    },
    {
      status:
        error instanceof AccessError
          ? error.status
          : error instanceof ModelError
            ? 502
            : error instanceof z.ZodError
              ? 400
              : 500,
    },
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await accessWorkspace(
      await authenticate(request),
      (await context.params).id,
    );
    return await inWorkspace(access, async () => {
      const url = new URL(request.url),
        view = url.searchParams.get("view");
      if (view === "conversation")
        return Response.json({
          messages: await conversationMessages(
            access,
            url.searchParams.get("conversation") || "",
          ),
        });
      if (view === "memory")
        return Response.json(
          await recallWorkspace(
            access,
            url.searchParams.get("topic") || "",
            url.searchParams.get("asOf") || undefined,
          ),
        );
      const [data, memory, sessions, sources, workflow] = await Promise.all([
        catalog(),
        recallWorkspace(access),
        conversations(access),
        documents(access),
        workflowStatus(),
      ]);
      return Response.json({
        workspace: { id: access.id, name: access.name, role: access.role },
        ...data,
        memory,
        conversations: sessions,
        documents: sources,
        workflow,
        modelConfigured: modelConfiguration().configured,
      });
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const user = await authenticate(request),
      data = await body(request);
    const op = z.string().parse(data.op);
    const access = await accessWorkspace(
      user,
      (await context.params).id,
      !["tool", "message", "conversation", "trace", "path", "rank"].includes(
        op,
      ),
    );
    return await inWorkspace(access, async () => {
      if (op === "import_json")
        return Response.json(await importDataset(data.dataset, user.id));
      if (op === "import_compose")
        return Response.json(
          await importDataset(
            parseCompose(z.string().max(2_000_000).parse(data.text)),
            user.id,
          ),
        );
      if (op === "import_public_sample") {
        const response = await fetch(publicCompose, {
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          throw new AccessError(
            "The pinned public dataset is unavailable. Upload a local Compose file instead.",
            502,
          );
        const parsed = parseCompose(await response.text(), publicCompose);
        parsed.name = "OpenTelemetry Demo — recorded startup topology";
        parsed.source.title = "OpenTelemetry Demo compose.yaml";
        parsed.source.license = "Apache-2.0";
        return Response.json(await importDataset(parsed, user.id));
      }
      if (op === "training") {
        if (access.role !== "owner")
          throw new AccessError("Only owners can load the training fixture.");
        await seedGraph();
        const result = await importDataset(
          {
            name: "AFTERSHOCK synthetic training topology",
            source: {
              title: "Built-in synthetic training fixture",
              license: "MIT",
              semantics:
                "Synthetic service dependencies for controlled sandbox exercises.",
            },
            services: nodes
              .filter((n) => n.kind === "Service")
              .map((n) => ({ id: n.id, name: n.name, description: n.detail })),
            dependencies: edges
              .filter((e) => e.relation === "DEPENDS_ON")
              .map((e) => ({ from: e.source, to: e.target })),
            teams: nodes
              .filter((n) => n.kind === "Team")
              .map((n) => ({ id: n.id, name: n.name, description: n.detail })),
            ownership: edges
              .filter((e) => e.relation === "OWNS")
              .map((e) => ({ team: e.source, service: e.target })),
            customers: nodes
              .filter((n) => n.kind === "Customer")
              .map((n) => ({
                id: n.id,
                name: n.name,
                description: n.detail,
                uses: edges
                  .filter((e) => e.source === n.id && e.relation === "USES")
                  .map((e) => e.target),
              })),
          },
          user.id,
        );
        return Response.json(result);
      }
      if (op === "training_constraint") {
        await setConstraint(z.boolean().parse(data.active));
        return Response.json({ ok: true });
      }
      if (op === "trace")
        return Response.json(
          await traceImpact(
            z.string().parse(data.serviceId),
            z.number().int().min(1).max(6).parse(data.depth),
          ),
        );
      if (op === "path")
        return Response.json(
          await shortestDependencyPath(
            z.string().parse(data.from),
            z.string().parse(data.to),
            z.number().int().min(1).max(6).default(6).parse(data.depth),
          ),
        );
      if (op === "rank") return Response.json(await serviceRank());
      if (op === "episode")
        return Response.json({
          id: await appendEpisode(access, episodeInput.parse(data.episode)),
        });
      if (op === "fact")
        return Response.json(
          await recordFact(access, factInput.parse(data.fact)),
        );
      if (op === "procedure")
        return Response.json(
          await saveProcedure(access, procedureInput.parse(data.procedure)),
        );
      if (op === "learn_outcome")
        return Response.json({
          id: await learnFromReceipt(
            access,
            z.string().uuid().parse(data.procedureVersionId),
            z.string().uuid().parse(data.receiptId),
          ),
        });
      if (op === "conversation")
        return Response.json({
          id: await createConversation(
            access,
            z
              .string()
              .max(160)
              .default("Investigation session")
              .parse(data.title),
          ),
        });
      if (op === "message") {
        const selection = data.selection
          ? z
              .object({
                tool: z.enum(toolNames),
                args: z.record(z.string(), z.unknown()),
              })
              .parse(data.selection)
          : undefined;
        return Response.json(
          await answerWorkspace(
            access,
            z.string().uuid().parse(data.conversationId),
            z.string().min(1).max(1500).parse(data.question),
            selection,
          ),
        );
      }
      if (op === "tool")
        return Response.json(
          await callWorkspaceTool(
            access,
            z.enum(toolNames).parse(data.tool),
            z.record(z.string(), z.unknown()).default({}).parse(data.args),
          ),
        );
      if (op === "document")
        return Response.json(
          await uploadDocument(access, documentInput.parse(data.document)),
        );
      if (op === "retry_document") {
        void processDocument(
          access,
          z.string().uuid().parse(data.documentId),
        ).catch(() => {});
        return Response.json({
          accepted: true,
          note: "The worker resumes when its lease is available.",
        });
      }
      if (op === "token")
        return Response.json({
          token: await createWorkspaceToken(access),
          workspaceId: access.id,
        });
      if (op === "revoke_tokens") {
        await revokeWorkspaceTokens(access);
        return Response.json({ revoked: true });
      }
      if (op === "invite") {
        await inviteMember(
          access,
          z.string().parse(data.username),
          z.enum(["operator", "reader"]).parse(data.role),
        );
        return Response.json({ ok: true });
      }
      if (op === "sandbox_investigate") {
        if (!(await activeDataset()))
          throw new AccessError("Load a dataset first.", 409);
        return Response.json(
          await investigate(() => {}, undefined, { toolSelection: "fixed" }),
        );
      }
      throw new AccessError("Unknown workspace operation.", 400);
    });
  } catch (error) {
    return failure(error);
  }
}
