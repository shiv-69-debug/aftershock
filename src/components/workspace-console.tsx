"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Activity,
  ArrowRight,
  AudioLines,
  BookOpen,
  BrainCircuit,
  Check,
  Database,
  FileText,
  GitBranch,
  KeyRound,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Network,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { IncidentGraph } from "./incident-graph";
import { WorkflowPanel } from "./workflow-panel";
import type { GraphNode, Investigation } from "@/lib/types";
import "./workspace-console.css";

type User = { id: string; username: string };
type Workspace = {
  id: string;
  name: string;
  role: "owner" | "operator" | "reader";
};
type Entity = {
  id: string;
  externalId: string;
  name: string;
  kind: string;
  detail: string;
  source: string;
};
type Episode = {
  id: string;
  kind: string;
  text: string;
  topic: string;
  createdAt: string;
  verified: boolean;
  stale?: boolean;
  sourceIds?: string[];
};
type Procedure = {
  id: string;
  versionId: string;
  version: number;
  name: string;
  topic: string;
  description: string;
  action: string;
  steps: string[];
  status: string;
  verifiedOutcomes: number;
};
type Data = {
  workspace: Workspace;
  dataset: {
    id: string;
    name: string;
    semantics: string;
    source: string;
  } | null;
  nodes: Entity[];
  edges: { source: string; target: string; relation: string }[];
  memory: {
    history: Episode[];
    notes: Episode[];
    observations: Episode[];
    facts: {
      id: string;
      subjectId: string;
      predicate: string;
      objectId: string;
      validFrom: string;
      source: string;
    }[];
    procedures: Procedure[];
    revision: number;
  };
  conversations: { id: string; title: string; createdAt: string }[];
  documents: {
    id: string;
    title: string;
    state: string;
    sourceUrl: string;
    error: string | null;
    stats: string | null;
  }[];
  workflow: {
    handoff: { id: string };
    receipt: { id: string; action: string } | null;
  }[];
  modelConfigured: boolean;
};
type Message = {
  id: string;
  role: string;
  text: string;
  index: number;
  evidence: string;
  createdAt: string;
};
type ToolResult = {
  paths?: {
    id?: string;
    name?: string;
    path: string[];
    pathIds: string[];
    hops?: number;
    weight?: number;
  }[];
  rows?: { id: string; name: string; score: number }[];
  semantics?: string;
  interpretation?: string;
  depth?: number;
  truncated?: boolean;
  algorithm?: string;
  sources?: {
    title: string;
    chunkId: string;
    text: string;
    sourceUrl: string;
  }[];
};
type Tab =
  | "graph"
  | "memory"
  | "sessions"
  | "documents"
  | "procedures"
  | "sandbox"
  | "access";
