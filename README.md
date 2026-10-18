# AFTERSHOCK

### Follow the failure.

**AFTERSHOCK uses FalkorDB to trace incident impact, revise mitigation proposals when constraints change, and hand off verified sandbox actions between two persistent, bounded agents.**

- **Public source:** https://github.com/shiv-69-debug/aftershock
- **Run the verified demo locally:** `npm ci` → start Docker Desktop → `npm run demo` → http://127.0.0.1:3000/workspace
- **Demo narration:** [docs/demo-script.md](docs/demo-script.md). A recorded submission video must still be supplied.
- **Entered tracks:** Agents That Act on Connected Data; Agent Memory and Coordination.

## Submission scope — read this first

The verified submission is the synthetic incident workflow at `/workspace`: bounded graph queries, evidence-gated sandbox proposals, persisted investigator/responder handoffs, refusal on stale or missing evidence, and a verifiable sandbox mutation. It runs without an LLM API key.

The repository also contains an **unfinished experimental expansion** for authenticated data workspaces, MCP, graph algorithms, persistent conversations, advanced memory, and GraphRAG. Some backend isolation/MCP/algorithm tests pass, but the new workspace UI has not completed end-to-end verification, GraphRAG ingestion has not been verified, and no concurrency benchmark result is claimed. These are **not submission coverage claims**. The experimental `/workspaces` page is disabled by default; only enable it with `ENABLE_EXPERIMENTAL_WORKSPACES=true` when developing that expansion. The GraphRAG Docker service is opt-in and is not needed to run the submission.

For a fast demo, remove the migration constraint first, investigate the baseline, inject migration, re-investigate, create a pending handoff, reload, execute it, and show the probe change from 504 to 200. Explain that this is a synthetic sandbox, not a production action.

Two bounded incident-response agents use FalkorDB to investigate a synthetic deployment failure, decide whether a sandbox mitigation is supported, exchange a persisted handoff, and execute an independently verifiable sandbox action.

**Tracks:** Agents That Act on Connected Data; Agent Memory and Coordination.

## Run locally

Requires **Node.js 22+** and **Docker Desktop** with the Linux engine running.

```sh
npm ci
npm run demo
```

Open **http://127.0.0.1:3000** (also available at `/workspace`). Keep the terminal open. The entry percentage is a visual initialization sequence, not investigation progress.

No model API key is required for the public workflow. The investigator API and responder use deterministic graph tools and policy checks. The internal investigator library retains optional model-based tool-ordering support, but that is not invoked by this UI or the sandbox worker and is not part of the demonstrated agent behavior.

FalkorDB runs at `127.0.0.1:6379`; its browser is at **http://127.0.0.1:3002**. Compose persists data in `aftershock-data` with AOF. If the database is unavailable, the app shows a labeled visual preview and disables investigation/mutation controls.

### Start a clean recording without deleting history

Set `FALKORDB_GRAPH=aftershock_recording_01` in `.env.local`, restart the app, and click **Load scenario**. Use a new graph name for each clean rehearsal. The new graph starts with no migration or handoffs; existing graphs and their audit records remain available in FalkorDB Browser. Restore the previous graph name to return to that workspace.

### Graph configuration

| Variable            | Default      | Meaning                    |
| ------------------- | ------------ | -------------------------- |
| `FALKORDB_HOST`     | `127.0.0.1`  | Database hostname          |
| `FALKORDB_PORT`     | `6379`       | Database port              |
| `FALKORDB_GRAPH`    | `aftershock` | Shared workspace graph     |
| `FALKORDB_PASSWORD` | unset        | Optional database password |

## Where are the agents?

An agent's input does not have to be a sentence. Here it is an incident record or a persisted handoff ID.

### Agent 1: investigator

- **Goal:** identify connected impact and produce a supported sandbox proposal—or hold.
- **Input:** the checkout v2.4.7 deployment in FalkorDB.
- **Observe:** run five graph tools to read deployment/runbook evidence, impact paths, owners, prior incident records, and constraints.
- **Decide:** evaluate affirmative compatibility, runbook permission, timeout, latency, and blocker evidence.
- **Output:** a persisted investigation audit containing results, policy version, evidence digest, and proposal.
- **Implementation:** `src/lib/agent.ts`, `src/lib/queries.ts`, `src/lib/decision.ts`.

### Agent 2: responder

