import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query, readQuery } from "../graph";
import {
  AccessError,
  type WorkspaceAccess,
  workspaceRevision,
} from "./identity";
import { activeDataset, datasetAt } from "./catalog";
import { verifyReceipt } from "../workflow";
import type { SandboxReceipt } from "../types";

export type Episode = {
  id: string;
  kind: string;
  topic: string;
  text: string;
  createdAt: string;
  authorId: string;
  verified: boolean;
  sourceIds: string[];
  visibility: string;
  revision: number;
};
export const episodeInput = z.object({
  kind: z.enum(["historical", "operator_note", "observation"]),
  topic: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(6000),
  sourceIds: z.array(z.string().max(250)).max(20).default([]),
  visibility: z.enum(["private", "workspace"]).default("workspace"),
  ttlDays: z.number().int().min(1).max(3650).optional(),
});

async function ensureSources(access: WorkspaceAccess, ids: string[]) {
  if (!ids.length) return;
  const rows = await readQuery<{ id: string }>(
    "MATCH (n) WHERE n.id IN $ids AND (any(label IN labels(n) WHERE label IN ['Dataset','SourceDocument','SandboxAction','ProcedureVersion']) OR ('Episode' IN labels(n) AND (n.visibility='workspace' OR n.authorId=$user))) RETURN DISTINCT n.id AS id",
    { ids, user: access.userId },
  );
  if (new Set(rows.map((row) => row.id)).size !== new Set(ids).size)
    throw new AccessError("A source does not exist in this workspace.", 400);
}

export async function appendEpisode(
  access: WorkspaceAccess,
  input: z.infer<typeof episodeInput>,
) {
  if (access.role === "reader") throw new AccessError("Read-only workspace.");
  await ensureSources(access, input.sourceIds);
  const id = randomUUID(),
    at = new Date().toISOString(),
    revision = await workspaceRevision();
  await query(
    `CREATE (e:Episode {id:$id,kind:$kind,topic:$topic,text:$text,createdAt:$at,authorId:$user,visibility:$visibility,verified:false,sourceIds:$sources,revision:$revision,expiresAt:$expires})`,
    {
      id,
      kind: input.kind,
      topic: input.topic,
      text: input.text,
      at,
      user: access.userId,
      visibility: input.visibility,
      sources: input.sourceIds,
      revision,
      expires: input.ttlDays ? Date.now() + input.ttlDays * 86400000 : 0,
    },
  );
  if (input.sourceIds.length)
    await query(
      "MATCH (e:Episode {id:$id}) UNWIND $sources AS source MATCH (s {id:source}) MERGE (e)-[:EVIDENCED_BY]->(s)",
      { id, sources: input.sourceIds },
    );
  return id;
}

export async function recallWorkspace(
  access: WorkspaceAccess,
  topic = "",
  asOf?: string,
) {
  const revision = await workspaceRevision();
  if (asOf && !Number.isFinite(Date.parse(asOf)))
    throw new AccessError("Invalid memory timestamp.", 400);
  const timestamp = new Date(asOf || Date.now()).toISOString();
  const params = {
    user: access.userId,
    topic: topic.toLowerCase(),
    now: Date.parse(timestamp),
    at: timestamp,
  };
  const projection =
    "e.id AS id,e.kind AS kind,e.topic AS topic,e.text AS text,e.createdAt AS createdAt,e.authorId AS authorId,e.visibility AS visibility,e.verified AS verified,e.sourceIds AS sourceIds,e.revision AS revision";
  const visible = `(e.visibility='workspace' OR e.authorId=$user) AND e.createdAt<=$at AND (e.expiresAt IS NULL OR e.expiresAt=0 OR e.expiresAt>$now) AND (e.retractedAt IS NULL OR e.retractedAt>$at)
    AND ($topic='' OR toLower(e.topic) CONTAINS $topic OR toLower(e.text) CONTAINS $topic)`;
  const [history, notes, observations] = await Promise.all([
    readQuery<Episode>(
      `MATCH (e:Episode) WHERE ${visible} AND (e.kind='historical' OR (e.kind='sandbox_outcome' AND e.verified=true)) RETURN ${projection} ORDER BY e.verified DESC,e.createdAt DESC LIMIT 8`,
      params,
    ),
    readQuery<Episode>(
      `MATCH (e:Episode) WHERE ${visible} AND e.kind='operator_note' RETURN ${projection} ORDER BY e.createdAt DESC LIMIT 3`,
      params,
    ),
    readQuery<Episode>(
      `MATCH (e:Episode) WHERE ${visible} AND (e.kind='observation' OR e.kind='investigation' OR e.kind='dataset_import') RETURN ${projection} ORDER BY e.createdAt DESC LIMIT 5`,
      params,
    ),
  ]);
  const dataset = asOf ? await datasetAt(timestamp) : await activeDataset();
  const facts = await readQuery<{
    id: string;
    subjectId: string;
    predicate: string;
    objectId: string;
    status: string;
    validFrom: string;
    validTo: string | null;
    source: string;
  }>(
    `MATCH (f:SemanticFact)
    WHERE f.validFrom<=$at AND (f.validTo IS NULL OR f.validTo>$at) AND f.status='accepted'
    AND (f.datasetId=$dataset OR f.datasetId='manual') AND ($topic='' OR toLower(f.subjectId) CONTAINS $topic OR toLower(f.predicate) CONTAINS $topic OR toLower(f.objectId) CONTAINS $topic)
    RETURN f.id AS id,f.subjectId AS subjectId,f.predicate AS predicate,f.objectId AS objectId,f.status AS status,f.validFrom AS validFrom,f.validTo AS validTo,f.source AS source ORDER BY f.validFrom DESC LIMIT 50`,
    { ...params, dataset: dataset?.id || "" },
  );
  const procedures = await listProcedures(access, topic, timestamp);
  return {
    history,
    notes,
    observations: observations.map((row) => ({
      ...row,
      stale:
        row.revision !== undefined &&
        row.revision !== null &&
        row.revision !== revision,
    })),
    facts,
    procedures,
    revision,
    asOf: timestamp,
    note: "Historical evidence is selected independently of recent notes. Notes are not independent verified lessons. Stale observations and proposed facts do not authorize actions.",
  };
}

