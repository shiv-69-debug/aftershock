import { z } from "zod";
import { seedGraph, setConstraint, snapshot } from "@/lib/graph";

export const runtime = "nodejs";
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("seed") }),
  z.object({ action: z.literal("constraint"), active: z.boolean() }),
]);

export async function POST(request: Request) {
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return Response.json(
      { error: "Expected seed or constraint action." },
      { status: 400 },
    );
  try {
    if (body.data.action === "seed") await seedGraph();
    else await setConstraint(body.data.active);
    return Response.json(await snapshot());
  } catch {
    return Response.json(
      {
        error:
          "Could not update the graph. Check FalkorDB and load the scenario first.",
      },
      { status: 503 },
    );
  }
}
