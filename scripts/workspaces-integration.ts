import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getDatabase, closeGraph, query, readQuery } from "../src/lib/graph";
import {
  register,
  login,
  createWorkspace,
  accessWorkspace,
  createWorkspaceToken,
  authenticateWorkspaceToken,
  inviteMember,
  inWorkspace,
} from "../src/lib/workspaces/identity";
import {
  importDataset,
  traceImpact,
  shortestDependencyPath,
  serviceRank,
  activeDataset,
} from "../src/lib/workspaces/catalog";
import {
  appendEpisode,
  recallWorkspace,
  recordFact,
  saveProcedure,
  createConversation,
  appendMessage,
  conversationMessages,
} from "../src/lib/workspaces/memory";
import { callWorkspaceTool } from "../src/lib/workspaces/mcp";

process.env.AFTERSHOCK_CONTROL_GRAPH = `as_control_test_${randomUUID().replaceAll("-", "")}`;
const graphs: string[] = [];
const fixture = {
  name: "Imported application",
  source: { title: "Fixture source" },
  services: ["checkout", "payments", "orders", "web"].map((id) => ({
    id,
    name: id,
  })),
  dependencies: [
    { from: "checkout", to: "payments" },
    { from: "orders", to: "checkout" },
    { from: "web", to: "orders" },
  ],
  customers: [
    { id: "acme", name: "Acme", uses: ["orders"] },
    { id: "orbit", name: "Orbit", uses: ["web"] },
  ],
};

async function main() {
  try {
    const alice = await register("alice", "Test-password-for-alice-2026"),
      bob = await register("bob", "Test-password-for-bob-2026");
    assert.equal(
      (await login("alice", "Test-password-for-alice-2026")).id,
      alice.id,
    );
    await assert.rejects(() => login("alice", "wrong-password"), /Invalid/);
    const a = await createWorkspace(alice, "Alice workspace"),
      b = await createWorkspace(bob, "Bob workspace");
    graphs.push(a.graphName, b.graphName);
    await assert.rejects(() => accessWorkspace(bob, a.id), /not found/);
    const token = await createWorkspaceToken(a);
    assert.equal((await authenticateWorkspaceToken(token, a.id)).id, a.id);
    await assert.rejects(
      () => authenticateWorkspaceToken(token, b.id),
      /Invalid/,
    );
    await inWorkspace(a, async () => {
      await importDataset(fixture, alice.id);
      const depth1 = await traceImpact("checkout", 1),
        depth3 = await traceImpact("checkout", 3);
      assert.equal(depth1.paths.length, 1);
      assert.equal(depth3.paths.length, 4);
      const path = await shortestDependencyPath("orbit", "checkout");
      assert.deepEqual(path.paths[0].path, [
        "Orbit",
        "web",
        "orders",
        "checkout",
      ]);
      assert.equal(path.paths[0].weight, 3);
      assert.equal((await serviceRank()).rows.length, 4);
      await assert.rejects(() => readQuery("CREATE (:UnauthorizedWrite)"));
      const source = (await activeDataset())!.id;
      await appendEpisode(a, {
        kind: "historical",
        topic: "checkout",
        text: "Historical incident evidence",
        sourceIds: [source],
        visibility: "workspace",
      });
      await appendEpisode(a, {
        kind: "operator_note",
        topic: "private",
        text: "Alice-only note",
        sourceIds: [],
        visibility: "private",
      });
      for (let i = 0; i < 12; i++)
        await appendEpisode(a, {
          kind: "operator_note",
          topic: "checkout",
          text: `Repeated note ${i}`,
          sourceIds: [],
          visibility: "workspace",
        });
      const memory = await recallWorkspace(a, "checkout");
      assert.equal(memory.history.length, 1);
      assert.equal(memory.notes.length, 3);
      await recordFact(a, {
        subjectId: "checkout",
        predicate: "VERSION",
        objectId: "v1",
        sourceIds: [source],
        accept: true,
      });
      await recordFact(a, {
        subjectId: "checkout",
        predicate: "VERSION",
        objectId: "v2",
        sourceIds: [source],
        accept: true,
      });
      const versions = await readQuery(
        "MATCH (f:SemanticFact {predicate:'VERSION'}) WHERE f.validTo IS NULL RETURN f.objectId AS value",
      );
      assert.deepEqual(
        versions.map((row) => row.value),
        ["v2"],
      );
      const procedure = await saveProcedure(a, {
        expectedVersion: 0,
        name: "Inspect checkout",
        topic: "checkout",
        description: "Read paths and source records",
        action: "investigate",
        steps: ["read_dependencies", "read_sources"],
        sourceIds: [source],
        publish: true,
      });
      await assert.rejects(
        () =>
          saveProcedure(a, {
            id: procedure.id,
            expectedVersion: 0,
            name: "Stale update",
            topic: "checkout",
            description: "Must fail",
            action: "investigate",
            steps: ["read_sources"],
            sourceIds: [source],
            publish: true,
          }),
        /version changed/,
      );
      const conversation = await createConversation(a, "Persistent session");
      await appendMessage(a, conversation, "user", "What depends on checkout?");
      await closeGraph();
      assert.equal((await conversationMessages(a, conversation)).length, 1);
      await inviteMember(a, "bob", "reader");
      const reader = await accessWorkspace(bob, a.id);
      await assert.rejects(
        () => conversationMessages(reader, conversation),
        /not found/,
      );
      assert.equal((await recallWorkspace(reader, "private")).notes.length, 0);
      await assert.rejects(
        () =>
          appendEpisode(reader, {
            kind: "operator_note",
            topic: "x",
            text: "no",
            sourceIds: [],
            visibility: "workspace",
          }),
        /Read-only/,
      );
    });
    const protocol = await callWorkspaceTool(a, "shortest_dependency_path", {
      from: "orbit",
      to: "checkout",
      maxDepth: 6,
    });
    assert.equal(protocol.algorithm, "algo.SPpaths");
    await inWorkspace(b, async () => {
      assert.equal(
        (await readQuery("MATCH (s:Service) RETURN s.id AS id")).length,
        0,
      );
    });
    console.log(
      "PASS: credentials, workspace and token isolation, private conversations, reader restrictions, explicit hop paths, SPpaths, PageRank, database-enforced read-only tools, history priority, temporal facts, and procedure version conflicts.",
    );
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
