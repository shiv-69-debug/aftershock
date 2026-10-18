import type { Evidence } from "../../src/lib/types";

export const verifiedDeployment: Evidence = {
  id: "deploy-247",
  name: "checkout v2.4.7",
  detail: "Synthetic timeout change; causality not verified.",
  source: "deployments/247",
  serviceId: "checkout",
  dependencyId: "payments",
  dependencySource: "metrics/payments",
  dependencyName: "payment-gateway",
  dependencyEvidence: "Synthetic replay latency 1240ms.",
  runbookId: "checkout-runbook",
  runbookSource: "runbooks/sandbox",
  runbookDetail: "Sandbox-only rollback and flag authorization.",
  timeoutMs: 800,
  previousTimeoutMs: 5000,
  latencyMs: 1240,
  flagOffTimeoutMs: 5000,
  flagName: "fast_payments",
  rollbackTarget: "v2.4.6",
  rollbackAllowed: true,
  rollbackCompatible: true,
  flagAllowed: true,
  sandboxOnly: true,
};
export const verifiedConstraint: Evidence = {
  id: "migration-88",
  name: "Migration #88",
  detail: "Rollback incompatible; the sandbox flag change is permitted.",
  source: "migrations/88",
  blockedAction: "rollback",
  flagMitigationAllowed: true,
};
