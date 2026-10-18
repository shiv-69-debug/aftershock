export type NodeKind =
  | "Service"
  | "Deployment"
  | "Team"
  | "Customer"
  | "Incident"
  | "Constraint"
  | "Evidence";
export type GraphNode = {
  id: string;
  name: string;
  kind: NodeKind;
  detail: string;
  source: string;
  x: number;
  y: number;
};
export type GraphEdge = { source: string; target: string; relation: string };
export type GraphSnapshot = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  blocked: boolean;
};
export type Evidence = {
  id: string;
  name: string;
  detail: string;
  source: string;
  [key: string]: unknown;
};
export type ToolName =
  | "inspect_deployment"
  | "trace_blast_radius"
  | "find_owners"
  | "recall_incidents"
  | "check_constraints";
export type ToolTrace = {
  tool: ToolName;
  label: string;
  query: string;
  rows: Evidence[];
  elapsed: number;
};
export type Investigation = {
  id: string;
  createdAt: string;
  revision: number;
  mode: "llm" | "deterministic";
  blocked: boolean;
  action: "rollback" | "disable_flag" | "hold";
  policyVersion?: number;
  scope?: "sandbox";
  evidenceDigest?: string;
  missingEvidence?: string[];
  supportingEvidenceIds?: string[];
  summary: string;
  rationale: string;
  traces: ToolTrace[];
  affected: string[];
  owners: string[];
  recalled: number;
  evidenceIds: string[];
};
export type Memory = {
  id: string;
  name: string;
  detail: string;
  action: string;
  createdAt: string;
  source: string;
};

export type SandboxState = {
  id: string;
  release: string;
  fastPayments: boolean;
  timeoutMs: number;
  latencyMs: number;
  revision: number;
};
export type SandboxProbe = {
  outcome: "ok" | "timeout";
  timeoutMs: number;
  latencyMs: number;
  model: "deterministic-request-replay";
};
export type AgentHandoff = {
  id: string;
  runId: string;
  from: "investigator-v2";
  to: "responder-v1";
  status: "pending" | "completed";
  action: "rollback" | "disable_flag";
  revision: number;
  evidenceDigest: string;
  evidenceIds: string[];
  createdAt: string;
  sandboxId: string;
};
export type SandboxReceipt = {
  id: string;
  handoffId: string;
  runId: string;
  verificationRunId: string;
  action: "rollback" | "disable_flag";
  createdAt: string;
  before: SandboxState;
  after: SandboxState;
  beforeProbe: SandboxProbe;
  afterProbe: SandboxProbe;
  evidenceIds: string[];
};
