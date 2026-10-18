import { probeSandbox, sandboxState } from "@/lib/workflow";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  if (
    !z
      .string()
      .regex(/^sandbox-[0-9a-f-]{36}$/)
      .safeParse(id).success
  )
    return Response.json({ error: "Invalid sandbox ID." }, { status: 400 });
  try {
    const state = await sandboxState(id);
    const probe = probeSandbox(state);
    return Response.json(
      { scope: "sandbox", state, probe },
      { status: probe.outcome === "ok" ? 200 : 504 },
    );
  } catch {
    return Response.json(
      { error: "Sandbox not found or database unavailable." },
      { status: 404 },
    );
  }
}
