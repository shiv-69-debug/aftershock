import { z } from "zod";
import {
  AccessError,
  authenticate,
  checkOrigin,
  createWorkspace,
  workspaces,
} from "@/lib/workspaces/identity";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return Response.json({
      workspaces: (await workspaces(await authenticate(request))).map(
        ({ graphName: _g, knowledgeGraph: _k, ...workspace }) => workspace,
      ),
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AccessError
            ? error.message
            : "Workspace service unavailable.",
      },
      { status: error instanceof AccessError ? error.status : 503 },
    );
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await authenticate(request);
    const input = z
      .object({ name: z.string().trim().min(1).max(100) })
      .parse(await request.json());
    const workspace = await createWorkspace(user, input.name);
    return Response.json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        role: workspace.role,
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AccessError
            ? error.message
            : "Could not create workspace.",
      },
      { status: error instanceof AccessError ? error.status : 400 },
    );
  }
}