export const factInput = z.object({
  subjectId: z.string().min(1).max(120),
  predicate: z.enum([
    "OWNED_BY",
    "VERSION",
    "STATUS",
    "DEPENDS_ON",
    "DOCUMENTED_AS",
  ]),
  objectId: z.string().min(1).max(300),
  sourceIds: z.array(z.string()).min(1).max(10),
  accept: z.boolean().default(false),
});

export async function recordFact(
  access: WorkspaceAccess,
  input: z.infer<typeof factInput>,
) {
  if (access.role === "reader" || (input.accept && access.role !== "owner"))
    throw new AccessError(
      "Only owners can accept facts; operators may propose them.",
    );
  await ensureSources(access, input.sourceIds);
  const id = randomUUID(),
    at = new Date().toISOString();
  const functional = ["OWNED_BY", "VERSION", "STATUS"].includes(
    input.predicate,
  );
  if (input.accept && functional) {
    await query(
      "MERGE (s:SemanticSlot {subjectId:$subject,predicate:$predicate}) ON CREATE SET s.revision=0,s.currentFactId=''",
      { subject: input.subjectId, predicate: input.predicate },
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      const slots = await readQuery<{
        revision: number;
        current: string;
        lastAt: number | null;
      }>(
        "MATCH (s:SemanticSlot {subjectId:$subject,predicate:$predicate}) RETURN s.revision AS revision,s.currentFactId AS current,s.lastAt AS lastAt",
        { subject: input.subjectId, predicate: input.predicate },
      );
      const slot = slots[0];
      const instant = Math.max(Date.now(), (slot.lastAt || 0) + 1);
      const result = await query<{ id: string }>(
        `MATCH (slot:SemanticSlot {subjectId:$subject,predicate:$predicate}) ${slot.current ? ", (old:SemanticFact {id:$old})" : ""}
        WHERE slot.revision=$revision SET slot.revision=slot.revision+1,slot.currentFactId=$id,slot.lastAt=$instant ${slot.current ? ", old.validTo=$at" : ""}
        CREATE (f:SemanticFact {id:$id,subjectId:$subject,predicate:$predicate,objectId:$object,status:'accepted',validFrom:$at,datasetId:'manual',source:$source,createdBy:$user})
        CREATE (slot)-[:HAS_VERSION]->(f) ${slot.current ? "CREATE (f)-[:SUPERSEDES]->(old) CREATE (f)-[:CONFLICTS_WITH]->(old)" : ""}
        WITH f UNWIND $sources AS source MATCH (s {id:source}) MERGE (f)-[:EVIDENCED_BY]->(s) RETURN DISTINCT f.id AS id`,
        {
          subject: input.subjectId,
          predicate: input.predicate,
          object: input.objectId,
          id,
          at: new Date(instant).toISOString(),
          instant,
          source: input.sourceIds.join(", "),
          user: access.userId,
          old: slot.current,
          revision: slot.revision,
          sources: input.sourceIds,
        },
      );
      if (result.length)
        return {
          id,
          status: "accepted",
          note: "The prior functional fact was superseded atomically. Imported topology remains unchanged.",
        };
    }
    throw new AccessError(
      "Concurrent fact update. Retry with fresh context.",
      409,
    );
  }
  await query(
    `CREATE (f:SemanticFact {id:$id,subjectId:$subject,predicate:$predicate,objectId:$object,status:$status,validFrom:$at,datasetId:'manual',source:$source,createdBy:$user})`,
    {
      id,
      subject: input.subjectId,
      predicate: input.predicate,
      object: input.objectId,
      status: input.accept ? "accepted" : "proposed",
      at,
      source: input.sourceIds.join(", "),
      user: access.userId,
    },
  );
  await query(
    "MATCH (f:SemanticFact {id:$id}) UNWIND $sources AS source MATCH (s {id:source}) MERGE (f)-[:EVIDENCED_BY]->(s)",
    { id, sources: input.sourceIds },
  );
  if (functional)
    await query(
      `MATCH (new:SemanticFact {id:$id}), (old:SemanticFact {subjectId:$subject,predicate:$predicate})
    WHERE old.id<>$id AND old.status='accepted' AND old.validTo IS NULL AND old.objectId<>$object
    MERGE (new)-[:CONFLICTS_WITH]->(old)`,
      {
        id,
        subject: input.subjectId,
        predicate: input.predicate,
        object: input.objectId,
      },
    );
  return {
    id,
    status: input.accept ? "accepted" : "proposed",
    note: "Semantic assertions retain source provenance and validity intervals. They do not silently rewrite imported topology.",
  };
}

