import { Database } from "bun:sqlite";
import { getDbPath, openDb } from "./db";
export { etl, documentDiagram, entityDiagram } from "./plantuml";

/** Run a readonly query, returning fallback if db doesn't exist. */
function withDb<T>(fallback: T, fn: (db: Database) => T): T {
  let db: Database;
  try { db = openDb(true); } catch { return fallback; }
  try { return fn(db); } catch { return fallback; } finally { db.close(); }
}

// --- Types ---

interface Entity { id: number; name: string }
interface Field { name: string; type: string }
interface Method {
  id: number; name: string; args: string; return_type: string; auth_required: number;
}
interface Publish { property: string }
interface Notification { channel: string; recipients: string }
interface Story {
  id: number; actor: string; action: string; description: string;
}
interface StoryLink { target_type: string; target_id: number }

// --- Helpers ---

function parseArgs(json: string): string {
  try {
    const arr = JSON.parse(json) as { name: string; type: string }[];
    return arr.map((a) => `${a.name}: ${a.type}`).join(", ");
  } catch {
    return json;
  }
}

// --- Entity metadata ---

export function getEntityList(): { name: string }[] {
  return withDb([], (db) =>
    db.query("SELECT name FROM entities ORDER BY name").all() as { name: string }[]
  );
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
  return withDb(null, (db) => {
  const entity = db
    .query("SELECT * FROM entities WHERE name = ?")
    .get(name) as Entity | null;
  if (!entity) {
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

  return {
    name: entity.name,
    fields,
    methods: methodDetails,
    relations,
    documents,
    changes,
  };
  });
}

// --- Document metadata ---

export function getDocumentList(): {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
  fetch: string;
  description: string;
}[] {
  return withDb([], (db) => {
  const docs = db
    .query(
      `SELECT d.name, e.name as entity, d.collection, d.public, d.fetch, d.description FROM documents d
       JOIN entities e ON d.entity_id = e.id ORDER BY d.name`,
    )
    .all() as {
    name: string;
    entity: string;
    collection: number;
    public: number;
    fetch: string;
    description: string;
  }[];
  return docs.map((d) => ({
    name: d.name,
    entity: d.entity,
    collection: !!d.collection,
    public: !!d.public,
    fetch: d.fetch,
    description: d.description,
  }));
  });
}

export function getDocumentDetail(name: string): {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
  fetch: string;
  description: string;
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
  expansions: { name: string; entity: string; type: string; children: any[] }[];
} | null {
  return withDb(null, (db) => {
  const doc = db
    .query(
      `SELECT d.id, d.name, e.name as entity, e.id as entity_id, d.collection, d.public, d.fetch, d.description
       FROM documents d JOIN entities e ON d.entity_id = e.id WHERE d.name = ?`,
    )
    .get(name) as {
    id: number;
    name: string;
    entity: string;
    entity_id: number;
    collection: number;
    public: number;
    fetch: string;
    description: string;
  } | null;
  if (!doc) {
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

  // Build expansion tree for diagram
  const allDocExps = db.query(`
    SELECT x.id, x.name, e.name as entity_name, x.belongs_to, x.shallow, x.parent_expansion_id
    FROM expansions x JOIN entities e ON x.entity_id = e.id
    WHERE x.document_id = ? ORDER BY x.id
  `).all(doc.id) as { id: number; name: string; entity_name: string; belongs_to: number; shallow: number; parent_expansion_id: number | null }[];

  function buildExpTree(parentId: number | null): { name: string; entity: string; type: string; children: any[] }[] {
    return allDocExps
      .filter(x => x.parent_expansion_id === parentId)
      .map(x => ({
        name: x.name,
        entity: x.entity_name,
        type: x.belongs_to ? "belongs-to" : x.shallow ? "shallow" : "has-many",
        children: buildExpTree(x.id),
      }));
  }

  return {
    name: doc.name,
    entity: doc.entity,
    collection: !!doc.collection,
    public: !!doc.public,
    fetch: doc.fetch,
    description: doc.description,
    methods: methodDetails,
    changedBy,
    stories,
    expansions: buildExpTree(null),
  };
  });
}

// --- Stories data for HTML rendering ---

export function getStories(): {
  id: number;
  actor: string;
  action: string;
  description: string;
  links: { type: string; name: string }[];
}[] {
  return withDb([], (db) => {
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
  return result;
  });
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
  return withDb([], (db) => {
    const checklists = db
      .query("SELECT * FROM checklists ORDER BY id")
      .all() as { id: number; name: string; description: string }[];
    return checklists.map((cl) => {
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
  });
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
  return withDb(null, (db) => {
    const cl = db
      .query("SELECT * FROM checklists WHERE name = ?")
      .get(name) as { id: number; name: string; description: string } | null;
    if (!cl) {
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

    return { name: cl.name, description: cl.description, checks: result };
  });
}

// --- Agentic data ---

export function getTaskGraph(): {
  tasks: { id: number; name: string; description: string; status: string }[];
  deps: { task_id: number; depends_on: number }[];
  flags: { name: string; status: string }[];
} {
  return withDb({ tasks: [], deps: [], flags: [] }, (db) => {
    const tasks = db.query("SELECT id, name, description, status FROM tasks ORDER BY created_at").all() as { id: number; name: string; description: string; status: string }[];
    const deps = db.query("SELECT task_id, depends_on_id as depends_on FROM task_deps").all() as { task_id: number; depends_on: number }[];
    const flags = db.query("SELECT name, status FROM flags ORDER BY name").all() as { name: string; status: string }[];
    return { tasks, deps, flags };
  });
}

export function getMemories(): { id: number; tag: string; content: string; created_at: string; updated_at: string }[] {
  return withDb([], (db) => {
    return db.query("SELECT * FROM memories ORDER BY tag, created_at").all() as { id: number; tag: string; content: string; created_at: string; updated_at: string }[];
  });
}

export function getFlags(): { name: string; cmd: string; status: string; checked_at: string | null }[] {
  return withDb([], (db) => {
    return db.query("SELECT * FROM flags ORDER BY name").all() as { name: string; cmd: string; status: string; checked_at: string | null }[];
  });
}

export function getMetadata(): Record<string, string> {
  return withDb({}, (db) => {
    const rows = db.query("SELECT key, value FROM metadata").all() as {
      key: string;
      value: string;
    }[];
    const result: Record<string, string> = {};
    for (const r of rows) result[r.key] = r.value;
    return result;
  });
}

/**
 * Returns domain entities as a schema-view-compatible structure.
 * Each entity becomes a "table" with its fields as columns and
 * relations as foreign keys.
 */
export function getDomainSchema(): {
  table: string;
  columns: { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number }[];
  foreignKeys: { id: number; seq: number; table: string; from: string; to: string }[];
}[] {
  return withDb([], (db) => {
    const entities = db.query("SELECT id, name FROM entities ORDER BY name").all() as Entity[];

    return entities.map((entity) => {
      const fields = db.query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id").all(entity.id) as Field[];
      const relations = db.query(`
        SELECT r.label, r.cardinality, e2.name as to_name
        FROM relations r
        JOIN entities e2 ON e2.id = r.to_entity_id
        WHERE r.from_entity_id = ?
      `).all(entity.id) as { label: string; cardinality: string; to_name: string }[];

      const columns = fields.map((f, i) => ({
        cid: i,
        name: f.name,
        type: f.type,
        notnull: f.name === "id" ? 1 : 0,
        dflt_value: null,
        pk: f.name === "id" ? 1 : 0,
      }));

      // Only belongs-to (cardinality "1") relations produce an FK on this entity
      const belongsTo = relations.filter(r => r.cardinality === "1");
      const fieldNames = new Set(fields.map(f => f.name));
      const foreignKeys = belongsTo.map((r, i) => {
        // Find the actual FK column: try label_id, then to_name_id
        const candidates = [
          r.label + "_id",
          r.to_name.toLowerCase() + "_id",
          r.label,
        ];
        const from = candidates.find(c => fieldNames.has(c)) ?? r.label + "_id";
        return { id: i, seq: 0, table: r.to_name, from, to: "id" };
      });

      return { table: entity.name, columns, foreignKeys };
    });
  });
}

