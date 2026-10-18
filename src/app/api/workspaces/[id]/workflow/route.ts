import { z } from "zod";
import {
  AccessError,
  accessWorkspace,
  authenticate,
  checkOrigin,
  inWorkspace,
} from "@/lib/workspaces/identity";
import {
  consumeHandoff,
  createHandoff,
  verifyReceipt,
  workflowStatus,
} from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const access = await accessWorkspace(
      await authenticate(request),
      (await context.params).id,
    );
    return await inWorkspace(access, async () =>
      Response.json({ items: await workflowStatus() }),
    );
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Workflow unavailable.",
      },
      { status: error instanceof AccessError ? error.status : 503 },
    );
  }
}
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(request);
    const access = await accessWorkspace(
      await authenticate(request),
      (await context.params).id,
      true,
    );
    const input = z
      .discriminatedUnion("action", [
        z.object({ action: z.literal("handoff"), runId: z.uuid() }),
        z.object({ action: z.literal("execute"), handoffId: z.uuid() }),
      ])
      .parse(await request.json());
    return await inWorkspace(access, async () => {
      if (input.action === "handoff")
        return Response.json({ handoff: await createHandoff(input.runId) });
      const receipt = await consumeHandoff(input.handoffId);
      return Response.json({
        receipt,
        verification: await verifyReceipt(receipt),
      });
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Workflow failed." },
      { status: error instanceof AccessError ? error.status : 409 },
    );
  }
}
