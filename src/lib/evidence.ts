import { createHash } from "node:crypto";
import type { Evidence, ToolTrace } from "./types";

export function evidenceRecords(traces: ToolTrace[]): Evidence[] {
  const records = traces.flatMap((trace) => trace.rows);
  for (const row of traces.find((trace) => trace.tool === "inspect_deployment")
    ?.rows || []) {
    if (
      typeof row.dependencyId === "string" &&
      typeof row.dependencySource === "string"
    )
      records.push({
        id: row.dependencyId,
        name: String(row.dependencyName || row.dependencyId),
        detail: String(row.dependencyEvidence || ""),
        source: row.dependencySource,
      });
    if (
      typeof row.runbookId === "string" &&
      typeof row.runbookSource === "string"
    )
      records.push({
        id: row.runbookId,
        name: "Checkout sandbox runbook",
        detail: String(row.runbookDetail || ""),
        source: row.runbookSource,
      });
  }
  return [...new Map(records.map((row) => [row.id, row])).values()];
}

export function evidenceDigest(traces: ToolTrace[]): string {
  const relevant = traces
    .filter(
      (trace) =>
        trace.tool === "inspect_deployment" ||
        trace.tool === "check_constraints",
    )
    .map((trace) => ({
      tool: trace.tool,
      rows: trace.rows
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
          ),
        )
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    }))
    .sort((a, b) => a.tool.localeCompare(b.tool));
  return createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
}