const tabs: { id: Tab; name: string; icon: typeof Network }[] = [
  { id: "graph", name: "Graph explorer", icon: Network },
  { id: "memory", name: "Memory", icon: BrainCircuit },
  { id: "sessions", name: "Agent sessions", icon: MessageSquare },
  { id: "documents", name: "Source documents", icon: FileText },
  { id: "procedures", name: "Procedures", icon: BookOpen },
  { id: "sandbox", name: "Sandbox", icon: ShieldCheck },
  { id: "access", name: "Access & MCP", icon: KeyRound },
];

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function WorkspaceConsole() {
  const [user, setUser] = useState<User | null>(null),
    [checking, setChecking] = useState(true);
  const [registering, setRegistering] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [workspaceId, setWorkspaceId] = useState("");
  const [data, setData] = useState<Data | null>(null),
    [tab, setTab] = useState<Tab>("graph"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [service, setService] = useState(""),
    [depth, setDepth] = useState(3),
    [target, setTarget] = useState(""),
    [pathFrom, setPathFrom] = useState("");
  const [result, setResult] = useState<ToolResult | null>(null),
    [comparison, setComparison] = useState<{
      one: number;
      three: number;
    } | null>(null),
    [path, setPath] = useState<string[]>([]),
    [focused, setFocused] = useState<Entity | null>(null);
  const [sessionId, setSessionId] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [question, setQuestion] = useState(""),
    [toolMode, setToolMode] = useState("auto");
  const [memoryTopic, setMemoryTopic] = useState(""),
    [noteKind, setNoteKind] = useState("operator_note"),
    [noteText, setNoteText] = useState(""),
    [privateNote, setPrivateNote] = useState(false),
    [asOf, setAsOf] = useState("");
  const [factSubject, setFactSubject] = useState(""),
    [factPredicate, setFactPredicate] = useState("STATUS"),
    [factObject, setFactObject] = useState(""),
    [acceptFact, setAcceptFact] = useState(false);
  const [docTitle, setDocTitle] = useState(""),
    [docSource, setDocSource] = useState(""),
    [docText, setDocText] = useState(""),
    [docPdf, setDocPdf] = useState(""),
    [docQuery, setDocQuery] = useState(""),
    [docResults, setDocResults] = useState<ToolResult | null>(null);
  const [procedureName, setProcedureName] = useState(""),
    [procedureTopic, setProcedureTopic] = useState(""),
    [procedureDescription, setProcedureDescription] = useState(""),
    [procedureAction, setProcedureAction] = useState("investigate"),
    [editProcedure, setEditProcedure] = useState<Procedure | null>(null);
  const [procedureVersion, setProcedureVersion] = useState(""),
    [receiptId, setReceiptId] = useState("");
  const [inviteName, setInviteName] = useState(""),
    [inviteRole, setInviteRole] = useState("reader"),
    [mcpToken, setMcpToken] = useState("");
  const [sandboxRun, setSandboxRun] = useState<Investigation | null>(null),
    [workflowBusy, setWorkflowBusy] = useState(false);
  const loadSequence = useRef(0);
  const writable = data?.workspace.role !== "reader";
  const owner = data?.workspace.role === "owner";
  const endpoint = `/api/workspaces/${workspaceId}`;

  const loadWorkspace = useCallback(async (id: string) => {
    const sequence = ++loadSequence.current;
    const value = await readResponse<Data>(
      await fetch(`/api/workspaces/${id}`, { cache: "no-store" }),
    );
    if (sequence !== loadSequence.current) return;
    setData(value);
    setService((current) =>
      value.nodes.some((node) => node.id === current)
        ? current
        : value.nodes.find((node) => node.kind === "Service")?.id || "",
    );
    setTarget((current) =>
      value.nodes.some((node) => node.id === current)
        ? current
        : value.nodes.find((node) => node.kind === "Service")?.id || "",
    );
    setPathFrom((current) =>
      value.nodes.some((node) => node.id === current)
        ? current
        : value.nodes.find((node) => node.kind === "Customer")?.id ||
          value.nodes.find((node) => node.kind === "Service")?.id ||
          "",
    );
  }, []);

  async function loadWorkspaces() {
    const response = await readResponse<{ workspaces: Workspace[] }>(
      await fetch("/api/workspaces"),
    );
    setWorkspaces(response.workspaces);
    return response.workspaces;
  }

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/auth");
        if (!response.ok) return;
        const { user } = await response.json();
        setUser(user);
        const spaces = await loadWorkspaces();
        const requested = new URLSearchParams(window.location.search).get(
          "workspace",
        );
        const id =
          spaces.find((space) => space.id === requested)?.id || spaces[0]?.id;
        if (id) {
          setWorkspaceId(id);
          await loadWorkspace(id);
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Could not connect.");
      } finally {
        setChecking(false);
      }
    })();
  }, [loadWorkspace]);

  useEffect(() => {
    if (
      !workspaceId ||
      !data?.documents.some(
        (document) =>
          document.state === "queued" || document.state === "running",
      )
    )
      return;
    const timer = setInterval(
      () => void loadWorkspace(workspaceId).catch(() => {}),
      5000,
    );
    return () => clearInterval(timer);
  }, [workspaceId, data?.documents, loadWorkspace]);

  async function run<T>(operation: () => Promise<T>): Promise<T | null> {
    setBusy(true);
    setError(null);
    setNotice("");
    try {
      return await operation();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Operation failed.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function post<T = Record<string, unknown>>(body: object) {
    return readResponse<T>(
      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  async function mutate(body: object) {
    const value = await post(body);
    await loadWorkspace(workspaceId);
    return value;
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const value = await readResponse<{ user: User }>(
        await fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: registering ? "register" : "login",
            username,
            password,
          }),
        }),
      );
      setPassword("");
      setUser(value.user);
      const spaces = await loadWorkspaces();
      if (spaces[0]) {
        setWorkspaceId(spaces[0].id);
        await loadWorkspace(spaces[0].id);
      }
    });
  }

  async function chooseWorkspace(id: string) {
    setWorkspaceId(id);
    setData(null);
    setMessages([]);
    setSessionId("");
    setResult(null);
    setPath([]);
    setFocused(null);
    setMcpToken("");
    setSandboxRun(null);
    setComparison(null);
    window.history.replaceState(
      null,
      "",
      `/workspaces?workspace=${encodeURIComponent(id)}`,
    );
    await run(() => loadWorkspace(id));
  }

  async function importFile(file: File) {
    if (file.size > 2_000_000) {
      setError("Dataset file must be at most 2 MB.");
      return;
    }
    await run(async () => {
      const text = await file.text();
      await mutate(
        file.name.toLowerCase().endsWith(".json")
          ? { op: "import_json", dataset: JSON.parse(text) }
          : { op: "import_compose", text },
      );
      setResult(null);
      setPath([]);
      setNotice(
        "Dataset imported. The prior version remains in your workspace history.",
      );
    });
  }

  async function graphTool(tool: string, args: object) {
    await run(async () => {
      const value = await post<ToolResult>({ op: "tool", tool, args });
      setResult(value);
      setPath(value.paths?.[0]?.pathIds || []);
      setComparison(null);
    });
  }

  async function loadMessages(id: string) {
    const value = await readResponse<{ messages: Message[] }>(
      await fetch(
        `${endpoint}?view=conversation&conversation=${encodeURIComponent(id)}`,
      ),
    );
    setMessages(value.messages);
  }

  async function sendQuestion(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      let id = sessionId;
      if (!id) {
        id = (
          await post<{ id: string }>({
            op: "conversation",
            title: question.slice(0, 80),
          })
        ).id;
        setSessionId(id);
      }
      const selection =
        toolMode === "auto"
          ? undefined
          : {
              tool: toolMode,
              args:
                toolMode === "trace_blast_radius"
                  ? { serviceId: service, depth }
                  : toolMode === "shortest_dependency_path"
                    ? { from: pathFrom, to: target, maxDepth: 6 }
                    : toolMode === "search_documents"
                      ? { question }
                      : toolMode === "recall_memory"
                        ? { topic: question }
                        : {},
            };
      try {
        await post({ op: "message", conversationId: id, question, selection });
        setQuestion("");
      } finally {
        await loadMessages(id);
        await loadWorkspace(workspaceId);
      }
    });
  }

  async function documentFile(file: File) {
    if (file.size > 2_000_000) {
      setError("Document file must be at most 2 MB.");
      return;
    }
    setDocTitle(file.name);
    setDocPdf("");
    if (file.name.toLowerCase().endsWith(".pdf")) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setDocPdf(
        btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")),
      );
      setDocText("");
    } else {
      const text = await file.text();
      if (text.length > 20000) {
        setError(
          "Text documents are limited to 20,000 characters per ingestion job.",
        );
        return;
      }
      setDocText(text);
    }
  }

  const allNodes = data?.nodes || [];
  const visibleNodes = (
    path.length
      ? allNodes.filter((node) => path.includes(node.id) || node.id === service)
      : allNodes
  ).slice(0, 60);
  const graphNodes: GraphNode[] = visibleNodes.map((node, index) => ({
    ...node,
    kind: node.kind as GraphNode["kind"],
    x:
      420 +
      Math.cos(
        (index / Math.max(visibleNodes.length, 1)) * Math.PI * 2 - Math.PI / 2,
      ) *
        (visibleNodes.length < 5 ? 200 : 275),
    y:
      295 +
      Math.sin(
        (index / Math.max(visibleNodes.length, 1)) * Math.PI * 2 - Math.PI / 2,
      ) *
        205,
  }));
  const graph = {
    nodes: graphNodes,
    edges: (data?.edges || []).filter(
      (edge) =>
        graphNodes.some((node) => node.id === edge.source) &&
        graphNodes.some((node) => node.id === edge.target),
    ),
    blocked: false,
  };
  const sources = [
    ...(data?.dataset
      ? [{ id: data.dataset.id, title: data.dataset.name }]
      : []),
    ...(data?.documents.filter((document) => document.state === "ready") || []),
  ];
  const sourceId = sources[0]?.id;

  if (checking)
    return (
      <div className="product-loading">
        <LoaderCircle className="spin" /> Connecting to your workspace…
      </div>
    );

  return (
    <div className="product-shell">
      <header className="product-header">
        <a href="/" className="product-brand">
          <AudioLines size={25} /> AFTERSHOCK<span>.</span>
        </a>
        <span className="product-edition">GRAPH WORKSPACES</span>
        <div>
          <a href="/workspace">Public sandbox demo</a>
          {user && (
            <>
              <span>{user.username}</span>
              <button
                disabled={busy}
                aria-label="Sign out"
                onClick={() =>
                  void run(async () => {
                    await fetch("/api/auth", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "logout" }),
                    });
                    setUser(null);
                    setData(null);
                    setWorkspaces([]);
                    setWorkspaceId("");
                    window.history.replaceState(null, "", "/workspaces");
                  })
                }
              >
                <LogOut size={16} />
              </button>
            </>
          )}
        </div>
      </header>
      {!user ? (
        <div className="product-login">
          <div className="product-login-copy">
            <span className="eyebrow">YOUR DATA. CONNECTED CONTEXT.</span>
            <h1>
              Investigate beyond
              <br />
              the demo.
            </h1>
            <p>
              Import a dependency graph, attach source documents, and give your
              agents a private workspace they can return to.
            </p>
            <div>
              <Database size={17} /> Isolated FalkorDB graphs
            </div>
            <div>
              <GitBranch size={17} /> Bounded tools over MCP
            </div>
            <div>
              <BrainCircuit size={17} /> Persistent sessions and sourced memory
            </div>
          </div>
          <form className="product-card auth-card" onSubmit={signIn}>
            <h2>{registering ? "Create your account" : "Welcome back"}</h2>
            <p>Workspace access is tied to your account.</p>
            <label>
              Username
              <input
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                required
                minLength={3}
                maxLength={40}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={registering ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={registering ? 12 : 1}
                maxLength={128}
              />
            </label>
            {error && (
              <p className="product-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy}>
              {busy ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <ArrowRight size={16} />
              )}
              {registering ? "Create account" : "Sign in"}
            </button>
            <button
              type="button"
              className="product-text-button"
              onClick={() => {
                setRegistering(!registering);
                setError(null);
              }}
            >
              {registering
                ? "Already have an account? Sign in"
                : "New here? Create an account"}
            </button>
          </form>
        </div>
      ) : (
        <div className="product-layout">
          <aside className="product-sidebar">
            <label>
              WORKSPACE
              <select
                aria-label="Choose workspace"
                value={workspaceId}
                disabled={busy}
                onChange={(event) => void chooseWorkspace(event.target.value)}
              >
                <option value="" disabled>
                  Select a workspace
                </option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
            </label>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const value = await readResponse<{ workspace: Workspace }>(
                    await fetch("/api/workspaces", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ name: workspaceName }),
                    }),
                  );
                  setWorkspaceName("");
                  await loadWorkspaces();
                  setWorkspaceId(value.workspace.id);
                  await loadWorkspace(value.workspace.id);
                  window.history.replaceState(
                    null,
                    "",
                    `/workspaces?workspace=${value.workspace.id}`,
                  );
                });
              }}
            >
              <input
                aria-label="New workspace name"
                placeholder="New workspace…"
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                maxLength={100}
                required
              />
              <button
                aria-label="Create workspace"
                disabled={busy || !workspaceName.trim()}
              >
                <Plus size={16} />
              </button>
            </form>
            <nav>
              {tabs.map((item) => (
                <button
                  key={item.id}
                  className={tab === item.id ? "active" : ""}
                  onClick={() => setTab(item.id)}
                >
                  <item.icon size={17} />
                  {item.name}
                </button>
              ))}
            </nav>
            <div className="product-sidebar-note">
              <ShieldCheck size={16} />
              <p>
                Each workspace has separate data and knowledge graphs.
                Conversations are private to their author.
              </p>
            </div>
          </aside>
          <div className="product-main">
            <div className="product-page-heading">
              <div>
                <span className="eyebrow">
                  {data?.workspace.name || "GET STARTED"}{" "}
                  {data && `· ${data.workspace.role.toUpperCase()}`}
                </span>
                <h1>{tabs.find((item) => item.id === tab)?.name}</h1>
              </div>
              {workspaceId && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void run(() => loadWorkspace(workspaceId))}
                >
                  <RefreshCw size={15} /> Refresh
                </button>
              )}
            </div>
            {error && (
              <div className="product-error" role="alert">
                {error}
                <button onClick={() => setError(null)}>Dismiss</button>
              </div>
            )}
            {notice && (
              <div className="product-notice" role="status">
                <Check size={15} />
                {notice}
              </div>
            )}
            {!data ? (
              <div className="product-card product-empty">
                <Database size={36} />
                <h2>Create or select a workspace</h2>
                <p>
                  Your imports, conversations, memory, and credentials stay
                  inside its access boundary.
                </p>
              </div>
            ) : (
              <>
                {tab === "graph" && (
                  <>
                    <section className="product-card import-card">
                      <div>
                        <h2>
                          {data.dataset?.name ||
                            "Start with a real dependency graph"}
                        </h2>
                        <p>
                          {data.dataset?.semantics ||
                            "Import JSON or a Compose file, or load a pinned public OpenTelemetry dataset."}
                        </p>
                        {data.dataset?.source && (
                          <code>{data.dataset.source}</code>
                        )}
                      </div>
                      <div className="product-actions">
                        <label
                          className={`secondary-button file-button ${!writable ? "disabled" : ""}`}
                        >
                          <Upload size={15} /> Import JSON / Compose
                          <input
                            aria-label="Import dataset file"
                            type="file"
                            accept=".json,.yml,.yaml"
                            disabled={busy || !writable}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (file) void importFile(file);
                              event.target.value = "";
                            }}
                          />
                        </label>
                        <button
                          className="secondary-button"
                          disabled={busy || !writable}
                          onClick={() =>
                            void run(async () => {
                              await mutate({ op: "import_public_sample" });
                              setNotice(
                                "Imported the pinned public OpenTelemetry Compose topology with source provenance.",
                              );
                            })
                          }
                        >
                          Load public dataset
                        </button>
                        <button
                          className="product-text-button"
                          disabled={busy || !owner}
                          onClick={() =>
                            void run(() => mutate({ op: "training" }))
                          }
                        >
                          Use training example
                        </button>
                      </div>
                    </section>
                    {data.dataset && (
                      <>
                        <section className="product-card graph-toolbar">
                          <label>
                            Service
                            <select
                              aria-label="Investigation service"
                              value={service}
                              onChange={(event) => {
                                setService(event.target.value);
                                setPath([]);
                              }}
                            >
                              {allNodes
                                .filter((node) => node.kind === "Service")
                                .map((node) => (
                                  <option key={node.id} value={node.id}>
                                    {node.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            Depth <strong>{depth}</strong>
                            <input
                              aria-label="Traversal depth"
                              type="range"
                              min={1}
                              max={6}
                              value={depth}
                              onChange={(event) =>
                                setDepth(Number(event.target.value))
                              }
                            />
                          </label>
                          <button
                            className="primary-button"
                            disabled={busy || !service}
                            onClick={() =>
                              void graphTool("trace_blast_radius", {
                                serviceId: service,
                                depth,
                              })
                            }
                          >
                            {busy ? (
                              <LoaderCircle className="spin" size={15} />
                            ) : (
                              <Network size={15} />
                            )}{" "}
                            Trace paths via MCP
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy || !service}
                            onClick={() =>
                              void run(async () => {
                                const [one, three] = await Promise.all([
                                  post<ToolResult>({
                                    op: "tool",
                                    tool: "trace_blast_radius",
                                    args: { serviceId: service, depth: 1 },
                                  }),
                                  post<ToolResult>({
                                    op: "tool",
                                    tool: "trace_blast_radius",
                                    args: { serviceId: service, depth: 3 },
                                  }),
                                ]);
                                setComparison({
                                  one: one.paths?.length || 0,
                                  three: three.paths?.length || 0,
                                });
                                setResult(three);
                                setPath([]);
                              })
                            }
                          >
                            Compare 1 vs 3 hops
                          </button>
                        </section>
                        {comparison && (
                          <div className="depth-comparison">
                            <div>
                              <span>1 HOP</span>
                              <strong>{comparison.one}</strong>
                              <p>recorded paths</p>
                            </div>
                            <ArrowRight size={22} />
                            <div>
                              <span>3 HOPS</span>
                              <strong>{comparison.three}</strong>
                              <p>recorded paths</p>
                            </div>
                            <p>
                              Deeper traversal follows actual relationships. The
                              returned paths explain each connection.
                            </p>
                          </div>
                        )}
                        <div className="product-graph-grid">
                          <section className="product-card product-graph">
                            <header>
                              <strong>Connected data</strong>
                              <span>
                                {visibleNodes.length}/{allNodes.length} entities
                                shown
                              </span>
                            </header>
                            <IncidentGraph
                              graph={graph}
                              selected={focused?.id || null}
                              onSelect={(node) =>
                                setFocused(
                                  allNodes.find(
                                    (entity) => entity.id === node.id,
                                  ) || null,
                                )
                              }
                              highlighted={path}
                              path={path}
                              running={busy}
                            />
                          </section>
                          <section className="product-card path-panel">
                            <h2>Exact evidence paths</h2>
                            <p>Select a path to highlight only its edges.</p>
                            {result?.paths?.length ? (
                              result.paths.map((item, index) => (
                                <button
                                  className={
                                    path.join() === item.pathIds.join()
                                      ? "path-row selected"
                                      : "path-row"
                                  }
                                  key={index}
                                  onClick={() => setPath(item.pathIds)}
                                >
                                  <span>
                                    {item.hops ?? item.path.length - 1} hops
                                    {item.weight !== undefined &&
                                      ` · weight ${item.weight}`}
                                  </span>
                                  <strong>{item.path.join(" → ")}</strong>
                                </button>
                              ))
                            ) : (
                              <div className="path-empty">
                                {result?.paths
                                  ? "No recorded connection within this bound. This does not prove there is no impact."
                                  : "Run a traversal or shortest-path query to see the recorded routes."}
                              </div>
                            )}
                            {result?.truncated && (
                              <p>
                                Showing the first 100 paths. Narrow the depth to
                                inspect further.
                              </p>
                            )}
                            {focused && (
                              <div className="entity-inspector">
                                <span>{focused.kind}</span>
                                <h3>{focused.name}</h3>
                                <p>
                                  {focused.detail ||
                                    "No description in the imported source."}
                                </p>
                                <code>{focused.source}</code>
                              </div>
                            )}
                          </section>
                        </div>
                        <section className="product-card algorithm-controls">
                          <div>
                            <h2>Bounded shortest path</h2>
                            <p>
                              FalkorDB <code>algo.SPpaths</code> · outgoing
                              dependencies and usage · maximum 6 hops
                            </p>
                          </div>
                          <label>
                            From
                            <select
                              value={pathFrom}
                              onChange={(event) =>
                                setPathFrom(event.target.value)
                              }
                            >
                              {allNodes
                                .filter((node) => node.kind !== "Team")
                                .map((node) => (
                                  <option key={node.id} value={node.id}>
                                    {node.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label>
                            To
                            <select
                              value={target}
                              onChange={(event) =>
                                setTarget(event.target.value)
                              }
                            >
                              {allNodes
                                .filter((node) => node.kind !== "Team")
                                .map((node) => (
                                  <option key={node.id} value={node.id}>
                                    {node.name}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <button
                            className="secondary-button"
                            disabled={busy || !pathFrom || !target}
                            onClick={() =>
                              void graphTool("shortest_dependency_path", {
                                from: pathFrom,
                                to: target,
                                maxDepth: 6,
                              })
                            }
                          >
                            Find shortest path
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              void graphTool("rank_services", { limit: 10 })
                            }
                          >
                            Run structural PageRank
                          </button>
                        </section>
                        {result?.rows && (
                          <section className="product-card">
                            <h2>Structural ranking</h2>
                            <p>{result.interpretation}</p>
                            <div className="product-table-wrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Service</th>
                                    <th>PageRank</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {result.rows.map((row) => (
                                    <tr key={row.id}>
                                      <td>{row.name}</td>
                                      <td>{row.score.toFixed(6)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </section>
                        )}
                      </>
                    )}
                  </>
                )}

                {tab === "memory" && (
                  <>
                    <section className="product-card memory-filter">
                      <h2>Recall sourced context</h2>
                      <label>
                        Topic
                        <input
                          value={memoryTopic}
                          onChange={(event) =>
                            setMemoryTopic(event.target.value)
                          }
                          placeholder="checkout, deployment, ownership…"
                        />
                      </label>
                      <label>
                        As of time
                        <input
                          type="datetime-local"
                          value={asOf}
                          onChange={(event) => setAsOf(event.target.value)}
                        />
                      </label>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const memory = await readResponse<Data["memory"]>(
                              await fetch(
                                `${endpoint}?view=memory&topic=${encodeURIComponent(memoryTopic)}${asOf ? `&asOf=${encodeURIComponent(new Date(asOf).toISOString())}` : ""}`,
                              ),
                            );
                            setData((current) =>
                              current ? { ...current, memory } : current,
                            );
                          })
                        }
                      >
                        Recall memory
                      </button>
                    </section>
                    <div className="memory-columns">
                      {[
                        {
                          title: "Historical & verified episodes",
                          rows: data.memory.history,
                        },
                        {
                          title: "Recent operator notes",
                          rows: data.memory.notes,
                        },
                        {
                          title: "Agent observations",
                          rows: data.memory.observations,
                        },
                      ].map((group) => (
                        <section className="product-card" key={group.title}>
                          <h2>{group.title}</h2>
                          <p>
                            {group.title.includes("notes")
                              ? "Limited separately to three notes, so repeated demos cannot crowd out history."
                              : "Persistent records with time and source context."}
                          </p>
                          {group.rows.length ? (
                            group.rows.map((episode) => (
                              <article
                                className="episode-card"
                                key={episode.id}
                              >
                                <div>
                                  <span>{episode.kind}</span>
                                  {episode.stale && <b>STALE CONTEXT</b>}
                                  {episode.verified && <b>SANDBOX VERIFIED</b>}
                                </div>
                                <h3>{episode.topic}</h3>
                                <p>{episode.text}</p>
                                <small>
                                  {new Date(episode.createdAt).toLocaleString()}
                                </small>
                                {episode.sourceIds?.length ? (
                                  <code>{episode.sourceIds.join(", ")}</code>
                                ) : null}
                              </article>
                            ))
                          ) : (
                            <p className="muted-empty">No matching records.</p>
                          )}
                        </section>
                      ))}
                    </div>
                    <form
                      className="product-card product-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          await mutate({
                            op: "episode",
                            episode: {
                              kind: noteKind,
                              topic: memoryTopic || "workspace",
                              text: noteText,
                              sourceIds: sourceId ? [sourceId] : [],
                              visibility: privateNote ? "private" : "workspace",
                            },
                          });
                          setNoteText("");
                        });
                      }}
                    >
                      <h2>Record a sourced episode</h2>
                      <div className="form-row">
                        <label>
                          Kind
                          <select
                            value={noteKind}
                            onChange={(event) =>
                              setNoteKind(event.target.value)
                            }
                          >
                            <option value="operator_note">Operator note</option>
                            <option value="historical">
                              Historical incident
                            </option>
                            <option value="observation">Observation</option>
                          </select>
                        </label>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={privateNote}
                            onChange={(event) =>
                              setPrivateNote(event.target.checked)
                            }
                          />{" "}
                          Private to my account
                        </label>
                      </div>
                      <label>
                        Record
                        <textarea
                          value={noteText}
                          onChange={(event) => setNoteText(event.target.value)}
                          rows={3}
                          maxLength={6000}
                          required
                        />
                      </label>
                      <p>
                        The active dataset is attached as provenance. An
                        operator report is never automatically marked verified.
                      </p>
                      <button
                        className="primary-button"
                        disabled={busy || !writable}
                      >
                        Save episode
                      </button>
                    </form>
                    <section className="product-card">
                      <h2>Semantic facts</h2>
                      <p>
                        Accepted facts preserve source provenance and validity
                        intervals. Contradictory functional facts retain
                        supersession links.
                      </p>
                      <div className="product-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Subject</th>
                              <th>Relationship</th>
                              <th>Object</th>
                              <th>Valid from</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.memory.facts.map((fact) => (
                              <tr key={fact.id}>
                                <td>{fact.subjectId}</td>
                                <td>{fact.predicate}</td>
                                <td>{fact.objectId}</td>
                                <td>
                                  {new Date(
                                    fact.validFrom,
                                  ).toLocaleDateString()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <form
                        className="product-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            if (!sourceId)
                              throw new Error("Import a source first.");
                            await mutate({
                              op: "fact",
                              fact: {
                                subjectId: factSubject,
                                predicate: factPredicate,
                                objectId: factObject,
                                sourceIds: [sourceId],
                                accept: acceptFact,
                              },
                            });
                            setFactObject("");
                          });
                        }}
                      >
                        <div className="form-row">
                          <label>
                            Subject
                            <input
                              value={factSubject}
                              onChange={(event) =>
                                setFactSubject(event.target.value)
                              }
                              required
                              maxLength={120}
                            />
                          </label>
                          <label>
                            Predicate
                            <select
                              value={factPredicate}
                              onChange={(event) =>
                                setFactPredicate(event.target.value)
                              }
                            >
                              {[
                                "STATUS",
                                "VERSION",
                                "OWNED_BY",
                                "DEPENDS_ON",
                                "DOCUMENTED_AS",
                              ].map((value) => (
                                <option key={value}>{value}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Object
                            <input
                              value={factObject}
                              onChange={(event) =>
                                setFactObject(event.target.value)
                              }
                              required
                              maxLength={300}
                            />
                          </label>
                        </div>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={acceptFact}
                            disabled={!owner}
                            onChange={(event) =>
                              setAcceptFact(event.target.checked)
                            }
                          />{" "}
                          Accept as a sourced workspace assertion (owner only)
                        </label>
                        <button
                          className="secondary-button"
                          disabled={busy || !writable || !sourceId}
                        >
                          Record fact
                        </button>
                      </form>
                    </section>
                  </>
                )}

                {tab === "sessions" && (
                  <div className="session-layout">
                    <aside className="product-card session-list">
                      <h2>Private sessions</h2>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const { id } = await post<{ id: string }>({
                              op: "conversation",
                              title: `Investigation ${new Date().toLocaleDateString()}`,
                            });
                            setSessionId(id);
                            setMessages([]);
                            await loadWorkspace(workspaceId);
                          })
                        }
                      >
                        <Plus size={14} /> New session
                      </button>
                      {data.conversations.map((session) => (
                        <button
                          className={sessionId === session.id ? "selected" : ""}
                          key={session.id}
                          onClick={() =>
                            void run(async () => {
                              setSessionId(session.id);
                              await loadMessages(session.id);
                            })
                          }
                        >
                          {session.title}
                          <small>
                            {new Date(session.createdAt).toLocaleString()}
                          </small>
                        </button>
                      ))}
                    </aside>
                    <section className="product-card session-thread">
                      <h2>Investigate through MCP</h2>
                      <p>
                        Messages and tool evidence persist in FalkorDB. Only
                        your account can read this conversation.
                      </p>
                      <div className="persistent-messages">
                        {messages.map((message) =>
                          message.role === "tool" ? (
                            <details key={message.id} className="session-tool">
                              <summary>Actual MCP tool result</summary>
                              <pre>{message.evidence}</pre>
                            </details>
                          ) : (
                            <article
                              key={message.id}
                              className={`session-message ${message.role}`}
                            >
                              <span>
                                {message.role === "user" ? "YOU" : "AFTERSHOCK"}
                              </span>
                              <p>{message.text}</p>
                            </article>
                          ),
                        )}
                      </div>
                      <form onSubmit={sendQuestion} className="product-form">
                        <label>
                          Tool selection
                          <select
                            value={toolMode}
                            onChange={(event) =>
                              setToolMode(event.target.value)
                            }
                          >
                            <option value="auto">
                              Agent selects from MCP tools{" "}
                              {data.modelConfigured
                                ? ""
                                : "(requires model key)"}
                            </option>
                            <option value="trace_blast_radius">
                              Trace selected service
                            </option>
                            <option value="shortest_dependency_path">
                              Shortest path between selected entities
                            </option>
                            <option value="search_documents">
                              Search source documents
                            </option>
                            <option value="recall_memory">Recall memory</option>
                            <option value="rank_services">Rank services</option>
                          </select>
                        </label>
                        <label>
                          Question
                          <textarea
                            aria-label="Workspace question"
                            value={question}
                            onChange={(event) =>
                              setQuestion(event.target.value)
                            }
                            maxLength={1500}
                            rows={3}
                            placeholder="What depends on the selected service? Which sources explain this connection?"
                            required
                          />
                        </label>
                        <button
                          className="primary-button"
                          disabled={busy || !question.trim()}
                        >
                          {busy ? (
                            <LoaderCircle size={16} className="spin" />
                          ) : (
                            <ArrowRight size={16} />
                          )}{" "}
                          Run workspace agent
                        </button>
                      </form>
                    </section>
                  </div>
                )}

                {tab === "documents" && (
                  <>
                    <div className="product-notice">
                      <BookOpen size={16} /> GraphRAG SDK 1.4.0 · Groq
                      extraction · local MiniLM embeddings · separate workspace
                      knowledge graph
                    </div>
                    <form
                      className="product-card product-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          await mutate({
                            op: "document",
                            document: {
                              title: docTitle,
                              sourceUrl: docSource,
                              fileType: docPdf ? "pdf" : "text",
                              ...(docPdf
                                ? { contentBase64: docPdf }
                                : { text: docText }),
                            },
                          });
                          setDocText("");
                          setDocPdf("");
                          setDocTitle("");
                          setNotice(
                            "Document queued. Source passages are retrievable only after successful indexing.",
                          );
                        });
                      }}
                    >
                      <h2>Ingest a source document</h2>
                      <p>
                        Upload a runbook, postmortem, or ticket. Extracted facts
                        remain unverified source evidence and cannot authorize
                        sandbox actions.
                      </p>
                      <label className="secondary-button file-button">
                        <Upload size={15} /> Choose PDF, Markdown or text
                        <input
                          aria-label="Upload source document"
                          type="file"
                          accept=".pdf,.md,.txt"
                          disabled={busy || !writable}
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void documentFile(file);
                          }}
                        />
                      </label>
                      <div className="form-row">
                        <label>
                          Title
                          <input
                            value={docTitle}
                            onChange={(event) =>
                              setDocTitle(event.target.value)
                            }
                            required
                            maxLength={200}
                          />
                        </label>
                        <label>
                          Original source URL (optional)
                          <input
                            value={docSource}
                            onChange={(event) =>
                              setDocSource(event.target.value)
                            }
                            maxLength={1500}
                          />
                        </label>
                      </div>
                      {docPdf ? (
                        <p>
                          PDF attached. The worker extracts text; scanned-image
                          OCR is not supported.
                        </p>
                      ) : (
                        <label>
                          Document text
                          <textarea
                            value={docText}
                            onChange={(event) => setDocText(event.target.value)}
                            rows={5}
                            maxLength={20000}
                            required
                          />
                        </label>
                      )}
                      <button
                        className="primary-button"
                        disabled={
                          busy || !writable || (!docPdf && !docText.trim())
                        }
                      >
                        Queue GraphRAG ingestion
                      </button>
                    </form>
                    <section className="product-card">
                      <h2>Indexing jobs</h2>
                      {data.documents.length ? (
                        data.documents.map((document) => (
                          <article className="document-row" key={document.id}>
                            <div>
                              <strong>{document.title}</strong>
                              <span
                                className={`document-status ${document.state}`}
                              >
                                {document.state}
                              </span>
                              <code>{document.sourceUrl || document.id}</code>
                              {document.error && (
                                <p className="product-error">
                                  {document.error}
                                </p>
                              )}
                              {document.stats && (
                                <details>
                                  <summary>
                                    SDK ingestion and index results
                                  </summary>
                                  <pre>{document.stats}</pre>
                                </details>
                              )}
                            </div>
                            {document.state !== "ready" && (
                              <button
                                className="secondary-button"
                                disabled={busy || !writable}
                                onClick={() =>
                                  void run(() =>
                                    post({
                                      op: "retry_document",
                                      documentId: document.id,
                                    }),
                                  )
                                }
                              >
                                Retry / resume
                              </button>
                            )}
                          </article>
                        ))
                      ) : (
                        <p>No source documents uploaded yet.</p>
                      )}
                    </section>
                    <form
                      className="product-card product-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () =>
                          setDocResults(
                            await post<ToolResult>({
                              op: "tool",
                              tool: "search_documents",
                              args: { question: docQuery },
                            }),
                          ),
                        );
                      }}
                    >
                      <h2>Retrieve source-backed context</h2>
                      <label>
                        Search
                        <input
                          value={docQuery}
                          onChange={(event) => setDocQuery(event.target.value)}
                          required
                          maxLength={1500}
                        />
                      </label>
                      <button className="secondary-button" disabled={busy}>
                        Retrieve through MCP + GraphRAG
                      </button>
                      {docResults?.sources?.map((source) => (
                        <article
                          className="document-extract"
                          key={source.chunkId}
                        >
                          <h3>{source.title}</h3>
                          <p>{source.text}</p>
                          <code>
                            {source.chunkId} · {source.sourceUrl}
                          </code>
                        </article>
                      ))}
                    </form>
                  </>
                )}

                {tab === "procedures" && (
                  <>
                    <section className="product-card">
                      <h2>Versioned procedural memory</h2>
                      <p>
                        Procedures retain source evidence and immutable
                        versions. Only real, matching sandbox receipts increase
                        the verified-outcome count. Historical success does not
                        replace current authorization checks.
                      </p>
                      {data.memory.procedures.map((procedure) => (
                        <article
                          className="procedure-row"
                          key={procedure.versionId}
                        >
                          <div>
                            <h3>
                              {procedure.name} <span>v{procedure.version}</span>
                            </h3>
                            <p>{procedure.description}</p>
                            <small>
                              {procedure.status} · {procedure.action} ·{" "}
                              {procedure.verifiedOutcomes} verified sandbox
                              outcomes
                            </small>
                            <code>{procedure.steps.join(" → ")}</code>
                          </div>
                          <button
                            className="secondary-button"
                            disabled={!owner || busy}
                            onClick={() => {
                              setEditProcedure(procedure);
                              setProcedureName(procedure.name);
                              setProcedureTopic(procedure.topic);
                              setProcedureDescription(procedure.description);
                              setProcedureAction(procedure.action);
                            }}
                          >
                            Create next version
                          </button>
                        </article>
                      ))}
                    </section>
                    <form
                      className="product-card product-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          if (!sourceId)
                            throw new Error("Import a source first.");
                          await mutate({
                            op: "procedure",
                            procedure: {
                              id: editProcedure?.id,
                              expectedVersion: editProcedure?.version || 0,
                              name: procedureName,
                              topic: procedureTopic,
                              description: procedureDescription,
                              action: procedureAction,
                              steps: [
                                "read_dependencies",
                                "read_sources",
                                "recall_memory",
                                "check_constraints",
                                "verify_sandbox",
                              ],
                              sourceIds: [sourceId],
                              publish: true,
                            },
                          });
                          setEditProcedure(null);
                          setProcedureName("");
                          setProcedureDescription("");
                        });
                      }}
                    >
                      <h2>
                        {editProcedure
                          ? `Version ${editProcedure.version + 1}`
                          : "Publish a sourced procedure"}
                      </h2>
                      <div className="form-row">
                        <label>
                          Name
                          <input
                            value={procedureName}
                            onChange={(event) =>
                              setProcedureName(event.target.value)
                            }
                            required
                          />
                        </label>
                        <label>
                          Topic
                          <input
                            value={procedureTopic}
                            onChange={(event) =>
                              setProcedureTopic(event.target.value)
                            }
                            required
                          />
                        </label>
                        <label>
                          Allowed action
                          <select
                            value={procedureAction}
                            onChange={(event) =>
                              setProcedureAction(event.target.value)
                            }
                          >
                            <option value="investigate">
                              Investigation only
                            </option>
                            <option value="rollback">Sandbox rollback</option>
                            <option value="disable_flag">
                              Sandbox flag mitigation
                            </option>
                          </select>
                        </label>
                      </div>
                      <label>
                        Procedure description
                        <textarea
                          value={procedureDescription}
                          onChange={(event) =>
                            setProcedureDescription(event.target.value)
                          }
                          rows={3}
                          required
                          maxLength={3000}
                        />
                      </label>
                      <button
                        className="primary-button"
                        disabled={busy || !owner || !sourceId}
                      >
                        Publish version
                      </button>
                    </form>
                    <form
                      className="product-card product-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(() =>
                          mutate({
                            op: "learn_outcome",
                            procedureVersionId: procedureVersion,
                            receiptId,
                          }),
                        );
                      }}
                    >
                      <h2>Learn from a verified outcome</h2>
                      <div className="form-row">
                        <label>
                          Published procedure
                          <select
                            value={procedureVersion}
                            onChange={(event) =>
                              setProcedureVersion(event.target.value)
                            }
                            required
                          >
                            <option value="">Choose procedure</option>
                            {data.memory.procedures
                              .filter(
                                (procedure) => procedure.status === "published",
                              )
                              .map((procedure) => (
                                <option
                                  key={procedure.versionId}
                                  value={procedure.versionId}
                                >
                                  {procedure.name} v{procedure.version}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          Sandbox receipt
                          <select
                            value={receiptId}
                            onChange={(event) =>
                              setReceiptId(event.target.value)
                            }
                            required
                          >
                            <option value="">Choose receipt</option>
                            {data.workflow
                              .filter((item) => item.receipt)
                              .map((item) => (
                                <option
                                  key={item.receipt!.id}
                                  value={item.receipt!.id}
                                >
                                  {item.receipt!.action} ·{" "}
                                  {item.receipt!.id.slice(0, 8)}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <button
                        className="secondary-button"
                        disabled={
                          busy || !writable || !procedureVersion || !receiptId
                        }
                      >
                        Verify and attach outcome
                      </button>
                    </form>
                  </>
                )}

                {tab === "sandbox" && (
                  <>
                    <section className="product-card">
                      <h2>Workspace-isolated training sandbox</h2>
                      <p>
                        Real imported topologies are investigated as recorded
                        data. Sandbox mutations require the explicit training
                        runbook and measured fixture evidence; document
                        extraction never supplies action permission.
                      </p>
                      <div className="product-actions">
                        <button
                          className="secondary-button"
                          disabled={busy || !owner}
                          onClick={() =>
                            void run(() => mutate({ op: "training" }))
                          }
                        >
                          Load training dataset
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy || !writable}
                          onClick={() =>
                            void run(() =>
                              mutate({
                                op: "training_constraint",
                                active: true,
                              }),
                            )
                          }
                        >
                          Inject training migration
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy || !writable}
                          onClick={() =>
                            void run(() =>
                              mutate({
                                op: "training_constraint",
                                active: false,
                              }),
                            )
                          }
                        >
                          Remove migration
                        </button>
                        <button
                          className="primary-button"
                          disabled={busy || workflowBusy || !writable}
                          onClick={() =>
                            void run(async () => {
                              setSandboxRun(
                                await post<Investigation>({
                                  op: "sandbox_investigate",
                                }),
                              );
                            })
                          }
                        >
                          Investigate sandbox evidence
                        </button>
                      </div>
                      {sandboxRun && (
                        <div className="sandbox-proposal">
                          <h3>{sandboxRun.summary}</h3>
                          <p>{sandboxRun.rationale}</p>
                        </div>
                      )}
                    </section>
                    <WorkflowPanel
                      investigation={sandboxRun}
                      connected
                      disabled={busy || !writable}
                      onBusyChange={setWorkflowBusy}
                      apiRoot={endpoint}
                    />
                  </>
                )}

                {tab === "access" && (
                  <>
                    <section className="product-card">
                      <h2>Workspace access boundary</h2>
                      <p>
                        This workspace has its own domain graph, GraphRAG
                        knowledge graph, and ontology graph. Every HTTP request
                        checks membership. Private conversations and private
                        notes also check author identity.
                      </p>
                      <code>Workspace ID: {workspaceId}</code>
                      <p>
                        Role: <strong>{data.workspace.role}</strong>. Owners
                        manage members and procedures; operators can
                        import/write; readers can use bounded observation tools.
                      </p>
                    </section>
                    <form
                      className="product-card product-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                          await post({
                            op: "invite",
                            username: inviteName,
                            role: inviteRole,
                          });
                          setNotice("Workspace membership updated.");
                          setInviteName("");
                        });
                      }}
                    >
                      <h2>Add an existing account</h2>
                      <div className="form-row">
                        <label>
                          Username
                          <input
                            value={inviteName}
                            onChange={(event) =>
                              setInviteName(event.target.value)
                            }
                            required
                          />
                        </label>
                        <label>
                          Role
                          <select
                            value={inviteRole}
                            onChange={(event) =>
                              setInviteRole(event.target.value)
                            }
                          >
                            <option value="reader">Reader</option>
                            <option value="operator">Operator</option>
                          </select>
                        </label>
                      </div>
                      <button
                        className="secondary-button"
                        disabled={busy || !owner}
                      >
                        Grant workspace access
                      </button>
                    </form>
                    <section className="product-card">
                      <h2>Connect an MCP client</h2>
                      <p>
                        The stdio server exposes eight bounded read tools,
                        including shortest paths, PageRank, memory, and GraphRAG
                        retrieval. It accepts a workspace-scoped credential; no
                        raw Cypher or unrestricted writes are exposed.
                      </p>
                      <button
                        className="primary-button"
                        disabled={busy || !writable}
                        onClick={() =>
                          void run(async () => {
                            const value = await post<{ token: string }>({
                              op: "token",
                            });
                            setMcpToken(value.token);
                          })
                        }
                      >
                        <KeyRound size={15} /> Issue MCP token
                      </button>
                      {mcpToken && (
                        <>
                          <p>
                            Copy this token into your local MCP client
                            configuration. It is shown only in this view and
                            expires after 30 days.
                          </p>
                          <pre className="mcp-config">
                            {JSON.stringify(
                              {
                                mcpServers: {
                                  aftershock: {
                                    command: "node",
                                    args: [
                                      "ABSOLUTE_PROJECT_PATH/node_modules/tsx/dist/cli.mjs",
                                      "ABSOLUTE_PROJECT_PATH/scripts/mcp-server.ts",
                                    ],
                                    env: {
                                      AFTERSHOCK_WORKSPACE_ID: workspaceId,
                                      AFTERSHOCK_MCP_TOKEN: mcpToken,
                                    },
                                  },
                                },
                              },
                              null,
                              2,
                            )}
                          </pre>
                        </>
                      )}
                      <p>
                        Replace ABSOLUTE_PROJECT_PATH with the project directory
                        on the machine running the stdio server. Your browser
                        session cookie is never sent to an MCP client.
                      </p>
                    </section>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
