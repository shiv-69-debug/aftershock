import {
  createHash,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { getDatabase, query, readQuery, withGraph } from "../graph";

const scrypt = promisify(scryptCallback);
const controlGraph = () =>
  process.env.AFTERSHOCK_CONTROL_GRAPH || "aftershock_accounts";
export const COOKIE_NAME = "aftershock_session";
export type Identity = { id: string; username: string };
export type WorkspaceAccess = {
  id: string;
  name: string;
  graphName: string;
  knowledgeGraph: string;
  role: "owner" | "operator" | "reader";
  userId: string;
};
export class AccessError extends Error {
  constructor(
    message = "Not authorized",
    public status = 403,
  ) {
    super(message);
  }
}
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

async function control<T extends Record<string, unknown>>(
  cypher: string,
  params: Record<string, string | number | boolean> = {},
  write = false,
): Promise<T[]> {
  const graph = (await getDatabase()).selectGraph(controlGraph());
  if (write)
    return (await graph.query<T>(cypher, { params, TIMEOUT: 5000 })).data || [];
  try {
    return (
      (await graph.roQuery<T>(cypher, { params, TIMEOUT: 5000 })).data || []
    );
  } catch (error) {
    if (
      error instanceof Error &&
      /empty key|graph.+does not exist|non.?existing graph|unknown graph/i.test(
        error.message,
      )
    )
      return [];
    throw error;
  }
}

export async function register(
  username: string,
  password: string,
): Promise<Identity> {
  const normalized = username.trim().toLowerCase();
  if (
    !/^[a-z0-9][a-z0-9_-]{2,39}$/.test(normalized) ||
    password.length < 12 ||
    password.length > 128
  )
    throw new AccessError(
      "Use a 3–40 character username and a password of 12–128 characters.",
      400,
    );
  const id = randomUUID(),
    salt = randomBytes(16).toString("hex");
  const hash = ((await scrypt(password, salt, 64)) as Buffer).toString("hex");
  const result = await control<{ id: string }>(
    `MERGE (u:Account {username:$username}) ON CREATE SET u.id=$id, u.salt=$salt, u.passwordHash=$hash, u.createdAt=$at RETURN u.id AS id`,
    { username: normalized, id, salt, hash, at: Date.now() },
    true,
  );
  if (result[0]?.id !== id)
    throw new AccessError("That username is already registered.", 409);
  return { id, username: normalized };
}

export async function login(
  username: string,
  password: string,
): Promise<Identity> {
  const rows = await control<{
    id: string;
    username: string;
    salt: string;
    hash: string;
  }>(
    "MATCH (u:Account {username:$username}) RETURN u.id AS id,u.username AS username,u.salt AS salt,u.passwordHash AS hash",
    { username: username.trim().toLowerCase() },
  );
  const row = rows[0];
  const calculated = (await scrypt(
    password,
    row?.salt || "unknown-account",
    64,
  )) as Buffer;
  if (!row || !timingSafeEqual(calculated, Buffer.from(row.hash, "hex")))
    throw new AccessError("Invalid username or password.", 401);
  return { id: row.id, username: row.username };
}

export async function createSession(user: Identity): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await control(
    "MATCH (u:Account {id:$id}) CREATE (s:LoginSession {hash:$hash, expiresAt:$expiry}) CREATE (s)-[:AUTHENTICATES]->(u)",
    { id: user.id, hash: digest(token), expiry: Date.now() + 7 * 86400000 },
    true,
  );
  return token;
}

export function sessionToken(request: Request) {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((value) => value.trim())
      .find((value) => value.startsWith(`${COOKIE_NAME}=`))
      ?.slice(COOKIE_NAME.length + 1) || ""
  );
}

export async function authenticate(request: Request): Promise<Identity> {
  const token = sessionToken(request);
  if (!token)
    throw new AccessError("Sign in to access private workspaces.", 401);
  const rows = await control<Identity>(
    `MATCH (s:LoginSession {hash:$hash})-[:AUTHENTICATES]->(u:Account) WHERE s.expiresAt>$now RETURN u.id AS id,u.username AS username`,
    { hash: digest(token), now: Date.now() },
  );
  if (!rows[0])
    throw new AccessError("Your session expired. Sign in again.", 401);
  return rows[0];
}

export async function logout(request: Request) {
  await control(
    "MATCH (s:LoginSession {hash:$hash}) DETACH DELETE s",
    { hash: digest(sessionToken(request)) },
    true,
  );
}

export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new AccessError("Cross-origin mutations are not permitted.");
}

