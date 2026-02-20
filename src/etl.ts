import { Database } from "bun:sqlite";
import { DB_PATH, openDb } from "./db";

const PLANTUML_URL = process.env.PLANTUML_URL ?? "http://localhost:8081";

// --- Types ---

interface Entity {
  id: number;
  name: string;
}
interface Field {
  name: string;
  type: string;
}
interface Relation {
  from_name: string;
  to_name: string;
  label: string;
  cardinality: string;
}
interface Method {
  id: number;
  name: string;
  args: string;
  return_type: string;
  auth_required: number;
}
interface Publish {
  property: string;
}
interface Notification {
  channel: string;
  recipients: string;
}
interface Story {
  id: number;
  actor: string;
  action: string;
  description: string;
}
interface StoryLink {
  target_type: string;
  target_id: number;
}
interface Doc {
  id: number;
  name: string;
  entity_name: string;
  collection: number;
  public: number;
}
interface Expansion {
  id: number;
  name: string;
  entity_name: string;
  foreign_key: string;
  belongs_to: number;
  shallow: number;
  parent_expansion_id: number | null;
}

// --- Diagram Generators ---

function generateEntityDiagram(db: Database): string {
  const entities = db
    .query("SELECT * FROM entities ORDER BY name")
    .all() as Entity[];
  if (entities.length === 0) return "";

  const lines: string[] = ["@startuml", "hide empty methods", ""];

  for (const e of entities) {
    const fields = db
      .query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id")
      .all(e.id) as Field[];
    const methods = db
      .query(
        "SELECT id, name, args, return_type, auth_required FROM methods WHERE entity_id = ? ORDER BY id",
      )
      .all(e.id) as Method[];

    lines.push(
      `entity "${e.name}" as ${alias(e.name)} [[#entity-${e.name}]] {`,
    );
    for (const f of fields) lines.push(`  ${f.name} : ${f.type}`);
    if (methods.length > 0) {
      lines.push("  --");
      for (const m of methods) {
        const argList = parseArgs(m.args);
        lines.push(`  ${m.name}(${argList}) : ${m.return_type}`);
      }
    }
    lines.push("}");
    lines.push("");
  }

  const rels = db
    .query(
      `
    SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
    FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
    ORDER BY e1.name
  `,
    )
    .all() as Relation[];

  for (const r of rels) {
    const card = r.cardinality === "1" ? "||--||" : "||--o{";
    const labelPart = r.label ? ` : ${r.label}` : "";
    lines.push(`${r.from_name} ${card} ${r.to_name}${labelPart}`);
  }

  lines.push("", "@enduml");
  return lines.join("\n");
}

function generateUseCaseDiagram(db: Database): string {
  const stories = db
    .query("SELECT * FROM stories ORDER BY id")
    .all() as Story[];
  if (stories.length === 0) return "";

  const lines: string[] = ["@startuml", "left to right direction", ""];

  // Collect unique actors
  const actors = [...new Set(stories.map((s) => s.actor))];
  for (const a of actors) lines.push(`actor "${a}" as ${alias(a)}`);
  lines.push("");

  // Group stories by linked document
  const storyDocs = new Map<string, Story[]>();
  const unlinked: Story[] = [];

  for (const s of stories) {
    const links = db
      .query(
        `
      SELECT d.name FROM story_links sl
      JOIN documents d ON sl.target_id = d.id
      WHERE sl.story_id = ? AND sl.target_type = 'document'
    `,
      )
      .all(s.id) as { name: string }[];

    if (links.length > 0) {
      for (const l of links) {
        if (!storyDocs.has(l.name)) storyDocs.set(l.name, []);
        storyDocs.get(l.name)!.push(s);
      }
    } else {
      unlinked.push(s);
    }
  }

  for (const [docName, docStories] of storyDocs) {
    lines.push(`rectangle "${docName}" {`);
    for (const s of docStories) {
      lines.push(`  usecase "${s.action}" as UC${s.id}`);
    }
    lines.push("}");
    lines.push("");
  }

  for (const s of unlinked) {
    lines.push(`usecase "${s.action}" as UC${s.id}`);
  }
  if (unlinked.length > 0) lines.push("");

  for (const s of stories) {
    lines.push(`${alias(s.actor)} --> UC${s.id}`);
  }

  lines.push("", "@enduml");
  return lines.join("\n");
}

