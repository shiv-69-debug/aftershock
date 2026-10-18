import { randomUUID } from "node:crypto";
import { z } from "zod";
import { parse as parseYaml } from "yaml";
import { query, readQuery } from "../graph";
import { AccessError } from "./identity";

const identifier = z.string().trim().min(1).max(120);
const entity = z.object({
  id: identifier,
  name: z.string().trim().min(1).max(160),
  description: z.string().max(3000).default(""),
});
export const datasetSchema = z.object({
  name: z.string().trim().min(1).max(160),
  source: z.object({
    title: z.string().min(1).max(300),
    url: z.string().max(1500).default(""),
    license: z.string().max(200).default("unspecified"),
    semantics: z
      .string()
      .max(1000)
      .default(
        "User-supplied recorded service dependencies; completeness and runtime impact are not independently verified.",
      ),
  }),
  services: z.array(entity).min(1).max(2000),
  dependencies: z
    .array(
      z.object({
        from: identifier,
        to: identifier,
        weight: z.number().positive().max(1000000).default(1),
      }),
    )
    .max(10000)
    .default([]),
  teams: z.array(entity).max(500).default([]),
  ownership: z
    .array(z.object({ team: identifier, service: identifier }))
    .max(5000)
    .default([]),
  customers: z
    .array(entity.extend({ uses: z.array(identifier).max(200) }))
    .max(1000)
    .default([]),
});
export type DatasetInput = z.infer<typeof datasetSchema>;
export type CatalogEntity = {
  id: string;
  externalId: string;
  name: string;
  kind: string;
  detail: string;
  source: string;
};
export type PathResult = {
  id: string;
  name: string;
  kind: string;
  path: string[];
  pathIds: string[];
  hops: number;
  source: string;
};

export function parseCompose(text: string, sourceUrl = ""): DatasetInput {
  if (Buffer.byteLength(text) > 2_000_000)
    throw new AccessError("Compose file exceeds 2 MB.", 400);
  const document = parseYaml(text, { maxAliasCount: 50 }) as {
    services?: Record<
      string,
      { depends_on?: string[] | Record<string, unknown>; image?: string }
    >;
  };
  if (!document?.services || typeof document.services !== "object")
    throw new AccessError(
      "No services mapping was found in the Compose file.",
      400,
    );
  const services = Object.entries(document.services).map(([id, service]) => ({
    id,
    name: id,
    description:
      typeof service?.image === "string"
        ? `Compose image: ${service.image}`
        : "Service declared in Compose.",
  }));
  const dependencies = Object.entries(document.services).flatMap(
    ([from, service]) => {
      const targets = Array.isArray(service?.depends_on)
        ? service.depends_on
        : Object.keys(service?.depends_on || {});
      return targets.map((to) => ({ from, to, weight: 1 }));
    },
  );
  return datasetSchema.parse({
    name: "Imported Compose topology",
    source: {
      title: "Docker Compose source",
      url: sourceUrl,
      semantics:
        "DEPENDS_ON means a Compose startup dependency. It is not proof of runtime traffic, failure propagation, or a complete application call graph.",
    },
    services,
    dependencies,
  });
}

