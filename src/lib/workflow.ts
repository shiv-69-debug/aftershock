import { randomUUID } from "node:crypto";
import { actionFacts, decide, POLICY_VERSION } from "./decision";
import { investigate } from "./agent";
import { query, readQuery } from "./graph";
import type {
  AgentHandoff,
  Investigation,
  SandboxProbe,
  SandboxReceipt,
  SandboxState,
} from "./types";

async function handoffById(id: string): Promise<AgentHandoff> {
  const rows = await readQuery<{ payload: string }>(
    "MATCH (h:AgentHandoff {id:$id}) RETURN h.payload AS payload",
    { id },
  );
  if (!rows.length) throw new Error("Handoff not found.");
  return JSON.parse(rows[0].payload);
}

async function receiptForHandoff(id: string): Promise<SandboxReceipt | null> {
  const rows = await readQuery<{ payload: string }>(
    "MATCH (a:SandboxAction)-[:CONSUMED]->(:AgentHandoff {id:$id}) RETURN a.payload AS payload",
    { id },
  );
  return rows.length ? JSON.parse(rows[0].payload) : null;
}

export async function sandboxState(id: string): Promise<SandboxState> {
  const rows = await readQuery<SandboxState>(
    `MATCH (s:SandboxState {id:$id}) RETURN s.id AS id, s.release AS release, s.fastPayments AS fastPayments,
    s.timeoutMs AS timeoutMs, s.latencyMs AS latencyMs, s.revision AS revision`,
    { id },
  );
  if (!rows.length) throw new Error("Sandbox not found.");
  return rows[0];
}

/** A reproducible request simulator, not a real payment call or production health check. */
export function probeSandbox(state: SandboxState): SandboxProbe {
  return {
    outcome: state.latencyMs <= state.timeoutMs ? "ok" : "timeout",
    timeoutMs: state.timeoutMs,
    latencyMs: state.latencyMs,
    model: "deterministic-request-replay",
  };
}

export async function verifyReceipt(receipt: SandboxReceipt) {
  const current = await sandboxState(receipt.after.id);
  const probe = probeSandbox(current);
  const matchesReceipt = (
    Object.keys(receipt.after) as (keyof SandboxState)[]
  ).every((key) => current[key] === receipt.after[key]);
  return {
    verified:
      matchesReceipt &&
      receipt.beforeProbe.outcome === "timeout" &&
      probe.outcome === "ok",
    matchesReceipt,
    probe,
    current,
  };
}

export async function createHandoff(runId: string): Promise<AgentHandoff> {
  const existing = await readQuery<{ payload: string }>(
    "MATCH (h:AgentHandoff {runId:$runId}) RETURN h.payload AS payload",
    { runId },
  );
  if (existing.length) return JSON.parse(existing[0].payload);
  const rows = await readQuery<{ payload: string }>(
    "MATCH (r:Investigation {id:$runId}) RETURN r.payload AS payload",
    { runId },
  );
  if (!rows.length) throw new Error("Investigation not found.");
  const run: Investigation = JSON.parse(rows[0].payload);
  if (run.policyVersion !== POLICY_VERSION || run.scope !== "sandbox")
    throw new Error(
      "This legacy investigation is not eligible. Re-investigate with current evidence.",
    );
  const checked = decide(run.traces, run.mode, run.revision);
  if (
    checked.action === "hold" ||
    checked.action !== run.action ||
    checked.evidenceDigest !== run.evidenceDigest
  )
    throw new Error(
      "The investigation does not contain a supported sandbox proposal.",
    );
  const facts = actionFacts.parse(
    run.traces.find((trace) => trace.tool === "inspect_deployment")!.rows[0],
  );
  const id = randomUUID();
  const handoff: AgentHandoff = {
    id,
    runId,
    from: "investigator-v2",
    to: "responder-v1",
    status: "pending",
    action: checked.action,
    revision: run.revision,
    evidenceDigest: checked.evidenceDigest!,
    evidenceIds: checked.supportingEvidenceIds!,
    createdAt: new Date().toISOString(),
    sandboxId: `sandbox-${id}`,
  };
  const saved = await query<{ payload: string }>(
    `MATCH (r:Investigation {id:$runId})-[:INVESTIGATED]->(d:Deployment)
    WHERE d.revision=$revision
    MATCH (e) WHERE e.id IN $evidenceIds
    WITH r, d, collect(DISTINCT e) AS evidence WHERE size(evidence)=size($evidenceIds)
    MERGE (h:AgentHandoff {runId:$runId}) ON CREATE SET h.id=$id, h.status='pending', h.createdAt=$createdAt, h.payload=$payload, h.sandboxId=$sandboxId
    MERGE (sender:Agent {id:'investigator-v2'}) MERGE (receiver:Agent {id:'responder-v1'})
    MERGE (sender)-[:CREATED]->(h) MERGE (h)-[:ASSIGNED_TO]->(receiver) MERGE (h)-[:BASED_ON]->(r)
    MERGE (s:SandboxState {id:h.sandboxId}) ON CREATE SET s.release='v2.4.7', s.fastPayments=true, s.timeoutMs=$timeoutMs, s.latencyMs=$latencyMs, s.revision=0
    MERGE (h)-[:TARGETS]->(s)
    WITH h, evidence UNWIND evidence AS e MERGE (h)-[:SUPPORTED_BY]->(e)
    RETURN DISTINCT h.payload AS payload`,
    {
      id,
      runId,
      revision: run.revision,
      evidenceIds: handoff.evidenceIds,
      createdAt: handoff.createdAt,
      payload: JSON.stringify(handoff),
      sandboxId: handoff.sandboxId,
      timeoutMs: facts.timeoutMs,
      latencyMs: facts.latencyMs,
    },
  );
  if (!saved.length)
    throw new Error(
      "The graph changed or a source is missing. Re-investigate before handing off.",
    );
  return JSON.parse(saved[0].payload);
}

