import { z } from "zod";
import { resolveInvestigation } from "@/lib/graph";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = z
    .object({ investigationId: z.uuid() })
    .safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "A valid investigation ID is required." },
      { status: 400 },
    );
  try {
    return Response.json(await resolveInvestigation(body.data.investigationId));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Could not save resolution.",
      },
      { status: 409 },
    );
  }
}
