import { FalkorDB } from "falkordb";
import { AsyncLocalStorage } from "node:async_hooks";
import { nodes, edges, migration } from "./scenario";
import type { GraphSnapshot, Investigation, Memory } from "./types";

type Graph = ReturnType<FalkorDB["selectGraph"]>;
export type QueryValue =
  | null
  | string
  | number
  | boolean
  | QueryValue[]
  | { [key: string]: QueryValue };
export type QueryParameters = Record<string, QueryValue>;
const globalDb = globalThis as unknown as { aftershockDb?: Promise<FalkorDB> };
const graphScope = new AsyncLocalStorage<string>();

/** Only trusted server authorization code may select a graph scope. */
export function withGraph<T>(
  graphName: string,
  operation: () => Promise<T>,
): Promise<T> {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(graphName))
    throw new Error("Invalid internal graph name");
  return graphScope.run(graphName, operation);
}

export async function getDatabase(): Promise<FalkorDB> {
  if (!globalDb.aftershockDb) {
    // The client forwards this to node-redis, although its public socket type omits it.
    const socket = {
      host: process.env.FALKORDB_HOST || "127.0.0.1",
      port: Number(process.env.FALKORDB_PORT || 6379),
      connectTimeout: 3000,
      reconnectStrategy: false as const,
    };
    globalDb.aftershockDb = FalkorDB.connect({
      socket,
      password: process.env.FALKORDB_PASSWORD || undefined,
    })
      .then((db) => {
        db.on("error", () => {
          globalDb.aftershockDb = undefined;
        });
        return db;
      })
      .catch((error: unknown) => {
        globalDb.aftershockDb = undefined;
        throw error;
      });
  }
  return globalDb.aftershockDb;
}

export async function getGraph(): Promise<Graph> {
  return (await getDatabase()).selectGraph(
    graphScope.getStore() || process.env.FALKORDB_GRAPH || "aftershock",
  );
}

export async function closeGraph() {
  const pending = globalDb.aftershockDb;
  globalDb.aftershockDb = undefined;
  if (pending) await (await pending).close();
}

export async function query<T extends Record<string, unknown>>(
  cypher: string,
  params: QueryParameters = {},
): Promise<T[]> {
  const graph = await getGraph();
  const result = await graph.query<T>(cypher, { params, TIMEOUT: 5000 });
  return result.data || [];
}

export async function readQuery<T extends Record<string, unknown>>(
  cypher: string,
  params: QueryParameters = {},
): Promise<T[]> {
  try {
    return (
      (await (await getGraph()).roQuery<T>(cypher, { params, TIMEOUT: 5000 }))
        .data || []
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /empty key|graph.+does not exist|non.?existing graph/i.test(error.message)
    )
      return [];
    throw error;
  }
}

export async function seedGraph() {
  // Labels and relationship names are constants from our fixture, never user input.
  for (const node of nodes) {
    await query(
      `MERGE (n:${node.kind} {id: $id}) ON CREATE SET n.revision=0 SET n.name=$name, n.kind=$kind,
      n.detail=$detail, n.source=$source, n.x=$x, n.y=$y`,
      { ...node },
    );
  }
  for (const edge of edges) {
    await query(
      `MATCH (a {id: $source}), (b {id: $target}) MERGE (a)-[:${edge.relation}]->(b)`,
      { ...edge },
    );
  }
  await query(
    `MATCH (i:Incident {id: 'incident-189'}) SET i.action='rollback', i.createdAt='2026-10-10T11:00:00Z',i.recordType='historical'`,
  );
  // Versioned migration adds affirmative evidence without overwriting audit records.
  await query(`MATCH (d:Deployment {id:'deploy-247'}), (p:Service {id:'payments'})
    WHERE d.evidenceVersion IS NULL
    SET d.evidenceVersion=2, d.timeoutMs=800, d.previousTimeoutMs=5000, d.revision=coalesce(d.revision,0)+1, p.latencyMs=1240
    MERGE (r:Runbook {id:'checkout-runbook'})
    ON CREATE SET r.name='Checkout sandbox runbook', r.source='runbooks/checkout/sandbox-v2',
    r.detail='Synthetic runbook: only the isolated sandbox may roll back to v2.4.6 or disable fast_payments. Both restore 5000ms. Baseline rollback compatibility is explicitly confirmed; current constraints override it. This is not production authorization.',
    r.flagName='fast_payments', r.flagOffTimeoutMs=5000, r.flagAllowed=true,
    r.rollbackTarget='v2.4.6', r.rollbackAllowed=true, r.rollbackCompatible=true, r.sandboxOnly=true
    MERGE (d)-[:HAS_RUNBOOK]->(r)`);
  await query(`MATCH (c:Constraint {id:'migration-88'}), (d:Deployment {id:'deploy-247'})
    WHERE c.policyVersion IS NULL AND c.source='migrations/88/compatibility-check'
    SET c.policyVersion=2, c.blockedAction='rollback', c.flagMitigationAllowed=true, d.revision=d.revision+1`);
}