export const procedureInput = z.object({
  id: z.string().max(80).optional(),
  expectedVersion: z.number().int().nonnegative().default(0),
  name: z.string().min(1).max(160),
  topic: z.string().min(1).max(120),
  description: z.string().min(1).max(3000),
  action: z.enum(["investigate", "rollback", "disable_flag"]),
  steps: z
    .array(
      z.enum([
        "read_dependencies",
        "read_owners",
        "read_sources",
        "recall_memory",
        "check_constraints",
        "verify_sandbox",
      ]),
    )
    .min(1)
    .max(6),
  sourceIds: z.array(z.string()).min(1).max(20),
  publish: z.boolean().default(false),
});

export async function saveProcedure(
  access: WorkspaceAccess,
  input: z.infer<typeof procedureInput>,
) {
  if (access.role !== "owner")
    throw new AccessError("Only workspace owners can version procedures.");
  await ensureSources(access, input.sourceIds);
  const id = input.id || randomUUID(),
    version = input.expectedVersion + 1,
    versionId = randomUUID(),
    at = new Date().toISOString();
  const saved = await query<{ id: string }>(
    `MERGE (p:Procedure {id:$id}) ON CREATE SET p.version=0
    WITH p WHERE p.version=$expected
    SET p.version=$version,p.currentVersion=$versionId,p.name=$name,p.topic=$topic
    CREATE (v:ProcedureVersion {id:$versionId,version:$version,name:$name,topic:$topic,description:$description,action:$action,steps:$steps,status:$status,sourceIds:$sources,createdAt:$at,authorId:$user,scope:'sandbox'})
    CREATE (p)-[:HAS_VERSION]->(v) RETURN v.id AS id`,
    {
      id,
      expected: input.expectedVersion,
      version,
      versionId,
      name: input.name,
      topic: input.topic,
      description: input.description,
      action: input.action,
      steps: input.steps,
      status: input.publish ? "published" : "draft",
      sources: input.sourceIds,
      at,
      user: access.userId,
    },
  );
  if (!saved.length)
    throw new AccessError(
      "Procedure version changed. Reload before updating.",
      409,
    );
  await query(
    "MATCH (v:ProcedureVersion {id:$id}) UNWIND $sources AS source MATCH (s {id:source}) MERGE (v)-[:EVIDENCED_BY]->(s)",
    { id: versionId, sources: input.sourceIds },
  );
  return { id, version, versionId };
}

export async function listProcedures(
  _access: WorkspaceAccess,
  topic = "",
  asOf = new Date().toISOString(),
) {
  return readQuery<{
    id: string;
    versionId: string;
    version: number;
    name: string;
    topic: string;
    description: string;
    action: string;
    steps: string[];
    status: string;
    verifiedOutcomes: number;
    sourceIds: string[];
  }>(
    `MATCH (p:Procedure)-[:HAS_VERSION]->(candidate:ProcedureVersion)
    WHERE candidate.createdAt<=$at WITH p,candidate ORDER BY candidate.version DESC
    WITH p,collect(candidate)[0] AS v
    WHERE $topic='' OR toLower(v.topic) CONTAINS $topic OR toLower(v.description) CONTAINS $topic
    OPTIONAL MATCH (v)-[:VALIDATED_BY]->(e:Episode {kind:'sandbox_outcome',verified:true})
    RETURN p.id AS id,v.id AS versionId,v.version AS version,v.name AS name,v.topic AS topic,v.description AS description,v.action AS action,v.steps AS steps,v.status AS status,v.sourceIds AS sourceIds,count(DISTINCT e) AS verifiedOutcomes
    ORDER BY verifiedOutcomes DESC,v.version DESC LIMIT 20`,
    { topic: topic.toLowerCase(), at: asOf },
  );
}