- **Goal:** consume an authorized handoff and apply exactly one supported sandbox mutation.
- **Input:** a handoff ID—not the investigator's in-memory variables.
- **Observe:** load the handoff from FalkorDB and independently retrieve fresh evidence.
- **Decide:** reject changed evidence, a stale revision, unsupported action, or modified initial sandbox state.
- **Act:** atomically update the isolated sandbox, create a receipt, and complete the handoff.
- **Verify:** read the sandbox again and replay a deterministic synthetic request.
- **Implementation:** `src/lib/workflow.ts`; separate-process entry point `scripts/consume-handoff.ts`.

These are **bounded, deterministic agents**, not general-purpose autonomous planners. The operator starts stages using buttons. The operator does not manually choose the mitigation; the graph-backed policy does. Neither the UI nor the agents execute production actions.

## Hands-on workflow: what to click and what to observe

1. **Enter investigation → Load scenario**, if prompted. The fixture contains services, customers, ownership, a deployment, runbook, and a historical incident.
2. **Remove constraint**, if the migration is already active. This establishes the baseline without deleting previous audit records or receipts.
3. Click **Investigate incident**. Watch the five tools return in **Investigation log**. With intact baseline evidence, the result is **Sandbox: roll back checkout v2.4.7.**
4. **Inspect the evidence.** Expand a tool to read its Cypher query and result count. Click **Orbit Commerce** in the graph and follow the connected services. Its impact depends on several relationships, not a single matching document.
5. Click **Inject migration**, then **Re-investigate**. The known migration adds an active `BLOCKS` relationship and explicit permission for the flag alternative. The proposal changes to **Sandbox: disable fast_payments.** Unknown blockers or missing prerequisites instead cause **hold**.
6. Click **Hand off to responder**. The handoff persists with its source IDs, evidence digest, assigned responder, and sandbox target. Status is **PENDING — NOT EXECUTED**.
7. Click **Probe sandbox**. Before execution, the synthetic request's 1,240ms latency exceeds the configured 800ms timeout, so the endpoint returns **HTTP 504**.
8. Click **Run sandbox action**. The responder reloads and revalidates the handoff, then changes only its isolated sandbox. The receipt records `fastPayments: true → false` and timeout `800 → 5000ms`.
9. **Probe sandbox again.** It now returns **HTTP 200**. The UI recheck confirms whether persisted state matches the receipt. Open **Inspect provenance** to see the handoff, original investigation, fresh verification investigation, evidence IDs, and receipt.
10. **Reload and re-enter.** The handoff and receipt remain. Click **Refresh handoff verification** for a fresh check.
11. **Optional memory demonstration:** record an operator simulation note from an eligible investigation, reload, and open **Incident memory**. Investigations recall these stored records. A note is context, not evidence that an action was executed, and it never authorizes a mitigation.

The on-screen **Operate the agents** panel links directly to each stage. For a presenter-friendly narration, see [docs/demo-script.md](docs/demo-script.md).

### Prove the responder is independent

Create a handoff in the UI, copy its full ID from **Inspect provenance**, then run:

```sh
npm run sandbox:consume -- <handoff-id>
```

The new process receives only the ID; it loads its context from FalkorDB. Refresh the workflow panel to see the completed handoff and receipt. Retrying does not execute the mutation twice.

## What demonstrates each track?

### Track 01 — Agents That Act on Connected Data

- Multi-hop impact traversal through `DEPENDS_ON` and `USES`.
- Actual Cypher queries as bounded agent tools.
- A proposal that changes when graph constraints change.
- An executed sandbox configuration change with before/after verification.
- A stored provenance chain back to supporting evidence.

The verified submission flow does not use MCP or PageRank/community detection. Experimental MCP/algorithm code is separately labeled and is not part of these coverage claims.

### Track 02 — Agent Memory and Coordination

- Persisted incident records, runbooks, investigation audits, handoffs, and action receipts.
- Investigator → responder shared state through FalkorDB.
- Separate-process consumption and revalidation of the handoff.
- Duplicate/concurrent consumption tests demonstrating a single mutation.

The verified submission flow does not claim persistent chat history, per-user/tenant isolation, learned procedures, or a large-scale concurrency benchmark. Its browsers share one local workspace; the experimental upgrade is separate.

## Why FalkorDB is essential

The fixture only seeds the database and supplies the labeled disconnected preview. Agent tools read FalkorDB, not fixture arrays. Removing a customer's `USES` relationship removes it from the next impact result. Removing required dependency evidence produces **hold**. Adding the known migration changes the supported proposal. Handoffs and receipts are connected graph records; the responder loads and checks them before acting.