export async function snapshot(): Promise<GraphSnapshot> {
  const graphNodes = await readQuery<
    GraphSnapshot["nodes"][number]
  >(`MATCH (n) WHERE n.x IS NOT NULL AND (n.kind <> 'Constraint' OR n.active = true)
    RETURN n.id AS id, n.name AS name, n.kind AS kind, n.detail AS detail, n.source AS source, n.x AS x, n.y AS y`);
  const graphEdges = await readQuery<
    GraphSnapshot["edges"][number]
  >(`MATCH (a)-[r]->(b) WHERE a.x IS NOT NULL AND b.x IS NOT NULL
    AND (a.kind <> 'Constraint' OR a.active = true)
    RETURN a.id AS source, b.id AS target, type(r) AS relation`);
  return {
    nodes: graphNodes,
    edges: graphEdges,
    blocked: graphNodes.some((n) => n.id === migration.id),
  };
}

export async function setConstraint(active: boolean) {
  const deployment = await readQuery(
    "MATCH (d:Deployment {id: 'deploy-247'}) RETURN d.id AS id",
  );
  if (!deployment.length) throw new Error("Load the scenario first.");
  await query(
    `MATCH (d:Deployment {id: 'deploy-247'})
    MERGE (c:Constraint {id: $id}) SET c.name=$name, c.kind=$kind, c.detail=$detail,
    c.source=$source, c.x=$x, c.y=$y, c.active=$active, c.blockedAction='rollback', c.flagMitigationAllowed=true, d.revision=coalesce(d.revision, 0)+1
    MERGE (c)-[:BLOCKS]->(d)`,
    { ...migration, active },
  );
}

export async function saveInvestigation(investigation: Investigation) {
  const saved = await query(
    `MATCH (d:Deployment {id: 'deploy-247'}) WHERE d.revision=$revision
    CREATE (r:Investigation {id: $id, createdAt: $createdAt, payload: $payload})
    CREATE (r)-[:INVESTIGATED]->(d) RETURN r.id AS id`,
    {
      id: investigation.id,
      revision: investigation.revision,
      createdAt: investigation.createdAt,
      payload: JSON.stringify(investigation),
    },
  );
  if (!saved.length)
    throw new Error(
      "Graph constraints changed during investigation. Please re-investigate.",
    );
}

export async function resolveInvestigation(id: string): Promise<Memory> {
  const runs = await readQuery<{ payload: string }>(
    "MATCH (r:Investigation {id: $id}) RETURN r.payload AS payload",
    { id },
  );
  if (!runs.length)
    throw new Error("Investigation not found. Run an investigation first.");
  const investigation: Investigation = JSON.parse(runs[0].payload);
  if (investigation.action === "hold" || investigation.policyVersion !== 2)
    throw new Error(
      "This investigation does not authorize a mitigation. Re-investigate with current evidence.",
    );
  const memory: Memory = {
    id: `memory-${id}`,
    name: `Simulation note · ${id.slice(0, 8)}`,
    detail: `Operator recorded a simulated resolution: ${investigation.action === "disable_flag" ? "disabled fast_payments while schema migration blocked rollback" : "rolled back checkout after checking that no active constraint blocked it"}. ${investigation.rationale} Outcome is operator-reported, not verified against production telemetry.`,
    action: investigation.action,
    createdAt: new Date().toISOString(),
    source: `resolutions/${id}`,
  };
  // MERGE makes repeated resolution requests idempotent.
  const saved = await query(
    `MATCH (r:Investigation {id: $runId})-[:INVESTIGATED]->(d:Deployment)-[:DEPLOYED_TO]->(s:Service)
    WHERE d.revision=$revision
    MERGE (i:Incident {id: $id}) ON CREATE SET i.name=$name, i.detail=$detail, i.action=$action,
    i.createdAt=$createdAt, i.source=$source, i.kind='Incident',i.recordType='operator_note'
    MERGE (i)-[:AFFECTED]->(s) MERGE (i)-[:LEARNED_FROM]->(r)
    RETURN i.id AS id`,
    { ...memory, runId: id, revision: investigation.revision },
  );
  if (!saved.length)
    throw new Error(
      "Graph constraints changed. Re-investigate before recording a resolution.",
    );
  return memory;
}

export async function memories(): Promise<Memory[]> {
  return readQuery<Memory>(`MATCH (i:Incident) RETURN i.id AS id, i.name AS name, i.detail AS detail,
    i.action AS action, i.createdAt AS createdAt, i.source AS source,
    CASE WHEN i.id='incident-189' OR i.recordType='historical' THEN 0 ELSE 1 END AS priority ORDER BY priority,i.createdAt DESC LIMIT 30`);
}
