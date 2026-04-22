import { Database } from "bun:sqlite";
import { getDbPath, openDb } from "./db";

const PLANTUML_URL = process.env.PLANTUML_URL ?? "http://localhost:8081";

// --- Types ---

interface Entity { id: number; name: string }
interface Field { name: string; type: string }
interface Relation { from_name: string; to_name: string; label: string; cardinality: string }
interface Method { id: number; name: string; args: string; return_type: string; auth_required: number }
interface Story { id: number; actor: string; action: string; description: string }
interface Doc {
  id: number; name: string; entity_name: string;
  collection: number; public: number; fetch: string; description: string;
}
interface Expansion {
  id: number; name: string; entity_name: string; foreign_key: string;
  belongs_to: number; shallow: number; parent_expansion_id: number | null;
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

// --- Diagram Generators ---

function generateEntityDiagram(db: Database): string {
  const entities = db.query("SELECT * FROM entities ORDER BY name").all() as Entity[];
  if (entities.length === 0) return "";

  const lines: string[] = ["@startuml", "hide empty methods", ""];

  for (const e of entities) {
    const fields = db.query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id").all(e.id) as Field[];
    const methods = db.query("SELECT id, name, args, return_type, auth_required FROM methods WHERE entity_id = ? ORDER BY id").all(e.id) as Method[];

    lines.push(`entity "${e.name}" as ${alias(e.name)} [[#/entities/${e.name}]] {`);
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

  const rels = db.query(`
    SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
    FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
    ORDER BY e1.name
  `).all() as Relation[];

  for (const r of rels) {
    const card = r.cardinality === "1" ? "||--||" : "||--o{";
    const labelPart = r.label ? ` : ${r.label}` : "";
    lines.push(`${r.from_name} ${card} ${r.to_name}${labelPart}`);
  }

  lines.push("", "@enduml");
  return lines.join("\n");
}

function generateUseCaseDiagram(db: Database): string {
  const stories = db.query("SELECT * FROM stories ORDER BY id").all() as Story[];
  if (stories.length === 0) return "";

  const lines: string[] = ["@startuml", "left to right direction", ""];

  const actors = [...new Set(stories.map((s) => s.actor))];
  for (const a of actors) lines.push(`actor "${a}" as ${alias(a)}`);
  lines.push("");

  const storyDocs = new Map<string, Story[]>();
  const unlinked: Story[] = [];

  for (const s of stories) {
    const links = db.query(`
      SELECT d.name FROM story_links sl
      JOIN documents d ON sl.target_id = d.id
      WHERE sl.story_id = ? AND sl.target_type = 'document'
    `).all(s.id) as { name: string }[];

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
    for (const s of docStories) lines.push(`  usecase "${s.action}" as UC${s.id}`);
    lines.push("}");
    lines.push("");
  }

  for (const s of unlinked) lines.push(`usecase "${s.action}" as UC${s.id}`);
  if (unlinked.length > 0) lines.push("");

  for (const s of stories) lines.push(`${alias(s.actor)} --> UC${s.id}`);

  lines.push("", "@enduml");
  return lines.join("\n");
}

function generateDocumentDiagram(db: Database): string {
  const docs = db.query(`
    SELECT d.id, d.name, e.name as entity_name, d.collection, d.public, d.fetch, d.description
    FROM documents d JOIN entities e ON d.entity_id = e.id ORDER BY d.name
  `).all() as Doc[];
  if (docs.length === 0) return "";

  const lines: string[] = ["@startuml", ""];
  let objCounter = 0;

  for (const d of docs) {
    const docAlias = `doc_${d.id}`;
    const flags = [d.collection ? "collection" : "", d.public ? "public" : "", d.fetch !== "select" ? d.fetch : ""]
      .filter(Boolean).join(", ");
    lines.push(`object "${d.name}" as ${docAlias} <<document>> {`);
    lines.push(`  entity = ${d.entity_name}`);
    if (flags) lines.push(`  ${flags}`);
    lines.push("}");
    lines.push("");

    const rootAlias = `root_${d.id}`;
    lines.push(`object "${d.entity_name}" as ${rootAlias} [[#/entities/${d.entity_name}]]`);
    lines.push(`${docAlias} --> ${rootAlias} : root`);
    lines.push("");

    const exps = db.query(`
      SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
      FROM expansions x JOIN entities e ON x.entity_id = e.id
      WHERE x.document_id = ? ORDER BY x.id
    `).all(d.id) as Expansion[];

    const expAliases = new Map<number, string>();

    function renderExp(parentAlias: string, parentId: number | null) {
      for (const x of exps.filter((e) => e.parent_expansion_id === parentId)) {
        objCounter++;
        const a = `exp_${objCounter}`;
        expAliases.set(x.id, a);
        const suffix = x.belongs_to ? "" : x.shallow ? " *" : "[]";
        lines.push(`object "${x.entity_name}${suffix}" as ${a} [[#/entities/${x.entity_name}]]`);
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

function generateSingleDocumentDiagram(db: Database, docName: string): string {
  const d = db.query(`
    SELECT d.id, d.name, e.name as entity_name, d.collection, d.public, d.fetch, d.description
    FROM documents d JOIN entities e ON d.entity_id = e.id WHERE d.name = ?
  `).get(docName) as Doc | null;
  if (!d) return "";

  const lines: string[] = ["@startuml", ""];
  let objCounter = 0;

  const docAlias = `doc_${d.id}`;
  const flags = [d.collection ? "collection" : "", d.public ? "public" : "", d.fetch !== "select" ? d.fetch : ""]
    .filter(Boolean).join(", ");
  lines.push(`object "${d.name}" as ${docAlias} <<document>> {`);
  lines.push(`  entity = ${d.entity_name}`);
  if (flags) lines.push(`  ${flags}`);
  lines.push("}");
  lines.push("");

  const rootAlias = `root_${d.id}`;
  lines.push(`object "${d.entity_name}" as ${rootAlias} [[#/entities/${d.entity_name}]]`);
  lines.push(`${docAlias} --> ${rootAlias} : root`);
  lines.push("");

  const exps = db.query(`
    SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
    FROM expansions x JOIN entities e ON x.entity_id = e.id
    WHERE x.document_id = ? ORDER BY x.id
  `).all(d.id) as Expansion[];

  function renderExp(parentAlias: string, parentId: number | null) {
    for (const x of exps.filter((e) => e.parent_expansion_id === parentId)) {
      objCounter++;
      const a = `exp_${objCounter}`;
      const suffix = x.belongs_to ? "" : x.shallow ? " *" : "[]";
      lines.push(`object "${x.entity_name}${suffix}" as ${a} [[#/entities/${x.entity_name}]]`);
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

function generateSingleEntityDiagram(db: Database, entityName: string): string {
  const entity = db.query("SELECT * FROM entities WHERE name = ?").get(entityName) as Entity | null;
  if (!entity) return "";

  const fields = db.query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id").all(entity.id) as Field[];
  const methods = db.query("SELECT id, name, args, return_type, auth_required FROM methods WHERE entity_id = ? ORDER BY id").all(entity.id) as Method[];

  const lines: string[] = ["@startuml", "hide empty methods", ""];

  lines.push(`entity "${entity.name}" as ${alias(entity.name)} [[#/entities/${entity.name}]] {`);
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

  const rels = db.query(`
    SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
    FROM relations r
    JOIN entities e1 ON r.from_entity_id = e1.id
    JOIN entities e2 ON r.to_entity_id = e2.id
    WHERE e1.id = ? OR e2.id = ?
  `).all(entity.id, entity.id) as Relation[];

  const relatedNames = new Set<string>();
  for (const r of rels) {
    if (r.from_name !== entity.name) relatedNames.add(r.from_name);
    if (r.to_name !== entity.name) relatedNames.add(r.to_name);
  }

  for (const name of relatedNames) {
    lines.push(`entity "${name}" as ${alias(name)} [[#/entities/${name}]]`);
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
  const file = Bun.file(getDbPath());
  if (!(await file.exists()))
    return { entities: EMPTY_SVG, usecases: EMPTY_SVG, documents: EMPTY_SVG };

  const db = openDb(true);
  let entityPuml: string, usecasePuml: string, documentPuml: string;
  try {
    entityPuml = generateEntityDiagram(db);
    usecasePuml = generateUseCaseDiagram(db);
    documentPuml = generateDocumentDiagram(db);
  } finally {
    db.close();
  }

  const results: Record<string, string> = {};
  results.entities = entityPuml ? await renderSvg(entityPuml).catch(() => EMPTY_SVG) : EMPTY_SVG;
  results.usecases = usecasePuml ? await renderSvg(usecasePuml).catch(() => EMPTY_SVG) : EMPTY_SVG;
  results.documents = documentPuml ? await renderSvg(documentPuml).catch(() => EMPTY_SVG) : EMPTY_SVG;
  return results;
}

export async function documentDiagram(name: string): Promise<string> {
  const file = Bun.file(getDbPath());
  if (!(await file.exists())) return EMPTY_SVG;
  const db = openDb(true);
  let puml: string;
  try { puml = generateSingleDocumentDiagram(db, name); }
  finally { db.close(); }
  return puml ? await renderSvg(puml).catch(() => EMPTY_SVG) : EMPTY_SVG;
}

export async function entityDiagram(name: string): Promise<string> {
  const file = Bun.file(getDbPath());
  if (!(await file.exists())) return EMPTY_SVG;
  const db = openDb(true);
  let puml: string;
  try { puml = generateSingleEntityDiagram(db, name); }
  finally { db.close(); }
  return puml ? await renderSvg(puml).catch(() => EMPTY_SVG) : EMPTY_SVG;
}