function generateDocumentDiagram(db: Database): string {
  const docs = db
    .query(
      `
    SELECT d.id, d.name, e.name as entity_name, d.collection, d.public
    FROM documents d JOIN entities e ON d.entity_id = e.id ORDER BY d.name
  `,
    )
    .all() as Doc[];
  if (docs.length === 0) return "";

  const lines: string[] = ["@startuml", ""];
  let objCounter = 0;

  for (const d of docs) {
    const docAlias = `doc_${d.id}`;
    const flags = [d.collection ? "collection" : "", d.public ? "public" : ""]
      .filter(Boolean)
      .join(", ");
    lines.push(`object "${d.name}" as ${docAlias} <<document>> {`);
    lines.push(`  entity = ${d.entity_name}`);
    if (flags) lines.push(`  ${flags}`);
    lines.push("}");
    lines.push("");

    // Root entity
    const rootAlias = `root_${d.id}`;
    lines.push(
      `object "${d.entity_name}" as ${rootAlias} [[#entity-${d.entity_name}]]`,
    );
    lines.push(`${docAlias} --> ${rootAlias} : root`);
    lines.push("");

    // Expansions
    const exps = db
      .query(
        `
      SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
      FROM expansions x JOIN entities e ON x.entity_id = e.id
      WHERE x.document_id = ? ORDER BY x.id
    `,
      )
      .all(d.id) as Expansion[];

    const expAliases = new Map<number, string>();

    function renderExp(parentAlias: string, parentId: number | null) {
      for (const x of exps.filter((e) => e.parent_expansion_id === parentId)) {
        objCounter++;
        const a = `exp_${objCounter}`;
        expAliases.set(x.id, a);
        const suffix = x.belongs_to ? "" : x.shallow ? " *" : "[]";
        lines.push(
          `object "${x.entity_name}${suffix}" as ${a} [[#entity-${x.entity_name}]]`,
        );
        const rel = x.belongs_to ? "belongs-to" : x.shallow ? "shallow" : "has-many";
        const arrow = x.shallow ? "..>" : "-->";
        lines.push(`${parentAlias} ${arrow} ${a} : ${x.name} (${rel})`);
        if (!x.shallow) renderExp(a, x.id);
      }
    }
    renderExp(rootAlias, null);
    lines.push("");
  }

  lines.push("@enduml");
  return lines.join("\n");
}

// --- Helpers ---

function parseArgs(json: string): string {
  try {
    const arr = JSON.parse(json) as { name: string; type: string }[];
    return arr.map((a) => `${a.name}: ${a.type}`).join(", ");
  } catch {
    return json;
  }
}

function alias(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_");
}

// --- SVG rendering ---

async function renderSvg(puml: string): Promise<string> {
  const res = await fetch(`${PLANTUML_URL}/svg`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: puml,
  });
  if (!res.ok)
    throw new Error(`PlantUML server error: ${res.status} ${await res.text()}`);
  return await res.text();
}

const EMPTY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="60">
  <text x="20" y="35" font-family="sans-serif" font-size="14" fill="#888">No data yet. Use the CLI to add stories and entities.</text>
