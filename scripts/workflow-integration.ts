import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeGraph,
  getGraph,
  query,
  seedGraph,
  setConstraint,
} from "../src/lib/graph";
import { investigate } from "../src/lib/agent";
import {
  consumeHandoff,
  createHandoff,
  probeSandbox,
  sandboxState,
  verifyReceipt,
  workflowStatus,
} from "../src/lib/workflow";

process.env.FALKORDB_GRAPH = `aftershock_workflow_test_${randomUUID().replaceAll("-", "")}`;
process.env.AI_PROVIDER = "openai";
process.env.OPENAI_API_KEY = "";
process.env.GROQ_API_KEY = "";

async function main() {
  try {
    const legacyId = randomUUID();
    await query(
      "CREATE (d:Deployment {id:'deploy-247'}) CREATE (r:Investigation {id:$id, payload:$payload}) CREATE (r)-[:INVESTIGATED]->(d)",
      {
        id: legacyId,
        payload: JSON.stringify({ id: legacyId, action: "rollback" }),
      },
    );
    await seedGraph();
    assert.equal(
      (
        await query("MATCH (r:Investigation {id:$id}) RETURN r.id AS id", {
          id: legacyId,
        })
      ).length,
      1,
      "seed migration preserves legacy audit records",
    );
    await assert.rejects(() => createHandoff(legacyId), /legacy investigation/);
    await setConstraint(true);
    const run = await investigate();
    assert.equal(run.action, "disable_flag");
    const h = await createHandoff(run.id);
    assert.equal(
      (await createHandoff(run.id)).id,
      h.id,
      "handoff creation is idempotent",
    );
    assert.equal(
      probeSandbox(await sandboxState(h.sandboxId)).outcome,
      "timeout",
    );
    await closeGraph();
    const output = execFileSync(
      process.execPath,
      ["--import", "tsx", "scripts/consume-handoff.ts", h.id],
      { encoding: "utf8", env: process.env, timeout: 30000 },
    );
    const { receipt, verification } = JSON.parse(output.trim());
    assert.equal(verification.verified, true);
    assert.equal(receipt.before.fastPayments, true);
    assert.equal(receipt.after.fastPayments, false);
    assert.equal(receipt.afterProbe.outcome, "ok");
    const retries = await Promise.all([
      consumeHandoff(h.id),
      consumeHandoff(h.id),
    ]);
    assert.equal(retries[0].id, receipt.id);
    assert.equal(retries[1].id, receipt.id);
    assert.equal(
      (await sandboxState(h.sandboxId)).revision,
      1,
      "only one mutation occurred",
    );
    const path = await query<{ count: number }>(
      `MATCH (:Agent {id:'responder-v1'})-[:EXECUTED]->(:SandboxAction {id:$id})-[:CONSUMED]->(h:AgentHandoff)-[:BASED_ON]->(:Investigation)
      MATCH (h)-[:SUPPORTED_BY]->(e) RETURN count(DISTINCT e) AS count`,
      { id: receipt.id },
    );
    assert.ok(path[0].count >= 3, "execution is connected to its evidence");
    assert.equal((await workflowStatus())[0].handoff.status, "completed");
    await query("MATCH (s:SandboxState {id:$id}) SET s.timeoutMs=10", {
      id: h.sandboxId,
    });
    assert.equal(
      (await verifyReceipt(receipt)).verified,
      false,
      "verification detects target tampering",
    );
    const staleRun = await investigate();
    const staleHandoff = await createHandoff(staleRun.id);
    await setConstraint(false);
    await assert.rejects(
      () => consumeHandoff(staleHandoff.id),
      /evidence changed/,
    );
    assert.equal((await sandboxState(staleHandoff.sandboxId)).revision, 0);
    const baseline = await investigate();
    const pending = await createHandoff(baseline.id);
    const concurrent = await Promise.all([
      consumeHandoff(pending.id),
      consumeHandoff(pending.id),
    ]);
    assert.equal(
      concurrent[0].id,
      concurrent[1].id,
      "concurrent consumers share one receipt",
    );
    await query(
      "MATCH (:Service {id:'checkout'})-[r:DEPENDS_ON]->(:Service {id:'payments'}) DELETE r",
    );
    const unsupported = await investigate();
    assert.equal(unsupported.action, "hold");
    await assert.rejects(
      () => createHandoff(unsupported.id),
      /supported sandbox proposal/,
    );
    console.log(
      "PASS: persisted handoff, separate responder, idempotent sandbox mutation, evidence provenance, replay verification, tamper detection, stale-context rejection, and unsupported-action hold.",
    );
  } finally {
    await (await getGraph()).delete();
    await closeGraph();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
