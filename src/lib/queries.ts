import type { ToolName } from "./types";

export const tools: Record<
  ToolName,
  { label: string; description: string; query: string }
> = {
  inspect_deployment: {
    label: "Inspect the deployment",
    description:
      "Read the triggering deployment, target service and downstream dependency evidence.",
    query: `MATCH (d:Deployment {id: $deployment})-[:DEPLOYED_TO]->(s:Service)
OPTIONAL MATCH (s)-[:DEPENDS_ON]->(dependency:Service)
OPTIONAL MATCH (d)-[:HAS_RUNBOOK]->(policy:Runbook)
RETURN d.id AS id, d.name AS name, d.detail AS detail, d.source AS source,
s.id AS serviceId, d.timeoutMs AS timeoutMs, d.previousTimeoutMs AS previousTimeoutMs,
dependency.id AS dependencyId, dependency.name AS dependencyName, dependency.detail AS dependencyEvidence, dependency.source AS dependencySource, dependency.latencyMs AS latencyMs,
policy.id AS runbookId, policy.source AS runbookSource, policy.detail AS runbookDetail,
policy.flagName AS flagName, policy.flagOffTimeoutMs AS flagOffTimeoutMs, policy.flagAllowed AS flagAllowed,
policy.rollbackTarget AS rollbackTarget, policy.rollbackAllowed AS rollbackAllowed, policy.rollbackCompatible AS rollbackCompatible, policy.sandboxOnly AS sandboxOnly`,
  },
  trace_blast_radius: {
    label: "Trace the blast radius",
    description:
      "Traverse reverse service dependencies and customer usage, up to six hops, to find affected services and customers.",
    query: `MATCH (:Deployment {id: $deployment})-[:DEPLOYED_TO]->(root:Service)
MATCH path=(n)-[:DEPENDS_ON|USES*1..6]->(root)
RETURN DISTINCT n.id AS id, n.name AS name, n.detail AS detail, n.source AS source, n.kind AS kind, [node IN nodes(path) | node.id] AS path`,
  },
  find_owners: {
    label: "Locate the responders",
    description:
      "Find owners of the deployed service and its transitive dependents.",
    query: `MATCH (:Deployment {id: $deployment})-[:DEPLOYED_TO]->(root:Service)
MATCH (s:Service)-[:DEPENDS_ON*0..6]->(root)
MATCH (t:Team)-[:OWNS]->(s)
RETURN DISTINCT t.id AS id, t.name AS name, t.detail AS detail, t.source AS source, s.name AS service`,
  },
  recall_incidents: {
    label: "Recall incident memory",
    description:
      "Retrieve up to four historical incidents before a separate allowance of three recent operator notes, all linked to the same service.",
    query: `MATCH (:Deployment {id: $deployment})-[:DEPLOYED_TO]->(s:Service)
OPTIONAL MATCH (h:Incident)-[:AFFECTED]->(s) WHERE h.id='incident-189' OR h.recordType='historical'
WITH s,h ORDER BY h.createdAt DESC
WITH s,collect(h)[0..4] AS historical
OPTIONAL MATCH (n:Incident)-[:AFFECTED]->(s) WHERE n.recordType='operator_note' OR n.source STARTS WITH 'resolutions/'
WITH historical,n ORDER BY n.createdAt DESC
WITH historical,collect(n)[0..3] AS recentNotes
WITH historical+recentNotes AS records UNWIND records AS i
RETURN i.id AS id, i.name AS name, i.detail AS detail, i.source AS source, i.action AS action,
CASE WHEN i.id='incident-189' OR i.recordType='historical' THEN 'historical' ELSE 'operator_note' END AS recordType`,
  },
  check_constraints: {
    label: "Check action constraints",
    description:
      "Check active constraints that block rollback of this deployment. Must be checked before recommending an action.",
    query: `MATCH (c:Constraint)-[:BLOCKS]->(d:Deployment {id: $deployment})
WHERE c.active = true
RETURN c.id AS id, c.name AS name, c.detail AS detail, c.source AS source, c.blockedAction AS blockedAction, c.flagMitigationAllowed AS flagMitigationAllowed`,
  },
};

export const toolOrder = Object.keys(tools) as ToolName[];
