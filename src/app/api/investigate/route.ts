import { investigate } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const emit = (event: string, data: unknown) => {
        if (open) {
          try {
            controller.enqueue(
              encoder.encode(JSON.stringify({ event, data }) + "\n"),
            );
          } catch {
            open = false;
          }
        }
      };
      try {
        const result = await investigate(
          (trace) => emit("trace", trace),
          undefined,
          { toolSelection: "fixed" },
        );
        emit("complete", result);
      } catch (error) {
        console.error("Investigation failed", error);
        emit("error", {
          message:
            "Investigation failed. Check FalkorDB, load the scenario, and verify the optional LLM configuration.",
        });
      } finally {
        if (open) controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
