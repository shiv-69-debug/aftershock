import { z } from "zod";
import {
  consumeHandoff,
  createHandoff,
  verifyReceipt,
  workflowStatus,
} from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ items: await workflowStatus() });
  } catch {
    return Response.json(
      { error: "Could not read workflow records from FalkorDB." },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const input = z
    .discriminatedUnion("action", [
      z.object({ action: z.literal("handoff"), runId: z.uuid() }),
      z.object({ action: z.literal("execute"), handoffId: z.uuid() }),
    ])
    .safeParse(await request.json().catch(() => null));
  if (!input.success)
    return Response.json(
      { error: "Provide a valid investigation or handoff ID." },
      { status: 400 },
    );
  try {
    if (input.data.action === "handoff")
      return Response.json({ handoff: await createHandoff(input.data.runId) });
    const receipt = await consumeHandoff(input.data.handoffId);
    return Response.json({
      receipt,
      verification: await verifyReceipt(receipt),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Workflow operation failed.",
      },
      { status: 409 },
    );
  }
}
