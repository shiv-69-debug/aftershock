import type { GraphNode, GraphEdge } from "./types";

// Fictional, curated evidence. IDs are shared by the graph, sources and visual UI.
export const nodes: GraphNode[] = [
  {
    id: "deploy-247",
    name: "checkout v2.4.7",
    kind: "Deployment",
    detail:
      "14:32 UTC · release changed payment timeout from 5,000ms to 800ms behind the fast_payments feature flag. Error rate rose from 0.2% to 18.6% immediately afterward. Correlation is evidence, not proof of causation.",
    source: "deployments/checkout-v2.4.7",
    x: 430,
    y: 85,
  },
  {
    id: "checkout",
    name: "checkout-api",
    kind: "Service",
    detail:
      "Checkout entry point. Owns fast_payments flag. 18.6% of checkout requests fail in the synthetic incident window.",
    source: "catalog/services/checkout-api",
    x: 430,
    y: 225,
  },
  {
    id: "payments",
    name: "payment-gateway",
    kind: "Service",
    detail:
      "Card authorization provider. P95 latency 1,240ms exceeds the new checkout timeout of 800ms.",
    source: "metrics/payment-gateway/p95",
    x: 680,
    y: 225,
  },
  {
    id: "orders",
    name: "order-service",
    kind: "Service",
    detail:
      "Order creation calls checkout-api. Retries amplify checkout failures; 342 orders failed during the sample window.",
    source: "catalog/services/order-service",
    x: 300,
    y: 390,
  },
  {
    id: "storefront",
    name: "storefront",
    kind: "Service",
    detail:
      "Customer-facing storefront depends on order-service to complete purchases.",
    source: "catalog/services/storefront",
    x: 525,
    y: 500,
  },
  {
    id: "acme",
    name: "Acme Retail",
    kind: "Customer",
    detail:
      "Enterprise customer using order-service. 218 failed orders in this synthetic incident.",
    source: "support/acme/incident-247",
    x: 90,
    y: 505,
  },
  {
    id: "orbit",
    name: "Orbit Commerce",
    kind: "Customer",
    detail:
      "Enterprise customer using storefront. 124 failed orders in this synthetic incident.",
    source: "support/orbit/incident-247",
    x: 735,
    y: 540,
  },
  {
    id: "team-checkout",
    name: "Checkout team",
    kind: "Team",
    detail:
      "Primary owner of checkout-api. On-call: Maya Chen. Escalation: #oncall-checkout (fictional).",
    source: "directory/teams/checkout",
    x: 110,
    y: 225,
  },
  {
    id: "team-orders",
    name: "Orders team",
    kind: "Team",
    detail:
      "Owner of order-service. On-call: Arjun Rao. Escalation: #oncall-orders (fictional).",
    source: "directory/teams/orders",
    x: 100,
    y: 365,
  },
  {
    id: "incident-189",
    name: "INC-189",
    kind: "Incident",
    detail:
      "A previous checkout timeout regression was resolved by rolling back. That incident had no active schema migration. Reuse the lesson only after checking current constraints.",
    source: "postmortems/INC-189",
    x: 750,
    y: 85,
  },
];

export const edges: GraphEdge[] = [
  { source: "deploy-247", target: "checkout", relation: "DEPLOYED_TO" },
  { source: "checkout", target: "payments", relation: "DEPENDS_ON" },
  { source: "orders", target: "checkout", relation: "DEPENDS_ON" },
  { source: "storefront", target: "orders", relation: "DEPENDS_ON" },
  { source: "acme", target: "orders", relation: "USES" },
  { source: "orbit", target: "storefront", relation: "USES" },
  { source: "team-checkout", target: "checkout", relation: "OWNS" },
  { source: "team-orders", target: "orders", relation: "OWNS" },
  { source: "incident-189", target: "checkout", relation: "AFFECTED" },
];

export const migration: GraphNode = {
  id: "migration-88",
  name: "schema migration #88",
  kind: "Constraint",
  detail:
    "Payment schema migration is active. checkout v2.4.6 cannot read the new schema, so rollback is blocked. Disabling fast_payments restores the 5,000ms timeout without reverting the schema-compatible release.",
  source: "migrations/88/compatibility-check",
  x: 655,
  y: 365,
};
