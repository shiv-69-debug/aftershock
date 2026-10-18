import { memories, snapshot } from "@/lib/graph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [graph, memory] = await Promise.all([snapshot(), memories()]);
    return Response.json({
      connected: true,
      graph,
      memory,
      mode: "deterministic",
    });
  } catch {
    return Response.json(
      {
        connected: false,
        mode: "deterministic",
        error:
          "FalkorDB is unavailable. Start Docker and run docker compose up -d, then reconnect.",
      },
      { status: 503 },
    );
  }
}