export async function importDataset(input: unknown, userId: string) {
  const data = datasetSchema.parse(input);
  const serviceIds = new Set(data.services.map((service) => service.id));
  if (
    serviceIds.size !== data.services.length ||
    new Set(data.teams.map((team) => team.id)).size !== data.teams.length ||
    new Set(data.customers.map((customer) => customer.id)).size !==
      data.customers.length
  )
    throw new AccessError(
      "Entity identifiers must be unique within each kind.",
      400,
    );
  const teamIds = new Set(data.teams.map((team) => team.id));
  if (
    data.dependencies.some(
      (edge) => !serviceIds.has(edge.from) || !serviceIds.has(edge.to),
    ) ||
    data.ownership.some(
      (edge) => !serviceIds.has(edge.service) || !teamIds.has(edge.team),
    ) ||
    data.customers.some((customer) =>
      customer.uses.some((id) => !serviceIds.has(id)),
    )
  )
    throw new AccessError(
      "Every relationship endpoint must be declared in the import.",
      400,
    );
  const id = randomUUID(),
    at = new Date().toISOString();
  const key = (kind: string, externalId: string) =>
    `${id}:${kind}:${externalId}`;
  await query(
    "CREATE (d:Dataset {id:$id,name:$name,state:'importing',sourceTitle:$title,sourceUrl:$url,license:$license,semantics:$semantics,createdAt:$at,createdBy:$user})",
    {
      id,
      name: data.name,
      title: data.source.title,
      url: data.source.url,
      license: data.source.license,
      semantics: data.source.semantics,
      at,
      user: userId,
    },
  );
  try {
    for (const [kind, records] of [
      ["Service", data.services],
      ["Team", data.teams],
      ["Customer", data.customers],
    ] as const) {
      if (!records.length) continue;
      const rows = records.map((record) => ({
        id: key(kind, record.id),
        externalId: record.id,
        name: record.name,
        detail: record.description,
      }));
      await query(
        `MATCH (d:Dataset {id:$dataset}) UNWIND $rows AS row CREATE (n:${kind} {id:row.id,externalId:row.externalId,name:row.name,detail:row.detail,source:$source,kind:$kind}) CREATE (d)-[:CONTAINS]->(n)`,
        {
          dataset: id,
          rows,
          source: data.source.url || data.source.title,
          kind,
        },
      );
    }
    if (data.dependencies.length)
      await query(
        `UNWIND $rows AS row MATCH (a:Service {id:row.from}), (b:Service {id:row.to}) MERGE (a)-[r:DEPENDS_ON]->(b) SET r.weight=row.weight,r.datasetId=$dataset,r.source=$source`,
        {
          rows: data.dependencies.map((edge) => ({
            from: key("Service", edge.from),
            to: key("Service", edge.to),
            weight: edge.weight,
          })),
          dataset: id,
          source: data.source.url || data.source.title,
        },
      );
    if (data.ownership.length)
      await query(
        "UNWIND $rows AS row MATCH (t:Team {id:row.team}),(s:Service {id:row.service}) MERGE (t)-[:OWNS]->(s)",
        {
          rows: data.ownership.map((edge) => ({
            team: key("Team", edge.team),
            service: key("Service", edge.service),
          })),
        },
      );
    const uses = data.customers.flatMap((customer) =>
      customer.uses.map((service) => ({
        customer: key("Customer", customer.id),
        service: key("Service", service),
      })),
    );
    if (uses.length)
      await query(
        "UNWIND $rows AS row MATCH (c:Customer {id:row.customer}), (s:Service {id:row.service}) MERGE (c)-[r:USES]->(s) SET r.weight=1",
        { rows: uses },
      );
    if (data.dependencies.length)
      await query(
        `UNWIND $rows AS row MATCH (a:Service {id:row.subject}), (b:Service {id:row.object}), (d:Dataset {id:$id})
      CREATE (f:SemanticFact {id:row.id,subjectId:a.externalId,predicate:'DEPENDS_ON',objectId:b.externalId,datasetId:$id,validFrom:$at,status:'accepted',source:$source})
      CREATE (f)-[:SUBJECT]->(a) CREATE (f)-[:OBJECT]->(b) CREATE (f)-[:EVIDENCED_BY]->(d)`,
        {
          rows: data.dependencies.map((edge) => ({
            id: randomUUID(),
            subject: key("Service", edge.from),
            object: key("Service", edge.to),
          })),
          id,
          at,
          source: data.source.url || data.source.title,
        },
      );
    // Publish a complete dataset atomically. Readers never select partially imported rows.
    await query(
      `MATCH (m:WorkspaceMeta {id:'workspace'}), (d:Dataset {id:$id})
      SET d.state='ready',d.publishedAt=$published,m.activeDataset=$id,m.revision=m.revision+1
      CREATE (e:Episode {id:$episode,kind:'dataset_import',topic:'topology',text:$text,sourceId:$id,createdAt:$published,authorId:$user,visibility:'workspace',verified:false}) CREATE (e)-[:EVIDENCED_BY]->(d)`,
      {
        id,
        episode: randomUUID(),
        text: `Imported ${data.services.length} services and ${data.dependencies.length} declared dependencies from ${data.source.title}. ${data.source.semantics}`,
        published: new Date().toISOString(),
        user: userId,
      },
    );
    return {
      id,
      services: data.services.length,
      dependencies: data.dependencies.length,
      source: data.source,
    };
  } catch (error) {
    await query("MATCH (d:Dataset {id:$id}) SET d.state='failed'", {
      id,
    }).catch(() => {});
    throw error;
  }
}

export async function activeDataset() {
  const rows = await readQuery<{
    id: string;
    name: string;
    semantics: string;
    source: string;
    createdAt: string;
  }>(
    "MATCH (m:WorkspaceMeta {id:'workspace'}), (d:Dataset {id:m.activeDataset}) WHERE d.state='ready' RETURN d.id AS id,d.name AS name,d.semantics AS semantics,d.sourceUrl AS source,d.createdAt AS createdAt",
  );
  return rows[0] || null;
}

export async function datasetAt(at: string) {
  return (
    (
      await readQuery<{ id: string }>(
        "MATCH (d:Dataset {state:'ready'}) WHERE coalesce(d.publishedAt,d.createdAt)<=$at RETURN d.id AS id ORDER BY coalesce(d.publishedAt,d.createdAt) DESC LIMIT 1",
        { at },
      )
    )[0] || null
  );
}

