"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  BookOpen,
  BrainCircuit,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Command,
  Database,
  FileText,
  GitBranch,
  Layers,
  LoaderCircle,
  Network,
  Play,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Terminal,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { nodes, edges } from "@/lib/scenario";
import { tools, toolOrder } from "@/lib/queries";
import type {
  GraphNode,
  GraphSnapshot,
  Investigation,
  Memory,
  ToolTrace,
} from "@/lib/types";
import { IncidentGraph } from "./incident-graph";
import { EntryPortal } from "./entry-portal";
import { AgentWalkthrough } from "./agent-walkthrough";
import { WorkflowPanel } from "./workflow-panel";

type Tab = "investigation" | "memory" | "queries";

async function post(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export function CommandCenter() {
  const [graph, setGraph] = useState<GraphSnapshot>({
    nodes,
    edges,
    blocked: false,
  });
  const [connected, setConnected] = useState(false);
  const [serverAvailable, setServerAvailable] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [traces, setTraces] = useState<ToolTrace[]>([]);
  const [result, setResult] = useState<Investigation | null>(null);
  const [previous, setPrevious] = useState<Investigation | null>(null);
  const [memory, setMemory] = useState<Memory[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [tab, setTab] = useState<Tab>("investigation");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [help, setHelp] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [workflowBusy, setWorkflowBusy] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/graph", {
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      const data = await response.json();
      setServerAvailable(true);
      setConnected(data.connected);
      if (data.connected) {
        setSeeded(data.graph.nodes.length > 0);
        if (data.graph.nodes.length) setGraph(data.graph);
        setMemory(data.memory);
      }
    } catch {
      setServerAvailable(false);
      setConnected(false);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    const reconnect = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
    };
  }, [refresh]);

  const dialogOpen = Boolean(selected) || help;
  useEffect(() => {
    if (!dialogOpen) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const regions = document.querySelectorAll<HTMLElement>("main, .sidebar");
    regions.forEach((region) => {
      region.inert = true;
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const dialog = document.querySelector('[role="dialog"]');
      const controls = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), a[href], [tabindex="0"]',
      );
      if (!controls?.length) return;
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.body.style.overflow = originalOverflow;
      regions.forEach((region) => {
        region.inert = false;
      });
      document.removeEventListener("keydown", trapFocus);
      previousFocus?.focus();
    };
  }, [dialogOpen]);

  async function loadScenario() {
    setBusy(true);
    setError(null);
    try {
      setGraph(await post("/api/scenario", { action: "seed" }));
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load scenario.");
    } finally {
      setBusy(false);
    }
  }

  async function runInvestigation() {
    setRunning(true);
    setError(null);
    setTraces([]);
    setPrevious(result || previous);
    setResult(null);
    setSaved(false);
    setTab("investigation");
    try {
      const response = await fetch("/api/investigate", { method: "POST" });
      if (!response.ok || !response.body)
        throw new Error("Could not start investigation.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "",
        complete = false;
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines.filter(Boolean)) {
          const event = JSON.parse(line);
          if (event.event === "trace")
            setTraces((current) => [...current, event.data]);
          if (event.event === "complete") {
            setResult(event.data);
            complete = true;
          }
          if (event.event === "error") throw new Error(event.data.message);
        }
        if (done) break;
      }
      if (!complete)
        throw new Error("Investigation stream ended early. Please retry.");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Investigation failed.");
    } finally {
      setRunning(false);
    }
  }

  async function toggleConstraint() {
    setBusy(true);
    setError(null);
    try {
      setGraph(
        await post("/api/scenario", {
          action: "constraint",
          active: !graph.blocked,
        }),
      );
      setPrevious(result || previous);
      setResult(null);
      setTraces([]);
      setSaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update constraint.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMemory() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/memory", { investigationId: result.id });
      setSaved(true);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save memory.");
    } finally {
      setBusy(false);
    }
  }

  const disabled = busy || running || workflowBusy || !connected || !seeded;
  const impacted = result
    ? graph.nodes.filter((n) => result.affected.includes(n.id))
    : [];
  const highlighted = [
    ...new Set(
      traces.flatMap((t) =>
        t.rows.flatMap((r) => [
          r.id,
          String(r.serviceId || ""),
          String(r.dependencyId || ""),
        ]),
      ),
    ),
  ];
  const changed = previous && result && previous.action !== result.action;
  const showInvestigation =
    exploring || running || Boolean(result) || Boolean(previous);
  const isLanding = tab === "investigation" && !showInvestigation;

  useEffect(() => {
    if (isLanding) return;
    const frame = requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(".page-heading h1")?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [isLanding]);

  if (isLanding)
    return (
      <EntryPortal
        connected={connected}
        checking={checking}
        onEnter={() => setExploring(true)}
      />
    );

  return (
    <div className={`app-shell ${isLanding ? "landing" : "workspace-view"}`}>
      <aside className="sidebar">
        <a className="brand" href="/workspace" aria-label="Aftershock home">
          <span className="brand-mark">
            <AudioLines size={23} strokeWidth={2.6} />
          </span>
          <span>
            AFTERSHOCK<span className="brand-dot">.</span>
          </span>
        </a>
        <div className="workspace">
          <div className="workspace-avatar">N</div>
          <div>
            <strong>Nova Commerce</strong>
            <small>Incident workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className="nav-item new-investigation"
            disabled={busy || running || workflowBusy}
            onClick={() => {
              setTab("investigation");
              setExploring(false);
              setResult(null);
              setPrevious(null);
              setTraces([]);
              setSaved(false);
              setError(null);
            }}
          >
            <Plus size={18} /> New investigation
          </button>
          <button
            className={tab === "investigation" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("investigation")}
          >
            <Activity size={18} /> Command center{" "}
            <span className="nav-count">1</span>
          </button>
          <button
            className={tab === "memory" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("memory")}
          >
            <BrainCircuit size={18} /> Incident memory{" "}
            <span className="nav-count subdued">{memory.length || "—"}</span>
          </button>
          <button
            className={tab === "queries" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("queries")}
          >
            <Terminal size={18} /> Graph queries{" "}
            <ArrowUpRight size={13} className="nav-arrow" />
          </button>
        </nav>
        <div className="sidebar-context">
          <div className="nav-caption">
            ACTIVE CONTEXT <span className="live-dot" />
          </div>
          <div className="context-line">
            <GitBranch size={14} /> checkout-production
          </div>
          <div className="context-line">
            <Layers size={14} /> Synthetic commerce stack
          </div>
        </div>
        <div className="sidebar-bottom">
          <div className="graph-powered">
            <Database size={19} />
            <div>
              <small>CONTEXT POWERED BY</small>
              <strong>
                FalkorDB <ArrowUpRight size={12} />
              </strong>
            </div>
          </div>
          <button className="help-button" onClick={() => setHelp(true)}>
            <CircleHelp size={16} /> Demo field guide <span>?</span>
          </button>
          <div className="profile">
            <span className="profile-avatar">SC</span>
            <div>
              <strong>Session commander</strong>
              <small>Local demo workspace</small>
            </div>
            <span className="live-dot" />
          </div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>
              {tab === "memory"
                ? "Incident memory"
                : tab === "queries"
                  ? "Graph queries"
                  : "Command center"}
            </span>
          </div>
          <div className="topbar-right">
            <span className="synthetic-label">SYNTHETIC DATA</span>
            <span className={`connection ${connected ? "online" : ""}`}>
              <i />
              {checking
                ? "Connecting"
                : connected
                  ? "FalkorDB connected"
                  : "Visual preview"}
            </span>
            <button
              className="icon-button"
              aria-label="Reconnect to FalkorDB"
              disabled={checking || running || busy || workflowBusy}
              onClick={refresh}
            >
              <RefreshCw size={15} className={checking ? "spin" : ""} />
            </button>
          </div>
        </header>
        <div className="main-content">
          {!isLanding && (
            <section className="page-heading">
              <div>
                <div className="eyebrow">
                  <span /> GRAPH-NATIVE INCIDENT RESPONSE
                </div>
                <h1 tabIndex={-1}>
                  {tab === "memory"
                    ? "Every incident. A lesson."
                    : tab === "queries"
                      ? "The evidence is connected."
                      : "Follow the failure."}
                </h1>
                <p>
                  {tab === "memory"
                    ? "Context that survives the session. Lessons that change the next decision."
                    : tab === "queries"
                      ? "Five bounded Cypher tools. Every conclusion has a path you can inspect."
                      : "Every incident has a story. Connect the dots."}
                </p>
              </div>
              <button
                className="secondary-button guide-trigger"
                onClick={() => setHelp(true)}
              >
                <BookOpen size={15} /> Field guide <ArrowUpRight size={14} />
              </button>
            </section>
          )}

          {error && (
            <div className="error-banner" role="alert">
              <TriangleAlert size={17} />
              <span>{error}</span>
              <button aria-label="Dismiss error" onClick={() => setError(null)}>
                <X size={16} />
              </button>
            </div>
          )}
          {!connected && !checking && (
            <div className="setup-banner">
              <Database size={18} />
              <div>
                {serverAvailable ? (
                  <>
                    <strong>You’re exploring a visual preview.</strong> Start
                    the graph to investigate: <code>docker compose up -d</code>
                  </>
                ) : (
                  <>
                    <strong>The local server is offline.</strong> Run{" "}
                    <code>npm run demo</code> and keep its terminal open, then
                    reconnect.
                  </>
                )}
              </div>
              <button onClick={refresh}>
                Reconnect <ArrowRight size={14} />
              </button>
            </div>
          )}
          {connected && !seeded && (
            <div className="setup-banner">
              <Sparkles size={18} />
              <div>
                <strong>Your graph is ready.</strong> Load the fictional
                commerce incident to begin.
              </div>
              <button onClick={loadScenario} disabled={busy}>
                {busy ? "Loading…" : "Load scenario"} <ArrowRight size={14} />
              </button>
            </div>
          )}

          {tab === "investigation" && (
            <AgentWalkthrough
              connected={connected && seeded}
              blocked={graph.blocked}
              running={running}
              completedChecks={traces.length}
              investigation={result}
            />
          )}

          {tab === "investigation" && (
            <>
              {showInvestigation && (
                <>
                  <section className="incident-banner" id="incident-controls">
                    <div className="incident-icon">
                      <Activity size={21} />
                    </div>
                    <div className="incident-title">
                      <div>
                        <span className="severity">SEV 1</span>
                        <span className="incident-id">INC-247</span>
                        <span className="incident-status">
                          <i />
                          {saved
                            ? "Simulation noted"
                            : running
                              ? "Investigating"
                              : result
                                ? "Investigation recorded"
                                : "Ready to investigate"}
                        </span>
                      </div>
                      <h2>Checkout failures after v2.4.7 deployment</h2>
                      <p>
                        checkout-api <span>·</span> Synthetic scenario{" "}
                        <span>·</span> Triggered at 14:32 UTC
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={runInvestigation}
                      disabled={disabled}
                    >
                      {running ? (
                        <LoaderCircle size={16} className="spin" />
                      ) : (
                        <Play size={15} fill="currentColor" />
                      )}
                      {running
                        ? "Investigating…"
                        : result || previous
                          ? "Re-investigate"
                          : "Investigate incident"}
                      <span className="button-key">
                        <Command size={11} />
                      </span>
                    </button>
                  </section>

                  {result && (
                    <section
                      className="metrics-grid"
                      aria-label="Incident metrics"
                    >
                      <div className="metric">
                        <div className="metric-label">
                          Checkout error rate <Activity size={15} />
                        </div>
                        <div className="metric-value">
                          18.6<span>%</span>
                          <span className="metric-change">
                            <ArrowUpRight size={13} /> 18.4 pp
                          </span>
                        </div>
                        <div className="metric-bottom">
                          from 0.2% before deployment{" "}
                          <span className="mini-bars">▁▁▂▁▂▂▃▆▅▇▆█</span>
                        </div>
                      </div>
                      <div className="metric">
                        <div className="metric-label">
                          Failed orders <Layers size={15} />
                        </div>
                        <div className="metric-value">
                          342<span className="metric-tag">sample window</span>
                        </div>
                        <div className="metric-bottom">
                          Across the fictional commerce stack
                        </div>
                      </div>
                      <div className="metric">
                        <div className="metric-label">
                          Downstream impact <Network size={15} />
                        </div>
                        <div className="metric-value">
                          {result
                            ? impacted.filter((n) => n.kind === "Service")
                                .length
                            : "—"}
                          <span className="metric-unit">services</span>
                          <div className="metric-divider" />
                          {result
                            ? impacted.filter((n) => n.kind === "Customer")
                                .length
                            : "—"}
                          <span className="metric-unit">customers</span>
                        </div>
                        <div className="metric-bottom">
                          {result
                            ? "Verified by graph traversal"
                            : "Awaiting dependency traversal"}
                        </div>
                      </div>
                      <div className="metric">
                        <div className="metric-label">
                          Incident memory <BrainCircuit size={15} />
                        </div>
                        <div className="metric-value">
                          {result ? result.recalled : "—"}
                          <span className="metric-unit">lessons</span>
                          <span className="memory-glyph">
                            <BrainCircuit size={27} />
                          </span>
                        </div>
                        <div className="metric-bottom">
                          {result
                            ? "Retrieved from persistent graph context"
                            : "Ready to recall past resolutions"}
                        </div>
                      </div>
                    </section>
                  )}

                  <div className="investigation-grid" id="graph-evidence">
                    <section className="panel graph-panel">
                      <div className="panel-heading">
                        <div>
                          <Network size={17} />
                          <h2>Blast radius</h2>
                          <span className="tiny-badge">
                            {graph.nodes.length} nodes
                          </span>
                        </div>
                        <span className="panel-meta">
                          <span className="live-dot" />
                          {connected && seeded ? "LIVE GRAPH" : "PREVIEW"}
                        </span>
                      </div>
                      <IncidentGraph
                        graph={graph}
                        selected={selected?.id || null}
                        onSelect={setSelected}
                        highlighted={highlighted}
                        running={running}
                      />
                      <div className="graph-footer">
                        <span>
                          <GitBranch size={14} /> Relationships, not guesses.
                        </span>
                        <span>
                          Select a node to inspect evidence{" "}
                          <ArrowUpRight size={13} />
                        </span>
                      </div>
                    </section>

                    <section className="panel reasoning-panel">
                      <div className="panel-heading">
                        <div>
                          <Sparkles size={17} className="lime" />
                          <h2>Investigation log</h2>
                        </div>
                        <span className="tiny-badge">
                          {result?.mode === "llm"
                            ? "LLM + GRAPH"
                            : "GRAPH WORKFLOW"}
                        </span>
                      </div>
                      <div className="agent-intro">
                        <div className="agent-avatar">
                          <AudioLines size={20} />
                        </div>
                        <div>
                          <strong>
                            AFTERSHOCK agent <span className="live-dot" />
                          </strong>
                          <p>
                            {running
                              ? "Following the evidence through FalkorDB…"
                              : result
                                ? "Investigation complete. Evidence attached."
                                : "Ready when you are. Let’s connect the dots."}
                          </p>
                        </div>
                      </div>
                      <div className="trace-list">
                        {toolOrder.map((name, index) => {
                          const trace = traces.find((t) => t.tool === name);
                          return (
                            <details
                              key={name}
                              className={`trace-step ${trace ? "complete" : "pending"}`}
                            >
                              <summary>
                                <span className="step-number">
                                  {trace ? (
                                    <Check size={13} />
                                  ) : (
                                    `0${index + 1}`
                                  )}
                                </span>
                                <span>
                                  {tools[name].label}
                                  <small>
                                    {trace
                                      ? `${trace.rows.length} evidence record${trace.rows.length === 1 ? "" : "s"} · ${trace.elapsed}ms`
                                      : tools[name].description.split(".")[0]}
                                  </small>
                                </span>
                                <ChevronDown size={13} />
                              </summary>
                              <div className="trace-body">
                                {trace ? (
                                  <>
                                    <code>{trace.query}</code>
                                    {trace.rows.length === 0 ? (
                                      <p>
                                        No matching records returned by this
                                        tool.
                                      </p>
                                    ) : (
                                      trace.rows.map((row) => (
                                        <button
                                          key={`${row.id}-${row.service || ""}`}
                                          onClick={() =>
                                            setSelected(
                                              graph.nodes.find(
                                                (n) => n.id === row.id,
                                              ) || {
                                                id: row.id,
                                                name: row.name,
                                                detail: row.detail,
                                                source: row.source,
                                                kind: "Evidence",
                                                x: 0,
                                                y: 0,
                                              },
                                            )
                                          }
                                        >
                                          <FileText size={12} />
                                          {row.name}
                                          <ArrowUpRight size={12} />
                                        </button>
                                      ))
                                    )}
                                  </>
                                ) : (
                                  <p>
                                    This tool runs against FalkorDB during an
                                    investigation.
                                  </p>
                                )}
                              </div>
                            </details>
                          );
                        })}
                      </div>
                      <div className="agent-footer">
                        <ShieldAlert size={14} />
                        <span>
                          Evidence-gated sandbox proposals.
                          <br />
                          Execution requires a separate responder action.
                        </span>
                      </div>
                    </section>
                  </div>

                  <section
                    id="context-controls"
                    className={`constraint-card ${graph.blocked ? "constraint-active" : ""}`}
                  >
                    <div className="constraint-icon">
                      <Zap size={20} />
                    </div>
                    <div>
                      <div className="eyebrow">THE PLOT TWIST</div>
                      <h3>
                        {graph.blocked
                          ? "New context: rollback is blocked."
                          : "The obvious fix isn’t always the right one."}
                      </h3>
                      <p>
                        {graph.blocked
                          ? "Schema migration #88 is active. Re-investigate to see how the agent’s decision changes."
                          : "Introduce an active schema migration. Watch one new connection change the recommendation."}
                      </p>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={disabled}
                      onClick={toggleConstraint}
                    >
                      {busy ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : graph.blocked ? (
                        <X size={14} />
                      ) : (
                        <Zap size={14} />
                      )}
                      {graph.blocked ? "Remove constraint" : "Inject migration"}
                      <ArrowRight size={14} />
                    </button>
                  </section>

                  {result && (
                    <section
                      id="agent-proposal"
                      className={`recommendation ${result.blocked ? "revised" : ""}`}
                      aria-live="polite"
                    >
                      <div className="recommendation-top">
                        <span className="eyebrow">
                          <CheckCheck size={15} />
                          {changed
                            ? "RECOMMENDATION REVISED"
                            : "SANDBOX PROPOSAL — NOT EXECUTED"}
                        </span>
                        <span className="tiny-badge">
                          {result.evidenceIds.length} linked sources
                        </span>
                      </div>
                      {changed && (
                        <div className="previous-action">
                          <span>{previous.summary}</span>
                          <ArrowDownRight size={16} /> New constraint changed
                          the decision
                        </div>
                      )}
                      <h2>{result.summary}</h2>
                      <p>{result.rationale}</p>
                      <div className="responders">
                        <span>Responders</span>
                        {result.owners.map((owner) => (
                          <span className="owner-chip" key={owner}>
                            {owner}
                          </span>
                        ))}
                      </div>
                      <div className="recommendation-bottom">
                        <span>
                          <Database size={14} /> Optional operator note. This
                          does not execute or verify an action.
                        </span>
                        <button
                          className="primary-button"
                          onClick={saveMemory}
                          disabled={
                            busy ||
                            saved ||
                            disabled ||
                            result.action === "hold"
                          }
                        >
                          {saved ? (
                            <Check size={15} />
                          ) : (
                            <BrainCircuit size={15} />
                          )}
                          {saved ? "Saved to memory" : "Record simulation note"}
                        </button>
                      </div>
                    </section>
                  )}
                </>
              )}
            </>
          )}

          <div hidden={tab !== "investigation"} id="handoff-workflow">
            <WorkflowPanel
              investigation={result}
              connected={connected}
              disabled={busy || running || !connected || !seeded}
              onBusyChange={setWorkflowBusy}
            />
          </div>

          {tab === "memory" && (
            <section className="memory-page">
              <div className="section-kicker">
                <Database size={16} /> PERSISTENT CONTEXT{" "}
                <span>{memory.length} lessons</span>
              </div>
              {memory.length === 0 ? (
                <div className="empty-state">
                  <BrainCircuit size={40} />
                  <h2>Your next incident starts smarter.</h2>
                  <p>
                    Load the scenario, investigate an incident, and record a
                    simulated resolution. The lesson will live here—even after a
                    restart.
                  </p>
                  <button
                    className="primary-button"
                    onClick={() => setTab("investigation")}
                  >
                    Open command center <ArrowRight size={15} />
                  </button>
                </div>
              ) : (
                memory.map((item) => (
                  <article className="memory-card" key={item.id}>
                    <div className="memory-card-icon">
                      <BrainCircuit size={23} />
                    </div>
                    <div>
                      <div className="memory-card-top">
                        <h2>{item.name}</h2>
                        <span className="tiny-badge">
                          {item.source.startsWith("resolutions/")
                            ? "OPERATOR SIMULATION NOTE"
                            : "SYNTHETIC HISTORY"}
                        </span>
                      </div>
                      <p>{item.detail}</p>
                      <div className="memory-source">
                        <FileText size={13} />
                        {item.source}
                        <span>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleString()
                            : "Seeded context"}
                        </span>
                      </div>
                    </div>
                  </article>
                ))
              )}
            </section>
          )}

          {tab === "queries" && (
            <section className="queries-page">
              {toolOrder.map((name, index) => (
                <article className="query-card" key={name}>
                  <div className="query-heading">
                    <span>0{index + 1}</span>
                    <div>
                      <h2>{tools[name].label}</h2>
                      <p>{tools[name].description}</p>
                    </div>
                    <span className="tiny-badge">CYPHER</span>
                  </div>
                  <pre>
                    <code>{tools[name].query}</code>
                  </pre>
                  <div className="query-params">
                    PARAMETERS <code>{'{ deployment: "deploy-247" }'}</code>
                  </div>
                </article>
              ))}
            </section>
          )}
          <footer className="page-footer">
            <span>
              AFTERSHOCK <span>/</span> Context changes everything.
            </span>
            <span>
              Built for Graph Hacks <span>·</span> Powered by FalkorDB
            </span>
          </footer>
        </div>
      </main>

      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside
            className="evidence-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Source evidence"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSelected(null);
            }}
          >
            <div className="drawer-heading">
              <span className="eyebrow">SOURCE EVIDENCE</span>
              <button
                className="icon-button"
                autoFocus
                aria-label="Close evidence"
                onClick={() => setSelected(null)}
              >
                <X size={19} />
              </button>
            </div>
            <span className="evidence-kind">{selected.kind}</span>
            <h2>{selected.name}</h2>
            <div className="source-path">
              <FileText size={16} />
              {selected.source}
            </div>
            <p>{selected.detail}</p>
            <h3>Connected context</h3>
            {graph.edges
              .filter(
                (e) => e.source === selected.id || e.target === selected.id,
              )
              .map((edge) => (
                <button
                  className="connection-item"
                  key={`${edge.source}-${edge.target}`}
                  onClick={() => {
                    const node = graph.nodes.find(
                      (n) =>
                        n.id ===
                        (edge.source === selected.id
                          ? edge.target
                          : edge.source),
                    );
                    if (node) setSelected(node);
                  }}
                >
                  <GitBranch size={15} />
                  <div>
                    <small>{edge.relation}</small>
                    {
                      graph.nodes.find(
                        (n) =>
                          n.id ===
                          (edge.source === selected.id
                            ? edge.target
                            : edge.source),
                      )?.name
                    }
                  </div>
                  <ArrowUpRight size={14} />
                </button>
              ))}
            <div className="source-notice">
              <Radio size={15} />
              Curated synthetic evidence for the demo. Source paths identify
              records in this scenario, not external integrations.
            </div>
          </aside>
        </div>
      )}

      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <section
            className="guide-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Demo field guide"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setHelp(false);
            }}
          >
            <button
              className="modal-close icon-button"
              autoFocus
              aria-label="Close field guide"
              onClick={() => setHelp(false)}
            >
              <X size={19} />
            </button>
            <div className="eyebrow">YOUR 90-SECOND FIELD GUIDE</div>
            <h2>
              One incident.
              <br />A better next decision.
            </h2>
            <ol>
              <li>
                <strong>Connect the context.</strong>
                <p>
                  Run <code>docker compose up -d</code>, reconnect, and load the
                  scenario.
                </p>
              </li>
              <li>
                <strong>Follow the failure.</strong>
                <p>
                  Investigate. Inspect the five real graph queries and the
                  rollback recommendation.
                </p>
              </li>
              <li>
                <strong>Change one fact.</strong>
                <p>
                  Inject the migration. Re-investigate. The new BLOCKS
                  relationship changes the recommendation to disabling a feature
                  flag.
                </p>
              </li>
              <li>
                <strong>Hand off and verify.</strong>
                <p>
                  Hand off to the responder, then run its sandbox action.
                  Inspect the persisted receipt and probe the sandbox to verify
                  its effect. Operator simulation notes are separate from
                  executed actions.
                </p>
              </li>
            </ol>
            <p className="guide-note">
              No prompt or model API key is required. The agents receive an
              incident record or a persisted handoff ID and operate against
              FalkorDB using an explicit policy.
            </p>
            <button className="primary-button" onClick={() => setHelp(false)}>
              Let’s investigate <ArrowRight size={15} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
