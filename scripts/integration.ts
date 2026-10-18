import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  closeGraph,
  getGraph,
  memories,
  query,
  resolveInvestigation,
  seedGraph,
  setConstraint,
  snapshot,
} from "../src/lib/graph";
import { investigate } from "../src/lib/agent";

// Isolated graph, never the user's working incident graph.
process.env.FALKORDB_GRAPH = `aftershock_test_${randomUUID().replaceAll("-", "")}`;
delete process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;

async function main() {
  try {
    await seedGraph();
    await seedGraph();
    assert.equal((await snapshot()).nodes.length, 10, "seeding is idempotent");
    const baseline = await investigate();
    assert.equal(baseline.action, "rollback");
    assert.deepEqual([...baseline.affected].sort(), [
      "acme",
      "orbit",
      "orders",
      "storefront",
    ]);
    assert.equal(baseline.recalled, 1);
    assert.equal(baseline.owners.length, 2);
    await setConstraint(true);
    await assert.rejects(
      () => resolveInvestigation(baseline.id),
      /constraints changed/,
    );
    const revised = await investigate();
    assert.equal(revised.action, "disable_flag");
    assert.equal((await snapshot()).blocked, true);
    await resolveInvestigation(revised.id);
    await resolveInvestigation(revised.id);
    assert.equal(
      (await memories()).length,
      2,
      "duplicate resolutions do not duplicate memory",
    );
    await closeGraph();
    const remembered = await investigate();
    assert.equal(remembered.recalled, 2, "memory survives connection restart");
    assert.equal(remembered.scope, "sandbox");
    // Prove the blast radius comes from edges, not the fixture or a canned answer.
    await query("MATCH (:Customer {id: 'orbit'})-[r:USES]->() DELETE r");
    const changed = await investigate();
    assert.ok(!changed.affected.includes("orbit"));
    await setConstraint(false);
    assert.equal((await investigate()).action, "rollback");
    const stale = await investigate();
    await setConstraint(true);
    await setConstraint(false);
    await assert.rejects(
      () => resolveInvestigation(stale.id),
      /constraints changed/,
      "revision detects changes even when the final boolean matches",
    );
    console.log(
      "PASS: real FalkorDB traversal, constraint revision, stale result rejection, idempotent persistent memory, and edge-sensitive decisions.",
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