export async function catalog() {
  const dataset = await activeDataset();
  if (!dataset) return { dataset: null, nodes: [], edges: [] };
  const nodes = await readQuery<CatalogEntity>(
    "MATCH (:Dataset {id:$id})-[:CONTAINS]->(n) RETURN n.id AS id,n.externalId AS externalId,n.name AS name,n.kind AS kind,n.detail AS detail,n.source AS source ORDER BY n.name LIMIT 3500",
    { id: dataset.id },
  );
  const edges = await readQuery<{
    source: string;
    target: string;
    relation: string;
  }>(
    "MATCH (:Dataset {id:$id})-[:CONTAINS]->(a)-[r:DEPENDS_ON|OWNS|USES]->(b) RETURN a.id AS source,b.id AS target,type(r) AS relation LIMIT 15000",
    { id: dataset.id },
  );
  return { dataset, nodes, edges };
}

export async function resolveEntity(
  id: string,
  servicesOnly = false,
): Promise<CatalogEntity> {
  const dataset = await activeDataset();
  if (!dataset) throw new AccessError("Import a dataset first.", 409);
  const rows = await readQuery<CatalogEntity>(
    `MATCH (:Dataset {id:$dataset})-[:CONTAINS]->(n${servicesOnly ? ":Service" : ""}) WHERE n.id=$id OR n.externalId=$id RETURN n.id AS id,n.externalId AS externalId,n.name AS name,n.kind AS kind,n.detail AS detail,n.source AS source`,
    { dataset: dataset.id, id },
  );
  if (rows.length !== 1)
    throw new AccessError(
      "Unknown or ambiguous entity in the active dataset.",
      404,
    );
  return rows[0];
}

export async function traceImpact(serviceId: string, depth: number) {
  if (!Number.isInteger(depth) || depth < 1 || depth > 6)
    throw new AccessError("Depth must be an integer from 1 to 6.", 400);
  const root = await resolveEntity(serviceId, true);
  const rows = await readQuery<PathResult>(
    `MATCH path=(n)-[:DEPENDS_ON|USES*1..${depth}]->(:Service {id:$id})
    RETURN n.id AS id,n.name AS name,n.kind AS kind,n.source AS source,length(path) AS hops,[v IN nodes(path)|v.name] AS path,[v IN nodes(path)|v.id] AS pathIds ORDER BY hops,n.name LIMIT 101`,
    { id: root.id },
  );
  return {
    tool: "trace_blast_radius",
    root,
    depth,
    paths: rows.slice(0, 100),
    truncated: rows.length > 100,
    semantics: (await activeDataset())!.semantics,
    outcome: rows.length ? "paths_found" : "no_recorded_connection",
  };
}

export async function shortestDependencyPath(
  from: string,
  to: string,
  maxDepth = 6,
) {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 6)
    throw new AccessError("Path depth must be 1–6.", 400);
  const source = await resolveEntity(from),
    target = await resolveEntity(to);
  const paths = await readQuery<{
    path: string[];
    pathIds: string[];
    weight: number;
  }>(
    `MATCH (a {id:$from}), (b {id:$to})
    CALL algo.SPpaths({sourceNode:a,targetNode:b,relTypes:['DEPENDS_ON','USES'],weightProp:'weight',relDirection:'outgoing',maxLen:$depth,pathCount:1})
    YIELD path,pathWeight RETURN [n IN nodes(path)|n.name] AS path,[n IN nodes(path)|n.id] AS pathIds,pathWeight AS weight`,
    { from: source.id, to: target.id, depth: maxDepth },
  );
  return {
    tool: "shortest_dependency_path",
    algorithm: "algo.SPpaths",
    source,
    target,
    paths,
    outcome: paths.length ? "path_found" : "no_recorded_connection",
    semantics: (await activeDataset())!.semantics,
  };
}

export async function serviceRank(limit = 10) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new AccessError("Ranking limit must be 1–20.", 400);
  const dataset = await activeDataset();
  if (!dataset) throw new AccessError("Import a dataset first.", 409);
  // Run on the active dataset's nodes; previous versions are disconnected components.
  const rows = await readQuery<{ id: string; name: string; score: number }>(
    `CALL algo.pageRank('Service','DEPENDS_ON') YIELD node,score
    MATCH (:Dataset {id:$dataset})-[:CONTAINS]->(node) RETURN node.id AS id,node.name AS name,score ORDER BY score DESC LIMIT $limit`,
    { dataset: dataset.id, limit },
  );
  return {
    tool: "rank_services",
    algorithm: "algo.pageRank",
    rows,
    interpretation:
      "Topology-based PageRank, not failure probability, production severity, or proof of causation. Previous dataset versions are separate components and may affect score normalization.",
  };
}
