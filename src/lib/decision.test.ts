import { describe, expect, it } from "vitest";
import { decide } from "./decision";
import { toolOrder, tools } from "./queries";
import type { ToolTrace } from "./types";
import {
  verifiedDeployment,
  verifiedConstraint,
} from "../../tests/fixtures/evidence";

function evidence(blocked = false, verified = true): ToolTrace[] {
  return toolOrder.map((tool) => ({
    tool,
    label: tools[tool].label,
    query: tools[tool].query,
    elapsed: 1,
    rows:
      tool === "inspect_deployment"
        ? [
            {
              id: "deploy-247",
              name: "checkout v2.4.7",
              detail: "Timeout change",
              source: "deployment",
              ...(verified ? verifiedDeployment : {}),
            },
          ]
        : tool === "check_constraints" && blocked
          ? [
              {
                id: "migration-88",
                name: "Migration #88",
                detail: "Rollback incompatible",
                source: "migration",
                ...(verified ? verifiedConstraint : {}),
              },
            ]
          : tool === "recall_incidents"
            ? [
                {
                  id: "old",
                  name: "INC-189",
                  detail: "Rollback worked",
                  source: "postmortem",
                  action: "rollback",
                },
              ]
            : [],
  }));
}

describe("evidence-gated action policy", () => {
  it("holds when no dependency or affirmative compatibility evidence exists", () => {
    const traces = evidence(false, false);
    expect(decide(traces, "deterministic").action).toBe("hold");
  });
  it("does not infer a safe flag change from an arbitrary rollback blocker", () => {
    const traces = evidence(true);
    traces.find(
      (trace) => trace.tool === "check_constraints",
    )!.rows[0].flagMitigationAllowed = undefined;
    expect(decide(traces, "deterministic").action).toBe("hold");
  });
  it("holds rather than selecting an arbitrary dependency from ambiguous evidence", () => {
    const traces = evidence();
    traces[0].rows.push({
      ...verifiedDeployment,
      dependencyId: "unknown-service",
    });
    expect(decide(traces, "deterministic").action).toBe("hold");
  });
  it("recommends rollback only after checking current constraints", () => {
    expect(decide(evidence(), "deterministic").action).toBe("rollback");
  });
  it("lets current constraints override an earlier successful rollback", () => {
    const result = decide(evidence(true), "llm");
    expect(result.action).toBe("disable_flag");
    expect(result.evidenceIds).toContain("migration-88");
    expect(result.rationale).toContain(
      "Every active blocker explicitly permits",
    );
  });
  it("refuses to recommend anything without a constraint check", () => {
    expect(() =>
      decide(
        evidence().filter((t) => t.tool !== "check_constraints"),
        "deterministic",
      ),
    ).toThrow("Missing required evidence");
  });
  it("refuses to invent a diagnosis for a missing deployment", () => {
    const traces = evidence();
    traces[0].rows = [];
    expect(() => decide(traces, "deterministic")).toThrow("Deployment missing");
  });
});
