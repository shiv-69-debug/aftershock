# AFTERSHOCK — evidence to sandbox action

## Before recording

Start Docker Compose and the app (`npm run demo`). Enter the workspace and load the scenario. If upgrading an existing graph, re-run the seed API to add v2 runbook evidence; old audit records stay intact. Begin with the known migration constraint removed. The organization and telemetry are synthetic.

## 0:00 — Investigate

“An alert points to checkout after a deployment. AFTERSHOCK reads the graph to find dependency impact, ownership, prior incident records, and current action constraints.”

Click **Investigate incident**. Show the tools and a customer dependency path.

“The proposal is sandbox-only. It requires affirmative runbook and compatibility evidence, not just an absence of blockers. Missing evidence means hold.”

## 0:25 — Change the context

Inject the migration and re-investigate. Show the revised sandbox flag proposal.

“This specific migration blocks rollback and explicitly permits the flag alternative. An unknown blocker would not authorize that alternative.”

## 0:45 — Persist the handoff

Click **Hand off to responder**. Show the pending handoff, source IDs, and evidence digest. Open **Probe sandbox** to show the pre-action timeout response (HTTP 504).

“The investigator has produced a proposal, not performed an action. Its handoff is persisted in FalkorDB. The responder can consume it from another process with only this ID.”

Optional terminal demonstration: `npm run sandbox:consume -- <handoff-id>`.

## 1:05 — Execute and verify

Click **Run sandbox action** (or use the separate responder CLI). Show the receipt: flag true → false, timeout 800 → 5000ms. Open the probe again (HTTP 200).

“The responder rechecks the evidence before changing only this isolated sandbox. The receipt, handoff, investigation, and supporting nodes form a queryable provenance chain. A fresh read verifies the persisted configuration and replays a synthetic request.”

## 1:30 — Prove persistence and scope

Reload, re-enter, and show the persisted receipt and verification. Expand **Inspect provenance** to trace the action back to the original investigation and supporting source IDs.

“These are stored action records. The mutation is to a local sandbox, and the replay checks that sandbox's configuration. Operator simulation notes are a different record type and do not count as executed actions. The agents are bounded deterministic workers: one investigates and proposes; the other consumes persisted context, revalidates, acts, and verifies.”

## Close

“AFTERSHOCK: connected evidence, explicit constraints, a persisted handoff, and a sandbox action you can verify.”