</svg>`;

// --- Per-document diagram ---

function generateSingleDocumentDiagram(db: Database, docName: string): string {
  const d = db
    .query(
      `SELECT d.id, d.name, e.name as entity_name, d.collection, d.public
       FROM documents d JOIN entities e ON d.entity_id = e.id WHERE d.name = ?`,
    )
    .get(docName) as Doc | null;
  if (!d) return "";

  const lines: string[] = ["@startuml", ""];
  let objCounter = 0;

  const docAlias = `doc_${d.id}`;
  const flags = [d.collection ? "collection" : "", d.public ? "public" : ""]
    .filter(Boolean)
    .join(", ");
  lines.push(`object "${d.name}" as ${docAlias} <<document>> {`);
  lines.push(`  entity = ${d.entity_name}`);
  if (flags) lines.push(`  ${flags}`);
  lines.push("}");
  lines.push("");

  const rootAlias = `root_${d.id}`;
  lines.push(
    `object "${d.entity_name}" as ${rootAlias} [[#entity-${d.entity_name}]]`,
  );
  lines.push(`${docAlias} --> ${rootAlias} : root`);
  lines.push("");

  const exps = db
    .query(
      `SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
       FROM expansions x JOIN entities e ON x.entity_id = e.id
       WHERE x.document_id = ? ORDER BY x.id`,
    )
    .all(d.id) as Expansion[];

  function renderExp(parentAlias: string, parentId: number | null) {
    for (const x of exps.filter((e) => e.parent_expansion_id === parentId)) {
      objCounter++;
      const a = `exp_${objCounter}`;
      const suffix = x.belongs_to ? "" : x.shallow ? " *" : "[]";
      lines.push(
        `object "${x.entity_name}${suffix}" as ${a} [[#entity-${x.entity_name}]]`,
      );
      const rel = x.belongs_to ? "belongs-to" : x.shallow ? "shallow" : "has-many";
      const arrow = x.shallow ? "..>" : "-->";
      lines.push(`${parentAlias} ${arrow} ${a} : ${x.name} (${rel})`);
      if (!x.shallow) renderExp(a, x.id);
    }
  }
  renderExp(rootAlias, null);

  lines.push("", "@enduml");
  return lines.join("\n");
}

// --- Per-entity diagram ---

function generateSingleEntityDiagram(db: Database, entityName: string): string {
  const entity = db
    .query("SELECT * FROM entities WHERE name = ?")
    .get(entityName) as Entity | null;
  if (!entity) return "";

  const fields = db
    .query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id")
    .all(entity.id) as Field[];
  const methods = db
    .query(
      "SELECT id, name, args, return_type, auth_required FROM methods WHERE entity_id = ? ORDER BY id",
    )
    .all(entity.id) as Method[];

  const lines: string[] = ["@startuml", "hide empty methods", ""];

  // Central entity — full detail
  lines.push(
    `entity "${entity.name}" as ${alias(entity.name)} [[#entity-${entity.name}]] {`,
  );
  for (const f of fields) lines.push(`  ${f.name} : ${f.type}`);
  if (methods.length > 0) {
    lines.push("  --");
    for (const m of methods) {
      const argList = parseArgs(m.args);
      lines.push(`  ${m.name}(${argList}) : ${m.return_type}`);
    }
  }
  lines.push("}");
  lines.push("");

  // Related entities — name only
  const rels = db
    .query(
      `SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
       FROM relations r
       JOIN entities e1 ON r.from_entity_id = e1.id
       JOIN entities e2 ON r.to_entity_id = e2.id
       WHERE e1.id = ? OR e2.id = ?`,
    )
    .all(entity.id, entity.id) as Relation[];

  const relatedNames = new Set<string>();
  for (const r of rels) {
    if (r.from_name !== entity.name) relatedNames.add(r.from_name);
    if (r.to_name !== entity.name) relatedNames.add(r.to_name);
  }

  for (const name of relatedNames) {
    lines.push(`entity "${name}" as ${alias(name)} [[#entity-${name}]]`);
  }
  if (relatedNames.size > 0) lines.push("");

  for (const r of rels) {
    const card = r.cardinality === "1" ? "||--||" : "||--o{";
    const labelPart = r.label ? ` : ${r.label}` : "";
    lines.push(`${alias(r.from_name)} ${card} ${alias(r.to_name)}${labelPart}`);
  }

  lines.push("", "@enduml");
  return lines.join("\n");
}

// --- Public API ---

export async function etl(): Promise<Record<string, string>> {
  const file = Bun.file(DB_PATH);
  if (!(await file.exists()))
    return { entities: EMPTY_SVG, usecases: EMPTY_SVG, documents: EMPTY_SVG };

  const db = openDb(true);
  const entityPuml = generateEntityDiagram(db);
  const usecasePuml = generateUseCaseDiagram(db);
  const documentPuml = generateDocumentDiagram(db);
  db.close();

  const results: Record<string, string> = {};

  results.entities = entityPuml ? await renderSvg(entityPuml) : EMPTY_SVG;
  results.usecases = usecasePuml ? await renderSvg(usecasePuml) : EMPTY_SVG;
  results.documents = documentPuml ? await renderSvg(documentPuml) : EMPTY_SVG;

  return results;
}

export async function documentDiagram(name: string): Promise<string> {
  const file = Bun.file(DB_PATH);
  if (!(await file.exists())) return EMPTY_SVG;
  const db = openDb(true);
  const puml = generateSingleDocumentDiagram(db, name);
  db.close();
  return puml ? await renderSvg(puml) : EMPTY_SVG;
}

export async function entityDiagram(name: string): Promise<string> {
  const file = Bun.file(DB_PATH);
  if (!(await file.exists())) return EMPTY_SVG;
  const db = openDb(true);
  const puml = generateSingleEntityDiagram(db, name);
  db.close();
  return puml ? await renderSvg(puml) : EMPTY_SVG;
}

// --- Entity metadata ---

export function getEntityList(): { name: string }[] {
  const db = openDb(true);
  const entities = db
    .query("SELECT name FROM entities ORDER BY name")
    .all() as { name: string }[];
  db.close();
  return entities;
}

export function getEntityDetail(name: string): {
  name: string;
  fields: { name: string; type: string }[];
  methods: {
    name: string;
    args: string;
    return_type: string;
    publishes: string[];
    notifications: { channel: string; recipients: string }[];
    permissions: { path: string; description: string }[];
  }[];
  relations: {
    entity: string;
    label: string;
    cardinality: string;
    direction: string;
  }[];
  documents: { name: string; role: string }[];
  changes: { doc: string; path: string | null; collection: boolean; fks: string[] }[];
} | null {
  const db = openDb(true);
  const entity = db
    .query("SELECT * FROM entities WHERE name = ?")
    .get(name) as Entity | null;
  if (!entity) {
    db.close();
    return null;
  }

  const fields = db
    .query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id")
    .all(entity.id) as Field[];

  const methods = db
    .query("SELECT * FROM methods WHERE entity_id = ? ORDER BY id")
    .all(entity.id) as Method[];

  const methodDetails = methods.map((m) => {
    const pubs = db
      .query("SELECT property FROM publishes WHERE method_id = ?")
      .all(m.id) as Publish[];
    const notifs = db
      .query(
        "SELECT channel, recipients FROM notifications WHERE method_id = ?",
      )
      .all(m.id) as Notification[];
    const perms = db
      .query(
        "SELECT path, description FROM method_permissions WHERE method_id = ?",
      )
      .all(m.id) as { path: string; description: string }[];
    return {
      name: m.name,
      args: parseArgs(m.args),
      return_type: m.return_type,
      publishes: pubs.map((p) => p.property),
      notifications: notifs,
      permissions: perms,
    };
  });

  // Relations in both directions
  const relsFrom = db
    .query(
      `SELECT e2.name as entity, r.label, r.cardinality
     FROM relations r JOIN entities e2 ON r.to_entity_id = e2.id
     WHERE r.from_entity_id = ?`,
    )
    .all(entity.id) as { entity: string; label: string; cardinality: string }[];
  const relsTo = db
    .query(
      `SELECT e1.name as entity, r.label, r.cardinality
     FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id
     WHERE r.to_entity_id = ?`,
    )
    .all(entity.id) as { entity: string; label: string; cardinality: string }[];

  const relations = [
    ...relsFrom.map((r) => ({ ...r, direction: "to" })),
    ...relsTo.map((r) => ({ ...r, direction: "from" })),
  ];

  // Documents where this entity appears as root or expansion
  const docsAsRoot = db
    .query("SELECT name FROM documents WHERE entity_id = ?")
    .all(entity.id) as { name: string }[];
  const docsAsExpansion = db
    .query(
      `SELECT DISTINCT d.name FROM expansions x
     JOIN documents d ON x.document_id = d.id
     WHERE x.entity_id = ?`,
    )
    .all(entity.id) as { name: string }[];

  const documents = [
    ...docsAsRoot.map((d) => ({ name: d.name, role: "root" })),
    ...docsAsExpansion.map((d) => ({ name: d.name, role: "expansion" })),
  ];

  // Change targets
  const changes: { doc: string; path: string | null; collection: boolean; fks: string[] }[] = [];

  // Root: documents where this entity is the root
  const rootDocs = db
    .query("SELECT name, collection FROM documents WHERE entity_id = ?")
    .all(entity.id) as { name: string; collection: number }[];
  for (const rd of rootDocs) {
    changes.push({ doc: rd.name, path: null, collection: !!rd.collection, fks: ["id"] });
  }

  // Child: expansions where this entity appears (non-belongs_to)
  const entityExps = db
    .query(
      `SELECT x.id, x.name, x.foreign_key, x.parent_expansion_id, d.name as doc_name
       FROM expansions x JOIN documents d ON x.document_id = d.id
       WHERE x.entity_id = ? AND x.belongs_to = 0 ORDER BY x.id`,
    )
    .all(entity.id) as {
    id: number;
    name: string;
    foreign_key: string;
    parent_expansion_id: number | null;
    doc_name: string;
  }[];
  if (entityExps.length > 0) {
    const allExps = db
      .query("SELECT id, name, foreign_key, parent_expansion_id FROM expansions")
      .all() as { id: number; name: string; foreign_key: string; parent_expansion_id: number | null }[];
    const expMap = new Map(allExps.map((x) => [x.id, x]));
    for (const ex of entityExps) {
      const chain: { name: string; foreign_key: string }[] = [
        { name: ex.name, foreign_key: ex.foreign_key },
      ];
      let cur = ex.parent_expansion_id;
      while (cur !== null) {
        const parent = expMap.get(cur);
        if (!parent) break;
        chain.push({ name: parent.name, foreign_key: parent.foreign_key });
        cur = parent.parent_expansion_id;
      }
      chain.reverse();
      const docFk = chain[0].foreign_key;
      const path = chain.map((c) => c.name).join(".");
      const parentFks = chain.slice(1).map((c) => c.foreign_key);
      changes.push({ doc: ex.doc_name, path, collection: false, fks: [docFk, ...parentFks] });
    }
  }

  db.close();
  return {
    name: entity.name,
    fields,
    methods: methodDetails,
    relations,
    documents,
    changes,
  };
}

// --- Document metadata ---

export function getDocumentList(): {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
}[] {
  const file = Bun.file(DB_PATH);
  const db = openDb(true);
  const docs = db
    .query(
      `SELECT d.name, e.name as entity FROM documents d
       JOIN entities e ON d.entity_id = e.id ORDER BY d.name`,
    )
    .all() as {
    name: string;
    entity: string;
    collection: number;
    public: number;
  }[];
  db.close();
  return docs.map((d) => ({
    name: d.name,
    entity: d.entity,
    collection: !!d.collection,
    public: !!d.public,
  }));
}

export function getDocumentDetail(name: string): {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
  methods: {
    name: string;
    args: string;
    return_type: string;
    publishes: string[];
    notifications: { channel: string; recipients: string }[];
    permissions: { path: string; description: string }[];
  }[];
  changedBy: { entity: string; path: string | null; fks: string[] }[];
  stories: { actor: string; action: string }[];
} | null {
  const db = openDb(true);
  const doc = db
    .query(
      `SELECT d.id, d.name, e.name as entity, e.id as entity_id, d.collection, d.public
       FROM documents d JOIN entities e ON d.entity_id = e.id WHERE d.name = ?`,
    )
    .get(name) as {
    id: number;
    name: string;
    entity: string;
    entity_id: number;
    collection: number;
    public: number;
  } | null;
  if (!doc) {
    db.close();
    return null;
  }

  const methods = db
    .query("SELECT * FROM methods WHERE entity_id = ? ORDER BY id")
    .all(doc.entity_id) as Method[];

  const methodDetails = methods.map((m) => {
    const pubs = db
      .query("SELECT property FROM publishes WHERE method_id = ?")
      .all(m.id) as Publish[];
    const notifs = db
      .query(
        "SELECT channel, recipients FROM notifications WHERE method_id = ?",
      )
      .all(m.id) as Notification[];
    const perms = db
      .query(
        "SELECT path, description FROM method_permissions WHERE method_id = ?",
      )
      .all(m.id) as { path: string; description: string }[];
    return {
      name: m.name,
      args: parseArgs(m.args),
      return_type: m.return_type,
      publishes: pubs.map((p) => p.property),
      notifications: notifs,
      permissions: perms,
    };
  });

  const stories = db
    .query(
      `SELECT s.actor, s.action FROM stories s
       JOIN story_links sl ON sl.story_id = s.id
       WHERE sl.target_type = 'document' AND sl.target_id = ?
       ORDER BY s.id`,
    )
    .all(doc.id) as { actor: string; action: string }[];

  // Changed by: root entity + all non-belongs_to expansion entities
  const changedBy: { entity: string; path: string | null; fks: string[] }[] = [];

  // Root entity
  changedBy.push({ entity: doc.entity, path: null, fks: ["id"] });

  // Expansion entities
  const docExps = db
    .query(
      `SELECT x.id, x.name, x.foreign_key, x.parent_expansion_id, e.name as entity_name
       FROM expansions x JOIN entities e ON x.entity_id = e.id
       WHERE x.document_id = ? AND x.belongs_to = 0 ORDER BY x.id`,
    )
    .all(doc.id) as {
    id: number;
    name: string;
    foreign_key: string;
    parent_expansion_id: number | null;
    entity_name: string;
  }[];
  if (docExps.length > 0) {
    const allExps = db
      .query("SELECT id, name, foreign_key, parent_expansion_id FROM expansions WHERE document_id = ?")
      .all(doc.id) as { id: number; name: string; foreign_key: string; parent_expansion_id: number | null }[];
    const expMap = new Map(allExps.map((x) => [x.id, x]));
    for (const ex of docExps) {
      const chain: { name: string; foreign_key: string }[] = [
        { name: ex.name, foreign_key: ex.foreign_key },
      ];
      let cur = ex.parent_expansion_id;
      while (cur !== null) {
        const parent = expMap.get(cur);
        if (!parent) break;
        chain.push({ name: parent.name, foreign_key: parent.foreign_key });
        cur = parent.parent_expansion_id;
      }
      chain.reverse();
      const docFk = chain[0].foreign_key;
      const path = chain.map((c) => c.name).join(".");
      const parentFks = chain.slice(1).map((c) => c.foreign_key);
      changedBy.push({ entity: ex.entity_name, path, fks: [docFk, ...parentFks] });
    }
  }

  db.close();
  return {
    name: doc.name,
    entity: doc.entity,
    collection: !!doc.collection,
    public: !!doc.public,
    methods: methodDetails,
    changedBy,
    stories,
  };
}

// --- Stories data for HTML rendering ---

export function getStories(): {
  id: number;
  actor: string;
  action: string;
  description: string;
  links: { type: string; name: string }[];
}[] {
  const file = Bun.file(DB_PATH);
  // Sync check — for the HTML template
  const db = openDb(true);
  const stories = db
    .query("SELECT * FROM stories ORDER BY id")
    .all() as Story[];
  const result = stories.map((s) => {
    const links = db
      .query(
        "SELECT target_type, target_id FROM story_links WHERE story_id = ?",
      )
      .all(s.id) as StoryLink[];
    const resolved = links.map((l) => {
      let name = `id:${l.target_id}`;
      if (l.target_type === "entity") {
        const r = db
          .query("SELECT name FROM entities WHERE id = ?")
          .get(l.target_id) as { name: string } | null;
        if (r) name = r.name;
      } else if (l.target_type === "document") {
        const r = db
          .query("SELECT name FROM documents WHERE id = ?")
          .get(l.target_id) as { name: string } | null;
        if (r) name = r.name;
      } else if (l.target_type === "method") {
        const r = db
          .query(
            "SELECT e.name as entity, m.name as method FROM methods m JOIN entities e ON m.entity_id = e.id WHERE m.id = ?",
          )
          .get(l.target_id) as { entity: string; method: string } | null;
        if (r) name = `${r.entity}.${r.method}`;
      } else if (l.target_type === "notification") {
        const r = db
          .query("SELECT channel FROM notifications WHERE id = ?")
          .get(l.target_id) as { channel: string } | null;
        if (r) name = r.channel;
      }
      return { type: l.target_type, name };
    });
    return {
      id: s.id,
      actor: s.actor,
      action: s.action,
      description: s.description,
      links: resolved,
    };
  });
  db.close();
  return result;
}

// --- Checklist data ---

export function getChecklistList(): {
  name: string;
  description: string;
  total: number;
  api: number;
  ux: number;
  done: number;
}[] {
  const db = openDb(true);
  const checklists = db
    .query("SELECT * FROM checklists ORDER BY id")
    .all() as { id: number; name: string; description: string }[];
  const result = checklists.map((cl) => {
    const counts = db
      .query(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN confirmed & 1 THEN 1 ELSE 0 END) as api,
                SUM(CASE WHEN confirmed & 2 THEN 1 ELSE 0 END) as ux,
                SUM(CASE WHEN confirmed = 3 THEN 1 ELSE 0 END) as done
         FROM checks WHERE checklist_id = ?`,
      )
      .get(cl.id) as { total: number; api: number; ux: number; done: number };
    return {
      name: cl.name,
      description: cl.description,
      total: counts.total,
      api: counts.api ?? 0,
      ux: counts.ux ?? 0,
      done: counts.done ?? 0,
    };
  });
  db.close();
  return result;
}

export function getChecklistDetail(name: string): {
  name: string;
  description: string;
  checks: {
    id: number;
    seq: number;
    actor: string;
    action: string;
    method: string | null;
    description: string;
    confirmed: number;
    depends_on: number[];
  }[];
} | null {
  const db = openDb(true);
  const cl = db
    .query("SELECT * FROM checklists WHERE name = ?")
    .get(name) as { id: number; name: string; description: string } | null;
  if (!cl) {
    db.close();
    return null;
  }

  const checks = db
    .query("SELECT * FROM checks WHERE checklist_id = ? ORDER BY seq, id")
    .all(cl.id) as {
    id: number;
    seq: number;
    actor: string;
    method_id: number | null;
    action: string;
    description: string;
    confirmed: number;
  }[];

  const result = checks.map((c) => {
    let method: string | null = null;
    if (c.method_id) {
      const m = db
        .query(
          "SELECT e.name as entity, m.name as method FROM methods m JOIN entities e ON m.entity_id = e.id WHERE m.id = ?",
        )
        .get(c.method_id) as { entity: string; method: string } | null;
      if (m) method = `${m.entity}.${m.method}`;
    }
    const deps = db
      .query("SELECT depends_on_id FROM check_deps WHERE check_id = ?")
      .all(c.id) as { depends_on_id: number }[];
    return {
      id: c.id,
      seq: c.seq,
      actor: c.actor,
      action: c.action,
      method,
      description: c.description,
      confirmed: c.confirmed,
      depends_on: deps.map((d) => d.depends_on_id),
    };
  });

  db.close();
  return { name: cl.name, description: cl.description, checks: result };
}

if (import.meta.main) {
  const diagrams = await etl();
  for (const [name, svg] of Object.entries(diagrams)) {
    console.log(`--- ${name} ---`);
    console.log(svg.substring(0, 200) + "...");
  }
}
