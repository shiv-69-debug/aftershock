import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { cpus, platform } from "node:os";
import { getDatabase, closeGraph, readQuery } from "../src/lib/graph";
import {
  register,
  createWorkspace,
  accessWorkspace,
  inWorkspace,
} from "../src/lib/workspaces/identity";
import { importDataset, traceImpact } from "../src/lib/workspaces/catalog";
import { appendEpisode } from "../src/lib/workspaces/memory";

process.env.AFTERSHOCK_CONTROL_GRAPH = `as_benchmark_${randomUUID().replaceAll("-", "")}`;
const concurrency = Math.min(
  64,
  Math.max(2, Number(process.env.BENCH_CONCURRENCY || 32)),
);
const operations = Math.min(
  10000,
  Math.max(30, Number(process.env.BENCH_OPERATIONS || 1500)),
);
const graphs: string[] = [];
const percentile = (values: number[], p: number) =>
  Number(
    [...values]
      .sort((a, b) => a - b)
      [Math.min(values.length - 1, Math.floor(values.length * p))]?.toFixed(
        2,
      ) || 0,
  );

async function main() {
  try {
    const user = await register("benchmark", `benchmark-${randomUUID()}`);
    const workspace = await createWorkspace(user, "Isolated load benchmark"),
      other = await createWorkspace(user, "Isolation control");
    graphs.push(workspace.graphName, other.graphName);
    await inWorkspace(workspace, () =>
      importDataset(
        {
          name: "Synthetic load topology",
          source: { title: "Generated benchmark fixture", license: "CC0" },
          services: Array.from({ length: 200 }, (_, i) => ({
            id: `service-${i}`,
            name: `service-${i}`,
          })),
          dependencies: Array.from({ length: 199 }, (_, i) => ({
            from: `service-${i + 1}`,
            to: `service-${i}`,
          })),
        },
        user.id,
      ),
    );
    const readTimes: number[] = [],
      writeTimes: number[] = [];
    let cursor = 0,
      active = 0,
      peakActive = 0,
      failures = 0,
      expectedWrites = 0;
    const started = performance.now();
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= operations) return;
          const write = index % 3 === 0;
          if (write) expectedWrites++;
          active++;
          peakActive = Math.max(active, peakActive);
          const before = performance.now();
          try {
            const authorized = await accessWorkspace(user, workspace.id, write);
            await inWorkspace(authorized, async () => {
              if (write)
                await appendEpisode(authorized, {
                  kind: "operator_note",
                  topic: "benchmark",
                  text: `Concurrent operation ${index}`,
                  sourceIds: [],
                  visibility: "workspace",
                });
              else await traceImpact(`service-${index % 100}`, 3);
            });
            (write ? writeTimes : readTimes).push(performance.now() - before);
          } catch {
            failures++;
          } finally {
            active--;
          }
        }
      }),
    );
    const durationMs = performance.now() - started;
    const persisted = await inWorkspace(workspace, () =>
      readQuery<{ count: number }>(
        "MATCH (e:Episode {topic:'benchmark'}) RETURN count(e) AS count",
      ),
    );
    const isolated = await inWorkspace(other, () =>
      readQuery<{ count: number }>(
        "MATCH (e:Episode) RETURN count(e) AS count",
      ),
    );
    const report = {
      measuredAt: new Date().toISOString(),
      layer:
        "Authorized application graph-service layer; real FalkorDB, not a public-network HTTP benchmark",
      database: "FalkorDB 4.16.3 (Compose image)",
      node: process.version,
      platform: platform(),
      cpu: cpus()[0]?.model,
      concurrency,
      peakActive,
      operations,
      readOperations: readTimes.length,
      writeOperations: writeTimes.length,
      failures,
      durationMs: Math.round(durationMs),
      operationsPerSecond: Number(
        (operations / (durationMs / 1000)).toFixed(2),
      ),
      readLatencyMs: {
        p50: percentile(readTimes, 0.5),
        p95: percentile(readTimes, 0.95),
        p99: percentile(readTimes, 0.99),
      },
      writeLatencyMs: {
        p50: percentile(writeTimes, 0.5),
        p95: percentile(writeTimes, 0.95),
        p99: percentile(writeTimes, 0.99),
      },
      correctness: {
        expectedWrites,
        persistedWrites: persisted[0].count,
        otherWorkspaceEpisodes: isolated[0].count,
      },
      limitations:
        "Local measurement on this machine, alongside other processes. Writes are serialized by FalkorDB per graph. No production throughput or latency guarantee is implied.",
    };
    await mkdir("docs/benchmarks", { recursive: true });
    await writeFile(
      "docs/benchmarks/latest.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(JSON.stringify(report, null, 2));
    if (
      failures ||
      persisted[0].count !== expectedWrites ||
      isolated[0].count !== 0
    )
      throw new Error("Load-test correctness checks failed.");
  } finally {
    const db = await getDatabase();
    for (const name of [...graphs, process.env.AFTERSHOCK_CONTROL_GRAPH!])
      await db
        .selectGraph(name)
        .delete()
        .catch(() => {});
    await closeGraph();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