export async function createWorkspace(
  user: Identity,
  name: string,
): Promise<WorkspaceAccess> {
  const id = randomUUID(),
    graphName = `asw_${id.replaceAll("-", "")}`;
  const access: WorkspaceAccess = {
    id,
    name: name.trim(),
    graphName,
    knowledgeGraph: `${graphName}_knowledge`,
    role: "owner",
    userId: user.id,
  };
  if (!access.name || access.name.length > 100)
    throw new AccessError("Workspace name must be 1–100 characters.", 400);
  await withGraph(graphName, () =>
    query(
      "MERGE (m:WorkspaceMeta {id:'workspace'}) SET m.workspaceId=$id,m.revision=0,m.createdAt=$at",
      { id, at: Date.now() },
    ),
  );
  await control(
    "MATCH (u:Account {id:$user}) CREATE (w:Workspace {id:$id,name:$name,graphName:$graph,knowledgeGraph:$knowledge,createdAt:$at}) CREATE (u)-[:MEMBER_OF {role:'owner'}]->(w)",
    {
      user: user.id,
      id,
      name: access.name,
      graph: graphName,
      knowledge: access.knowledgeGraph,
      at: Date.now(),
    },
    true,
  );
  return access;
}

export async function workspaces(user: Identity): Promise<WorkspaceAccess[]> {
  const rows = await control<Omit<WorkspaceAccess, "userId">>(
    "MATCH (:Account {id:$user})-[m:MEMBER_OF]->(w:Workspace) RETURN w.id AS id,w.name AS name,w.graphName AS graphName,w.knowledgeGraph AS knowledgeGraph,m.role AS role ORDER BY w.createdAt DESC",
    { user: user.id },
  );
  return rows.map((row) => ({ ...row, userId: user.id }));
}

export async function accessWorkspace(
  user: Identity,
  id: string,
  write = false,
): Promise<WorkspaceAccess> {
  const access = (await workspaces(user)).find(
    (workspace) => workspace.id === id,
  );
  if (!access) throw new AccessError("Workspace not found.", 404);
  if (write && access.role === "reader")
    throw new AccessError("This workspace is read-only for your account.");
  return access;
}

export async function inviteMember(
  access: WorkspaceAccess,
  username: string,
  role: "operator" | "reader",
) {
  if (access.role !== "owner")
    throw new AccessError("Only the owner can change membership.");
  const rows = await control<{ id: string }>(
    `MATCH (u:Account {username:$username}), (w:Workspace {id:$workspace})
    WHERE u.id<>$owner MERGE (u)-[m:MEMBER_OF]->(w) SET m.role=$role RETURN u.id AS id`,
    {
      username: username.toLowerCase(),
      workspace: access.id,
      owner: access.userId,
      role,
    },
    true,
  );
  if (!rows.length)
    throw new AccessError(
      "Registered account not found, or it is the workspace owner.",
      404,
    );
}

export async function createWorkspaceToken(access: WorkspaceAccess) {
  if (access.role === "reader")
    throw new AccessError("Reader accounts cannot issue MCP credentials.");
  const token = `asmcp_${randomBytes(32).toString("base64url")}`;
  await control(
    "MATCH (u:Account {id:$user})-[:MEMBER_OF]->(w:Workspace {id:$workspace}) CREATE (t:WorkspaceToken {hash:$hash,expiresAt:$expiry}) CREATE (t)-[:FOR_WORKSPACE]->(w) CREATE (t)-[:ISSUED_TO]->(u)",
    {
      user: access.userId,
      workspace: access.id,
      hash: digest(token),
      expiry: Date.now() + 30 * 86400000,
    },
    true,
  );
  return token;
}

export async function authenticateWorkspaceToken(
  token: string,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const rows = await control<WorkspaceAccess>(
    `MATCH (t:WorkspaceToken {hash:$hash})-[:FOR_WORKSPACE]->(w:Workspace {id:$workspace}),
    (t)-[:ISSUED_TO]->(u:Account)-[m:MEMBER_OF]->(w) WHERE t.expiresAt>$now
    RETURN w.id AS id,w.name AS name,w.graphName AS graphName,w.knowledgeGraph AS knowledgeGraph,m.role AS role,u.id AS userId`,
    { hash: digest(token), workspace: workspaceId, now: Date.now() },
  );
  if (!rows[0])
    throw new AccessError(
      "Invalid, expired, or incorrectly scoped workspace token.",
      401,
    );
  return rows[0];
}

export async function revokeWorkspaceTokens(access: WorkspaceAccess) {
  await control(
    "MATCH (t:WorkspaceToken)-[:ISSUED_TO]->(:Account {id:$user}), (t)-[:FOR_WORKSPACE]->(:Workspace {id:$workspace}) DETACH DELETE t",
    { user: access.userId, workspace: access.id },
    true,
  );
}

export function inWorkspace<T>(
  access: WorkspaceAccess,
  operation: () => Promise<T>,
) {
  return withGraph(access.graphName, operation);
}
export async function workspaceRevision() {
  return (
    (
      await readQuery<{ revision: number }>(
        "MATCH (m:WorkspaceMeta {id:'workspace'}) RETURN m.revision AS revision",
      )
    )[0]?.revision || 0
  );
}
