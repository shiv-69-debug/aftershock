import {
  AccessError,
  accessWorkspace,
  authenticate,
  inWorkspace,
} from "@/lib/workspaces/identity";
import { probeSandbox, sandboxState } from "@/lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; sandboxId: string }> },
) {
  try {
    const params = await context.params,
      access = await accessWorkspace(await authenticate(request), params.id);
    return await inWorkspace(access, async () => {
      const state = await sandboxState(params.sandboxId),
        probe = probeSandbox(state);
      return Response.json(
        { scope: "workspace sandbox", state, probe },
        { status: probe.outcome === "ok" ? 200 : 504 },
      );
    });
  } catch (error) {
    return Response.json(
      { error: "Sandbox unavailable in this workspace." },
      { status: error instanceof AccessError ? error.status : 404 },
    );
  }
}
