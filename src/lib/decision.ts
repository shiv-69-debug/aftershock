import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolOrder } from "./queries";
import { evidenceDigest, evidenceRecords } from "./evidence";
import type { Investigation, ToolTrace } from "./types";

export const POLICY_VERSION = 2;
export const actionFacts = z.object({
  id: z.literal("deploy-247"),
  serviceId: z.literal("checkout"),
  dependencyId: z.literal("payments"),
  dependencySource: z.string().min(1),
  runbookId: z.string().min(1),
  runbookSource: z.string().min(1),
  timeoutMs: z.number().positive(),
  previousTimeoutMs: z.number().positive(),
  latencyMs: z.number().positive(),
  flagOffTimeoutMs: z.number().positive(),
  flagName: z.literal("fast_payments"),
  rollbackTarget: z.literal("v2.4.6"),
  rollbackAllowed: z.boolean(),
  rollbackCompatible: z.boolean(),
  flagAllowed: z.boolean(),
  sandboxOnly: z.literal(true),
});

export function decide(
  traces: ToolTrace[],
  mode: Investigation["mode"],
  revision = 0,
): Investigation {
  for (const tool of toolOrder)
    if (!traces.some((trace) => trace.tool === tool))
      throw new Error(`Missing required evidence: ${tool}`);
  const rows = (tool: ToolTrace["tool"]) =>
    traces.find((trace) => trace.tool === tool)!.rows;
  const deployment = rows("inspect_deployment")[0];
  if (!deployment)
    throw new Error("Deployment missing from graph. Load the scenario first.");
  const blockers = rows("check_constraints");
  const facts = actionFacts.safeParse(
    rows("inspect_deployment").length === 1 ? deployment : {},
  );
  const missingEvidence = facts.success
    ? []
    : [...new Set(facts.error.issues.map((issue) => issue.path.join(".")))];
  let action: Investigation["action"] = "hold";
  let rationale = `No mitigation is authorized: required structured evidence is missing or invalid (${missingEvidence.join(", ")}). A historical success or an empty blocker query is not sufficient authorization.`;
  if (facts.success) {
    const f = facts.data;
    if (f.timeoutMs >= f.latencyMs) {
      rationale =
        "The current structured latency evidence does not exceed the configured timeout. The proposed timeout mitigation is unsupported.";
    } else if (
      !blockers.length &&
      f.rollbackAllowed &&
      f.rollbackCompatible &&
      f.previousTimeoutMs > f.latencyMs
    ) {
      action = "rollback";
      rationale = `The sandbox runbook explicitly permits rollback to ${f.rollbackTarget} and marks it compatible. No active blocker was returned. Its ${f.previousTimeoutMs}ms timeout exceeds the ${f.latencyMs}ms replay latency. This authorizes a sandbox test only; it does not establish production safety or causality.`;
    } else if (
      f.flagAllowed &&
      f.flagOffTimeoutMs > f.latencyMs &&
      blockers.every(
        (row) =>
          row.blockedAction === "rollback" &&
          row.flagMitigationAllowed === true,
      )
    ) {
      action = "disable_flag";
      rationale = `The sandbox runbook explicitly permits disabling ${f.flagName}, restoring a ${f.flagOffTimeoutMs}ms timeout. ${blockers.length ? "Every active blocker explicitly permits this flag mitigation while blocking rollback." : "The flag mitigation is supported by affirmative runbook evidence."} This is a sandbox-only proposal, not an executed change.`;
    } else {
      rationale =
        "Hold: no mitigation satisfies the explicit runbook, compatibility, latency, and constraint checks. Unknown blockers do not imply that a feature-flag change is safe.";
    }
  }
  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    revision,
    mode,
    blocked: blockers.length > 0,
    action,
    scope: "sandbox",
    policyVersion: POLICY_VERSION,
    evidenceDigest: evidenceDigest(traces),
    missingEvidence,
    summary:
      action === "rollback"
        ? "Sandbox: roll back checkout v2.4.7."
        : action === "disable_flag"
          ? "Sandbox: disable fast_payments."
          : "Hold: insufficient evidence for a mitigation.",
    rationale,
    traces,
    affected: [...new Set(rows("trace_blast_radius").map((row) => row.id))],
    owners: [...new Set(rows("find_owners").map((row) => row.name))],
    recalled: rows("recall_incidents").length,
    evidenceIds: evidenceRecords(traces).map((row) => row.id),
    supportingEvidenceIds: evidenceRecords(
      traces.filter(
        (trace) =>
          trace.tool === "inspect_deployment" ||
          trace.tool === "check_constraints",
      ),
    ).map((row) => row.id),
  };
}