```text
(Deployment)-[:DEPLOYED_TO]->(Service)-[:DEPENDS_ON]->(Service)
(Customer)-[:USES]->(Service)
(Team)-[:OWNS]->(Service)
(Deployment)-[:HAS_RUNBOOK]->(Runbook)
(Constraint)-[:BLOCKS]->(Deployment)
(Incident)-[:AFFECTED]->(Service)
(Investigation)-[:INVESTIGATED]->(Deployment)
(Incident)-[:LEARNED_FROM]->(Investigation)
(Agent)-[:CREATED]->(AgentHandoff)-[:ASSIGNED_TO]->(Agent)
(AgentHandoff)-[:BASED_ON]->(Investigation)
(AgentHandoff)-[:SUPPORTED_BY]->(Deployment|Service|Runbook|Constraint)
(AgentHandoff)-[:TARGETS]->(SandboxState)
(Agent)-[:EXECUTED]->(SandboxAction)-[:CONSUMED]->(AgentHandoff)
(SandboxAction)-[:CHANGED]->(SandboxState)
(SandboxAction)-[:CHECKED_WITH]->(Investigation)
```

The five executable tool queries are in **[src/lib/queries.ts](src/lib/queries.ts)** and the UI's **Graph queries** tab. Handoff/action queries are in **[src/lib/workflow.ts](src/lib/workflow.ts)**.

Runtime values are parameterized. Queries have a five-second timeout. Impact traversal is bounded to six hops. Recall selects up to four historical incidents plus a separate allowance of three recent operator notes. Policy-v1 audits remain stored but cannot authorize new actions; the seed migration adds v2 fixture evidence without deleting audit history.

## Verification and scope

The sandbox action is a real mutation of an isolated persisted configuration. Verification is a deterministic replay against that configuration—not a payment-provider call, live network timing test, or production recovery claim. The original telemetry and organization are synthetic. This app does not ingest live telemetry, browse the web, or connect to Slack, Jira, paging, or production feature flags.

The evidence digest supports comparison, not cryptographic authorship. The graph administrator can edit stored data. Changing sandbox state after execution makes its current receipt verification fail. Legacy records and operator notes are not execution receipts.

## Run the checks yourself

```sh
npm run typecheck
npm test
npm run build
# Real FalkorDB tests, using isolated temporary graphs:
npm run test:integration
npm run test:workflow
# With the app running:
npx playwright install chromium
npx playwright test
```

The integration suites verify multi-hop impact, changed decisions, missing-evidence holds, memory after reconnect, independent responder execution, stale-handoff rejection, idempotency, concurrency, provenance, and sandbox tamper detection. They delete only their own temporary graphs. Browser tests operate the shared local demonstration scenario.

## Submission requirements

### Verification at submission freeze

The core passed 20 unit tests, both real-FalkorDB integration suites, six browser tests, type checking, and production build. A fresh clone of the public repository also passed `npm ci`, `npm run build`, `npm test`, and `npm run test:integration` without `.env.local` or model API keys. The database used for that rehearsal was the existing local FalkorDB instance; the test created and deleted its own isolated graph. The staged source passed a redacted secret scan, and `.env.local` was excluded from Git.

The [official rules](https://www.wemakedevs.org/hackathons/falkordb/rules) require a public source repository, README/setup and graph data model, the Cypher queries or algorithms used, a working demo video, a live deployment or complete local setup, and the entered track names. They also require disclosure of AI assistance and that participants understand and can explain their implementation. Work must follow the event's timing and data-use rules.

This public repository includes setup instructions, the graph model, executable queries, tests, and a demo narration. The participant still needs to record and submit the demo video.

## FAQ: is chat required?

No. The [official challenge](https://www.wemakedevs.org/hackathons/falkordb) asks for a working agent with FalkorDB as its context layer and graph-shaped decisions/actions. Neither the brief nor the [rules](https://www.wemakedevs.org/hackathons/falkordb/rules) requires a chat box. Persistent conversation history is a Track 02 focus area, not a universal requirement to build a chatbot. The verified demo uses direct controls and inspectable records.

**AI assistance:** developed with an OpenCode coding assistant. Participants must review, verify, and understand the submitted code. **Data:** synthetic. **License:** MIT; see [LICENSE](LICENSE).
