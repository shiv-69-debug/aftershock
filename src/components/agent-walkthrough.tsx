import {
  ArrowDown,
  ArrowRight,
  Database,
  GitBranch,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Investigation } from "@/lib/types";
import { CAPABILITIES } from "@/lib/capabilities";
import "./agent-walkthrough.css";

export function AgentWalkthrough({
  connected,
  blocked,
  running,
  completedChecks,
  investigation,
}: {
  connected: boolean;
  blocked: boolean;
  running: boolean;
  completedChecks: number;
  investigation: Investigation | null;
}) {
  return (
    <section
      className="agent-walkthrough"
      aria-labelledby="agent-walkthrough-title"
    >
      <div className="walkthrough-heading">
        <div>
          <span className="eyebrow">OPERATE THE AGENTS</span>
          <h2 id="agent-walkthrough-title">
            See every step. Verify the result.
          </h2>
          <p>
            You provide the incident and start each stage. The agents read the
            graph, apply an explicit policy, persist a handoff, and execute only
            a supported sandbox action.
          </p>
        </div>
        <span className="tiny-badge">NO API KEY REQUIRED</span>
      </div>
      <div className="agent-role-grid">
        <article>
          <span className="agent-role-icon">
            <Search size={20} />
          </span>
          <div>
            <small>AGENT 01 · INVESTIGATOR</small>
            <h3>Read context → decide → record</h3>
            <p>
              <strong>Input:</strong> checkout deployment v2.4.7.
            </p>
            <p>
              <strong>Tools:</strong> deployment/runbook, impact paths, owners,
              prior records, and constraints.
            </p>
            <p>
              <strong>Output:</strong> a supported sandbox proposal or a hold,
              saved with its evidence.
            </p>
            <span className="agent-role-status">
              {!connected
                ? "Waiting for the graph scenario"
                : running
                  ? `Reading graph · ${completedChecks}/5 checks returned`
                  : investigation
                    ? `${completedChecks}/5 checks returned · ${investigation.action === "hold" ? "HOLD" : "proposal recorded"}`
                    : "Ready — start with Investigate incident"}
            </span>
          </div>
        </article>
        <article>
          <span className="agent-role-icon">
            <ShieldCheck size={20} />
          </span>
          <div>
            <small>AGENT 02 · RESPONDER</small>
            <h3>Load handoff → recheck → act</h3>
            <p>
              <strong>Input:</strong> a persisted handoff ID, not a
              conversation.
            </p>
            <p>
              <strong>Decision:</strong> reject changed evidence or apply the
              allowed mutation once.
            </p>
            <p>
              <strong>Output:</strong> sandbox state change, execution receipt,
              and replay verification.
            </p>
            <a className="agent-role-link" href="#handoff-workflow">
              See persisted responder state <ArrowDown size={13} />
            </a>
          </div>
        </article>
      </div>
      <nav
        className="walkthrough-steps"
        aria-label="Hands-on demonstration steps"
      >
        <a href="#incident-controls">
          <span>01</span>
          <strong>Investigate</strong>
          <small>
            Click Investigate incident. Watch the five tools return.
          </small>
          <ArrowRight size={15} />
        </a>
        <a href="#graph-evidence">
          <span>02</span>
          <strong>Inspect evidence</strong>
          <small>
            Expand the log and click a graph node to read its source.
          </small>
          <ArrowRight size={15} />
        </a>
        <a href="#context-controls">
          <span>03</span>
          <strong>Change the context</strong>
          <small>
            {blocked
              ? "Migration is active. Remove it to compare the baseline proposal."
              : "Inject the migration, then re-investigate to see the decision change."}
          </small>
          <ArrowRight size={15} />
        </a>
        <a href="#handoff-workflow">
          <span>04</span>
          <strong>Hand off & verify</strong>
          <small>
            Persist the handoff, probe before, run the responder, probe after.
          </small>
          <ArrowRight size={15} />
        </a>
      </nav>
      <div className="walkthrough-proof">
        <Database size={16} />
        <p>
          <strong>What proves this is working?</strong> A changed relationship
          changes the result. A saved handoff survives reload. A sandbox
          mutation changes the probe from 504 to 200. A missing prerequisite
          produces hold.
        </p>
      </div>
      <details className="walkthrough-limits">
        <summary>
          <GitBranch size={15} /> What these agents actually support
        </summary>
        <p>
          These are bounded, deterministic agents. The main workflow uses graph
          queries and an explicit decision policy; it does not rely on an LLM to
          invent a plan.
        </p>
        <pre>{CAPABILITIES}</pre>
        <p>
          Official brief:{" "}
          <a
            href="https://www.wemakedevs.org/hackathons/falkordb"
            target="_blank"
            rel="noreferrer"
          >
            graph-driven decisions and actions
          </a>
          . Submission deliverables:{" "}
          <a
            href="https://www.wemakedevs.org/hackathons/falkordb/rules"
            target="_blank"
            rel="noreferrer"
          >
            source repository, README/model, Cypher queries, demo video, setup
            or deployment, chosen tracks, and AI-assistance disclosure
          </a>
          .
        </p>
      </details>
    </section>
  );
}