/** Responder agent: reads only persisted handoff state, rechecks evidence, applies one allowed mutation. */
export async function consumeHandoff(id: string): Promise<SandboxReceipt> {
  const existing = await receiptForHandoff(id);
  if (existing) return existing;
  const handoff = await handoffById(id);
  if (handoff.to !== "responder-v1" || handoff.status !== "pending")
    throw new Error("This handoff cannot be consumed by the responder.");
  const checked = await investigate(
    () => {},
    "Revalidate persisted sandbox handoff before execution",
    { toolSelection: "fixed" },
  );
  if (
    checked.action === "hold" ||
    checked.action !== handoff.action ||
    checked.revision !== handoff.revision ||
    checked.evidenceDigest !== handoff.evidenceDigest
  )
    throw new Error(
      "Handoff evidence changed or no longer supports this action. Create a new investigation and handoff.",
    );
  const facts = actionFacts.parse(
    checked.traces.find((trace) => trace.tool === "inspect_deployment")!
      .rows[0],
  );
  const before = await sandboxState(handoff.sandboxId);
  if (
    before.revision !== 0 ||
    !before.fastPayments ||
    before.release !== "v2.4.7" ||
    before.timeoutMs !== facts.timeoutMs ||
    before.latencyMs !== facts.latencyMs
  ) {
    const raced = await receiptForHandoff(id);
    if (raced) return raced;
    throw new Error(
      "Sandbox state no longer matches the handoff's initial target.",
    );
  }
  const after: SandboxState = {
    ...before,
    fastPayments: false,
    release:
      checked.action === "rollback" ? facts.rollbackTarget : before.release,
    timeoutMs:
      checked.action === "rollback"
        ? facts.previousTimeoutMs
        : facts.flagOffTimeoutMs,
    revision: before.revision + 1,
  };
  const receipt: SandboxReceipt = {
    id: randomUUID(),
    handoffId: id,
    runId: handoff.runId,
    verificationRunId: checked.id,
    action: checked.action,
    createdAt: new Date().toISOString(),
    before,
    after,
    beforeProbe: probeSandbox(before),
    afterProbe: probeSandbox(after),
    evidenceIds: handoff.evidenceIds,
  };
  if (
    receipt.beforeProbe.outcome !== "timeout" ||
    receipt.afterProbe.outcome !== "ok"
  )
    throw new Error(
      "This proposed mutation does not pass the sandbox replay preconditions.",
    );
  const saved = await query<{ payload: string }>(
    `MATCH (h:AgentHandoff {id:$id})-[:TARGETS]->(s:SandboxState), (d:Deployment {id:'deploy-247'}), (v:Investigation {id:$verificationId}), (agent:Agent {id:'responder-v1'})
    WHERE h.status='pending' AND d.revision=$revision AND s.revision=$beforeRevision
    AND s.release=$beforeRelease AND s.timeoutMs=$beforeTimeout AND s.latencyMs=$beforeLatency AND s.fastPayments=true
    SET s.release=$release, s.fastPayments=false, s.timeoutMs=$timeout, s.revision=$afterRevision,
    h.status='completed', h.payload=$handoffPayload
    CREATE (a:SandboxAction {id:$actionId, payload:$payload, createdAt:$createdAt, scope:'sandbox'})
    CREATE (agent)-[:EXECUTED]->(a) CREATE (a)-[:CONSUMED]->(h) CREATE (a)-[:CHANGED]->(s) CREATE (a)-[:CHECKED_WITH]->(v)
    RETURN a.payload AS payload`,
    {
      id,
      verificationId: checked.id,
      revision: handoff.revision,
      beforeRevision: before.revision,
      beforeRelease: before.release,
      beforeTimeout: before.timeoutMs,
      beforeLatency: before.latencyMs,
      release: after.release,
      timeout: after.timeoutMs,
      afterRevision: after.revision,
      actionId: receipt.id,
      payload: JSON.stringify(receipt),
      createdAt: receipt.createdAt,
      handoffPayload: JSON.stringify({ ...handoff, status: "completed" }),
    },
  );
  if (!saved.length) {
    const raced = await receiptForHandoff(id);
    if (raced) return raced;
    throw new Error(
      "Concurrent state change prevented execution. No sandbox mutation was committed by this request.",
    );
  }
  return JSON.parse(saved[0].payload);
}

export async function workflowStatus() {
  const rows = await readQuery<{
    handoff: string;
    receipt: string | null;
  }>(`MATCH (h:AgentHandoff) OPTIONAL MATCH (a:SandboxAction)-[:CONSUMED]->(h)
    RETURN h.payload AS handoff, a.payload AS receipt ORDER BY h.createdAt DESC LIMIT 10`);
  return Promise.all(
    rows.map(async (row) => {
      const handoff: AgentHandoff = JSON.parse(row.handoff);
      const receipt: SandboxReceipt | null = row.receipt
        ? JSON.parse(row.receipt)
        : null;
      const verification = receipt
        ? await verifyReceipt(receipt).catch(() => ({
            verified: false,
            matchesReceipt: false,
            probe: null,
            current: null,
          }))
        : null;
      return { handoff, receipt, verification };
    }),
  );
}