export async function learnFromReceipt(
  access: WorkspaceAccess,
  procedureVersionId: string,
  receiptId: string,
) {
  if (access.role === "reader") throw new AccessError("Read-only workspace.");
  const rows = await readQuery<{ payload: string; action: string }>(
    "MATCH (a:SandboxAction {id:$receipt}), (v:ProcedureVersion {id:$procedure,status:'published'}) RETURN a.payload AS payload,v.action AS action",
    { receipt: receiptId, procedure: procedureVersionId },
  );
  if (!rows.length)
    throw new AccessError(
      "Receipt or published procedure not found in this workspace.",
      404,
    );
  const receipt: SandboxReceipt = JSON.parse(rows[0].payload);
  if (
    receipt.action !== rows[0].action ||
    !(await verifyReceipt(receipt)).verified
  )
    throw new AccessError(
      "Only a matching, currently verified sandbox receipt can validate a procedure.",
      409,
    );
  const id = `outcome-${receiptId}`;
  await query(
    `MATCH (a:SandboxAction {id:$receipt}), (v:ProcedureVersion {id:$procedure})
    MERGE (e:Episode {id:$id}) ON CREATE SET e.kind='sandbox_outcome',e.topic=v.topic,e.text=$text,e.createdAt=$at,e.visibility='workspace',e.authorId=$user,e.verified=true,e.sourceIds=[$receipt]
    MERGE (e)-[:EVIDENCED_BY]->(a) MERGE (v)-[:VALIDATED_BY]->(e)`,
    {
      receipt: receiptId,
      procedure: procedureVersionId,
      id,
      text: `Verified sandbox outcome: ${receipt.action}; timeout ${receipt.before.timeoutMs}ms → ${receipt.after.timeoutMs}ms. This is sandbox evidence, not production authorization.`,
      at: new Date().toISOString(),
      user: access.userId,
    },
  );
  return id;
}

export async function createConversation(
  access: WorkspaceAccess,
  title: string,
) {
  const id = randomUUID();
  await query(
    "CREATE (c:Conversation {id:$id,title:$title,ownerId:$owner,createdAt:$at,nextIndex:0})",
    {
      id,
      title: title.slice(0, 160) || "Investigation session",
      owner: access.userId,
      at: new Date().toISOString(),
    },
  );
  return id;
}

export async function conversations(access: WorkspaceAccess) {
  return readQuery<{ id: string; title: string; createdAt: string }>(
    "MATCH (c:Conversation {ownerId:$owner}) RETURN c.id AS id,c.title AS title,c.createdAt AS createdAt ORDER BY c.createdAt DESC LIMIT 50",
    { owner: access.userId },
  );
}

export async function conversationMessages(
  access: WorkspaceAccess,
  id: string,
) {
  const exists = await readQuery(
    "MATCH (c:Conversation {id:$id,ownerId:$owner}) RETURN c.id AS id",
    { id, owner: access.userId },
  );
  if (!exists.length) throw new AccessError("Conversation not found.", 404);
  return readQuery<{
    id: string;
    role: string;
    text: string;
    index: number;
    createdAt: string;
    evidence: string;
  }>(
    "MATCH (:Conversation {id:$id,ownerId:$owner})-[:HAS_MESSAGE]->(m:ConversationMessage) RETURN m.id AS id,m.role AS role,m.text AS text,m.index AS index,m.createdAt AS createdAt,m.evidence AS evidence ORDER BY m.index LIMIT 200",
    { id, owner: access.userId },
  );
}

export async function appendMessage(
  access: WorkspaceAccess,
  conversationId: string,
  role: "user" | "assistant" | "tool",
  text: string,
  evidence: unknown = null,
) {
  const id = randomUUID();
  const saved = await query(
    `MATCH (c:Conversation {id:$conversation,ownerId:$owner}) SET c.nextIndex=c.nextIndex+1
    CREATE (m:ConversationMessage {id:$id,role:$role,text:$text,index:c.nextIndex,createdAt:$at,evidence:$evidence}) CREATE (c)-[:HAS_MESSAGE]->(m) RETURN m.id AS id`,
    {
      conversation: conversationId,
      owner: access.userId,
      id,
      role,
      text: text.slice(0, 16000),
      at: new Date().toISOString(),
      evidence: JSON.stringify(evidence),
    },
  );
  if (!saved.length) throw new AccessError("Conversation not found.", 404);
  return id;
}
