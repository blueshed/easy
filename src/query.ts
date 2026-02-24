import type { Database } from "bun:sqlite";
import { SCHEMAS } from "./schemas";
import {
  getEntityDetail,
  getDocumentDetail,
  getChecklistDetail,
} from "./etl";

// --- Types ---

type E = { id: number; name: string };
type F = { name: string; type: string };
type R = { from_name: string; to_name: string; label: string; cardinality: string };
type M = { id: number; name: string; args: string; return_type: string; auth_required: number };
type MPerm = { path: string };
type P = { property: string };
type N = { channel: string; recipients: string; payload: string };
type Perm = { path: string; description: string };
type S = { id: number; actor: string; action: string; description: string };
type SL = { target_type: string; target_id: number };
type D = { id: number; name: string; entity_name: string; entity_id: number; collection: number; public: number; fetch: string; description: string };
type Exp = { id: number; name: string; entity_name: string; foreign_key: string; belongs_to: number; shallow: number; parent_expansion_id: number | null };
type CL = { id: number; name: string; description: string };
type CK = { id: number; actor: string; action: string; description: string; confirmed: number; seq: number; entity_name: string | null; method_name: string | null };
type Dep = { depends_on_id: number };

// --- List ---

export function list(db: Database, schema?: string): void {
  if (!schema) {
    listAll(db);
    return;
  }
  switch (schema) {
    case "entity": listEntities(db); break;
    case "story": listStories(db); break;
    case "document": listDocuments(db); break;
    case "checklist": listChecks(db); break;
    case "relation": listRelations(db); break;
    case "method": listMethods(db); break;
    case "metadata": listMetadata(db); break;
    default: {
      if (!SCHEMAS[schema]) {
        console.error(`Unknown schema '${schema}'. Known: ${Object.keys(SCHEMAS).filter(k => !k.startsWith("_")).join(", ")}`);
        throw new Error("fail");
      }
      // Generic fallback
      listGeneric(db, schema);
    }
  }
}

function listAll(db: Database) {
  listEntities(db);
}

function listEntities(db: Database) {
  const entities = db.query("SELECT * FROM entities ORDER BY name").all() as E[];
  if (entities.length === 0) { console.log("No entities."); return; }
  for (const e of entities) {
    const fields = db.query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id").all(e.id) as F[];
    const methods = db.query("SELECT id, name, args, return_type, auth_required FROM methods WHERE entity_id = ? ORDER BY id").all(e.id) as M[];
    console.log(e.name);
    for (const f of fields) console.log(`  ${f.name}: ${f.type}`);
    if (methods.length > 0) {
      console.log("  --");
      for (const m of methods) {
        const perms = db.query("SELECT path FROM method_permissions WHERE method_id = ?").all(m.id) as MPerm[];
        const perm = perms.length > 0 ? ` [${perms.map(p => p.path).join(" | ")}]` : m.auth_required ? " [auth]" : "";
        console.log(`  ${m.name}(${m.args}) -> ${m.return_type}${perm}`);
      }
    }
  }
  const rels = db.query(`
    SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
    FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
    ORDER BY e1.name
  `).all() as R[];
  if (rels.length > 0) {
    console.log("\nRelations:");
    for (const r of rels) console.log(`  ${r.from_name} -> ${r.to_name} ${r.label ? `[${r.label}]` : ""} ${r.cardinality}`);
  }
}

function listStories(db: Database) {
  const stories = db.query("SELECT * FROM stories ORDER BY id").all() as S[];
  if (stories.length === 0) { console.log("No stories."); return; }
  for (const s of stories) {
    console.log(`#${s.id} As a ${s.actor}, I can ${s.action}${s.description ? ` (${s.description})` : ""}`);
    const links = db.query("SELECT target_type, target_id FROM story_links WHERE story_id = ? ORDER BY target_type").all(s.id) as SL[];
    for (const l of links) {
      let name = `id:${l.target_id}`;
      if (l.target_type === "entity") {
        const r = db.query("SELECT name FROM entities WHERE id = ?").get(l.target_id) as { name: string } | null;
        if (r) name = r.name;
      } else if (l.target_type === "document") {
        const r = db.query("SELECT name FROM documents WHERE id = ?").get(l.target_id) as { name: string } | null;
        if (r) name = r.name;
      } else if (l.target_type === "method") {
        const r = db.query("SELECT e.name as entity, m.name as method FROM methods m JOIN entities e ON m.entity_id = e.id WHERE m.id = ?").get(l.target_id) as { entity: string; method: string } | null;
        if (r) name = `${r.entity}.${r.method}`;
      } else if (l.target_type === "notification") {
        const r = db.query("SELECT channel FROM notifications WHERE id = ?").get(l.target_id) as { channel: string } | null;
        if (r) name = r.channel;
      }
      console.log(`  -> ${l.target_type}: ${name}`);
    }
  }
}

function listDocuments(db: Database) {
  const docs = db.query(`
    SELECT d.id, d.name, e.name as entity_name, d.collection, d.public, d.fetch, d.description
    FROM documents d JOIN entities e ON d.entity_id = e.id ORDER BY d.name
  `).all() as Omit<D, "entity_id">[];
  if (docs.length === 0) { console.log("No documents."); return; }
  for (const d of docs) {
    const flags = [d.collection ? "collection" : "", d.public ? "public" : "", d.fetch !== "select" ? d.fetch : ""].filter(Boolean).join(", ");
    console.log(`${d.name} -> ${d.entity_name}${flags ? ` (${flags})` : ""}${d.description ? ` — ${d.description}` : ""}`);
    const exps = db.query(`
      SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
      FROM expansions x JOIN entities e ON x.entity_id = e.id
      WHERE x.document_id = ? ORDER BY x.id
    `).all(d.id) as Exp[];
    function printExp(parentId: number | null, indent: string) {
      for (const x of exps.filter(e => e.parent_expansion_id === parentId)) {
        const tags = [x.belongs_to ? "belongs-to" : "", x.shallow ? "shallow" : ""].filter(Boolean).join(", ");
        console.log(`${indent}${x.name} -> ${x.entity_name} via ${x.foreign_key}${tags ? ` (${tags})` : ""}`);
        if (!x.shallow) printExp(x.id, indent + "  ");
      }
    }
    printExp(null, "  ");
  }
}

function listChecks(db: Database, checklistFilter?: string) {
  const checklists = checklistFilter
    ? db.query("SELECT * FROM checklists WHERE name = ?").all(checklistFilter) as CL[]
    : db.query("SELECT * FROM checklists ORDER BY name").all() as CL[];
  if (checklists.length === 0) {
    console.log(checklistFilter ? `Checklist '${checklistFilter}' not found.` : "No checklists.");
    return;
  }
  for (const cl of checklists) {
    const checks = db.query(`
      SELECT c.id, c.actor, c.action, c.description, c.confirmed, c.seq,
             e.name as entity_name, m.name as method_name
      FROM checks c
      LEFT JOIN methods m ON c.method_id = m.id
      LEFT JOIN entities e ON m.entity_id = e.id
      WHERE c.checklist_id = ?
      ORDER BY c.seq, c.id
    `).all(cl.id) as CK[];
    const apiDone = checks.filter(c => c.confirmed & 1).length;
    const uxDone = checks.filter(c => c.confirmed & 2).length;
    console.log(`\n${cl.name}${cl.description ? ` — ${cl.description}` : ""} [api:${apiDone}/${checks.length} ux:${uxDone}/${checks.length}]`);
    for (const c of checks) {
      const api = c.confirmed & 1 ? "A" : ".";
      const ux = c.confirmed & 2 ? "U" : ".";
      const method = c.entity_name && c.method_name ? `${c.entity_name}.${c.method_name}` : "???";
      const denied = c.action === "denied" ? " DENIED" : "";
      const deps = db.query("SELECT depends_on_id FROM check_deps WHERE check_id = ?").all(c.id) as Dep[];
      const depStr = deps.length > 0 ? ` (after ${deps.map(d => `#${d.depends_on_id}`).join(", ")})` : "";
      console.log(`  #${c.id} [${api}${ux}] ${c.actor.padEnd(15)} ${method.padEnd(30)}${denied}${c.description ? ` — ${c.description}` : ""}${depStr}`);
    }
  }
}

function listRelations(db: Database) {
  const rels = db.query(`
    SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
    FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
    ORDER BY e1.name
  `).all() as R[];
  if (rels.length === 0) { console.log("No relations."); return; }
  for (const r of rels) console.log(`${r.from_name} -> ${r.to_name} ${r.label ? `[${r.label}]` : ""} ${r.cardinality}`);
}

function listMethods(db: Database) {
  const methods = db.query(`
    SELECT m.id, e.name as entity_name, m.name, m.args, m.return_type, m.auth_required
    FROM methods m JOIN entities e ON m.entity_id = e.id ORDER BY e.name, m.name
  `).all() as (M & { entity_name: string })[];
  if (methods.length === 0) { console.log("No methods."); return; }
  for (const m of methods) {
    const perms = db.query("SELECT path FROM method_permissions WHERE method_id = ?").all(m.id) as MPerm[];
    const perm = perms.length > 0 ? ` [${perms.map(p => p.path).join(" | ")}]` : m.auth_required ? " [auth]" : "";
    console.log(`${m.entity_name}.${m.name}(${m.args}) -> ${m.return_type}${perm}`);
  }
}

function listMetadata(db: Database) {
  const rows = db.query("SELECT key, value FROM metadata ORDER BY key").all() as { key: string; value: string }[];
  if (rows.length === 0) { console.log("(no metadata)"); return; }
  for (const r of rows) console.log(`${r.key}: ${r.value}`);
}

function listGeneric(db: Database, schema: string) {
  const def = SCHEMAS[schema];
  const rows = db.query(`SELECT * FROM ${def.table} ORDER BY id`).all() as Record<string, unknown>[];
  if (rows.length === 0) { console.log(`No ${schema} records.`); return; }
  for (const row of rows) console.log(JSON.stringify(row));
}

// --- Get ---

export function get(db: Database, schema: string, key: string): void {
  switch (schema) {
    case "entity": {
      const detail = getEntityDetail(key);
      if (!detail) { console.error(`Entity '${key}' not found.`); throw new Error("fail"); }
      console.log(JSON.stringify(detail, null, 2));
      break;
    }
    case "document": {
      const detail = getDocumentDetail(key);
      if (!detail) { console.error(`Document '${key}' not found.`); throw new Error("fail"); }
      console.log(JSON.stringify(detail, null, 2));
      break;
    }
    case "checklist": {
      const detail = getChecklistDetail(key);
      if (!detail) { console.error(`Checklist '${key}' not found.`); throw new Error("fail"); }
      console.log(JSON.stringify(detail, null, 2));
      break;
    }
    case "metadata": {
      const row = db.query("SELECT value FROM metadata WHERE key = ?").get(key) as { value: string } | null;
      if (!row) { console.error(`Metadata key '${key}' not found.`); throw new Error("fail"); }
      console.log(row.value);
      break;
    }
    case "story": {
      const row = db.query("SELECT * FROM stories WHERE actor = ? OR id = ?").get(key, Number(key) || 0) as S | null;
      if (!row) { console.error(`Story '${key}' not found.`); throw new Error("fail"); }
      const links = db.query("SELECT target_type, target_id FROM story_links WHERE story_id = ?").all(row.id) as SL[];
      console.log(JSON.stringify({ ...row, links }, null, 2));
      break;
    }
    default: {
      if (!SCHEMAS[schema]) {
        console.error(`Unknown schema '${schema}'.`);
        throw new Error("fail");
      }
      // Generic: lookup by first natural key field
      const def = SCHEMAS[schema];
      const nk = def.naturalKey[0];
      const col = def.columns[nk] || nk;
      const row = db.query(`SELECT * FROM ${def.table} WHERE ${col} = ?`).get(key);
      if (!row) { console.error(`${schema} '${key}' not found.`); throw new Error("fail"); }
      console.log(JSON.stringify(row, null, 2));
    }
  }
}

// --- Export spec ---

export function exportSpec(db: Database): void {
  const out: string[] = [];
  out.push("# Application Spec\n");

  // Metadata
  const metaRows = db.query("SELECT key, value FROM metadata ORDER BY key").all() as { key: string; value: string }[];
  if (metaRows.length > 0) {
    out.push("## Metadata\n");
    for (const m of metaRows) out.push(`- **${m.key}**: ${m.value}`);
    out.push("");
  }

  // Stories
  const stories = db.query("SELECT * FROM stories ORDER BY id").all() as S[];
  if (stories.length > 0) {
    out.push("## Stories\n");
    for (const s of stories) {
      out.push(`- ${s.id}# As a **${s.actor}**, I can **${s.action}**${s.description ? ` — ${s.description}` : ""}`);
    }
    out.push("");
  }

  // Entities
  const entities = db.query("SELECT * FROM entities ORDER BY name").all() as E[];
  if (entities.length > 0) {
    out.push("## Entities\n");
    for (const e of entities) {
      out.push(`### ${e.name}\n`);
      const fields = db.query("SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id").all(e.id) as F[];
      if (fields.length > 0) {
        out.push("| Field | Type |");
        out.push("|---|---|");
        for (const f of fields) out.push(`| ${f.name} | ${f.type} |`);
        out.push("");
      }

      // Change targets
      const changeLines: string[] = [];
      const rootDocs = db.query("SELECT name, collection FROM documents WHERE entity_id = ? ORDER BY name").all(e.id) as { name: string; collection: number }[];
      for (const rd of rootDocs) {
        const flag = rd.collection ? " (collection)" : "";
        changeLines.push(`- \`${rd.name}(id)\`${flag}`);
      }

      const entityExps = db.query(`
        SELECT x.id, x.name, x.foreign_key, x.parent_expansion_id, x.document_id, d.name as doc_name
        FROM expansions x JOIN documents d ON x.document_id = d.id
        WHERE x.entity_id = ? AND x.belongs_to = 0 ORDER BY x.id
      `).all(e.id) as { id: number; name: string; foreign_key: string; parent_expansion_id: number | null; document_id: number; doc_name: string }[];
      if (entityExps.length > 0) {
        const allExps = db.query("SELECT id, name, foreign_key, parent_expansion_id, document_id FROM expansions").all() as { id: number; name: string; foreign_key: string; parent_expansion_id: number | null; document_id: number }[];
        const expMap = new Map(allExps.map(x => [x.id, x]));
        for (const ex of entityExps) {
          const chain: { name: string; foreign_key: string }[] = [{ name: ex.name, foreign_key: ex.foreign_key }];
          let cur = ex.parent_expansion_id;
          while (cur !== null) {
            const parent = expMap.get(cur);
            if (!parent) break;
            chain.push({ name: parent.name, foreign_key: parent.foreign_key });
            cur = parent.parent_expansion_id;
          }
          chain.reverse();
          const docId = chain[0].foreign_key;
          const path = chain.map(c => c.name).join(".");
          const parentIds = chain.slice(1).map(c => c.foreign_key);
          let line = `- \`${ex.doc_name}(${docId})\` → \`${path}\``;
          if (parentIds.length > 0) line += ` [${parentIds.join(", ")}]`;
          changeLines.push(line);
        }
      }

      if (changeLines.length > 0) {
        out.push("**Changes:**\n");
        for (const l of changeLines) out.push(l);
        out.push("");
      }

      const methods = db.query("SELECT * FROM methods WHERE entity_id = ? ORDER BY id").all(e.id) as M[];
      if (methods.length > 0) {
        out.push("**Methods:**\n");
        for (const m of methods) {
          let argStr: string;
          try {
            const arr = JSON.parse(m.args) as { name: string; type: string }[];
            argStr = arr.map(a => `${a.name}: ${a.type}`).join(", ");
          } catch { argStr = m.args; }
          const authTag = m.auth_required ? " (auth required)" : "";
          out.push(`- \`${m.name}(${argStr})\` → \`${m.return_type}\`${authTag}`);
          const pubs = db.query("SELECT property FROM publishes WHERE method_id = ?").all(m.id) as P[];
          for (const p of pubs) out.push(`  - publishes \`${p.property}\``);
          const notifs = db.query("SELECT channel, recipients, payload FROM notifications WHERE method_id = ?").all(m.id) as N[];
          for (const n of notifs) out.push(`  - notifies \`${n.channel}\` → ${n.recipients}`);
          const perms = db.query("SELECT path, description FROM method_permissions WHERE method_id = ?").all(m.id) as Perm[];
          for (const p of perms) out.push(`  - permission: \`${p.path}\`${p.description ? ` — ${p.description}` : ""}`);
        }
        out.push("");
      }
    }

    // Relations
    const rels = db.query(`
      SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
      FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
      ORDER BY e1.name
    `).all() as R[];
    if (rels.length > 0) {
      out.push("## Relations\n");
      for (const r of rels) {
        const card = r.cardinality === "1" ? "belongs-to" : "has-many";
        out.push(`- **${r.from_name}** → **${r.to_name}**${r.label ? ` (${r.label})` : ""} [${card}]`);
      }
      out.push("");
    }
  }

  // Documents
  const docs = db.query(`
    SELECT d.id, d.name, e.name as entity_name, e.id as entity_id, d.collection, d.public, d.fetch, d.description
    FROM documents d JOIN entities e ON d.entity_id = e.id ORDER BY d.name
  `).all() as D[];
  if (docs.length > 0) {
    out.push("## Documents\n");
    for (const d of docs) {
      const flags = [d.collection ? "collection" : "", d.public ? "public" : "", d.fetch !== "select" ? d.fetch : ""].filter(Boolean).join(", ");
      out.push(`### ${d.name}\n`);
      if (d.description) out.push(`${d.description}\n`);
      out.push(`- **Entity:** ${d.entity_name}${flags ? ` (${flags})` : ""}`);

      const exps = db.query(`
        SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
        FROM expansions x JOIN entities e ON x.entity_id = e.id
        WHERE x.document_id = ? ORDER BY x.id
      `).all(d.id) as Exp[];

      if (exps.length > 0) {
        out.push("- **Expansions:**");
        function printExp(parentId: number | null, indent: string) {
          for (const x of exps.filter(e => e.parent_expansion_id === parentId)) {
            const rel = x.belongs_to ? "belongs-to" : x.shallow ? "shallow" : "has-many";
            out.push(`${indent}- \`${x.name}\` → ${x.entity_name} via \`${x.foreign_key}\` (${rel})`);
            if (!x.shallow) printExp(x.id, indent + "  ");
          }
        }
        printExp(null, "  ");
      }

      const linked = db.query(`
        SELECT s.actor, s.action FROM stories s
        JOIN story_links sl ON sl.story_id = s.id
        WHERE sl.target_type = 'document' AND sl.target_id = ?
        ORDER BY s.id
      `).all(d.id) as { actor: string; action: string }[];
      if (linked.length > 0) {
        out.push("- **Stories:**");
        for (const s of linked) out.push(`  - As a ${s.actor}, I can ${s.action}`);
      }
      out.push("");
    }
  }

  // Checklists
  const cls = db.query("SELECT * FROM checklists ORDER BY name").all() as CL[];
  if (cls.length > 0) {
    out.push("## Checklists\n");
    for (const cl of cls) {
      const cks = db.query(`
        SELECT c.id, c.actor, c.action, c.description, c.confirmed, c.seq,
               e.name as entity_name, m.name as method_name
        FROM checks c
        LEFT JOIN methods m ON c.method_id = m.id
        LEFT JOIN entities e ON m.entity_id = e.id
        WHERE c.checklist_id = ?
        ORDER BY c.seq, c.id
      `).all(cl.id) as CK[];
      const apiDone = cks.filter(c => c.confirmed & 1).length;
      const uxDone = cks.filter(c => c.confirmed & 2).length;
      out.push(`### ${cl.name} [api:${apiDone}/${cks.length} ux:${uxDone}/${cks.length}]\n`);
      if (cl.description) out.push(`${cl.description}\n`);
      for (const c of cks) {
        const api = c.confirmed & 1 ? "A" : ".";
        const ux = c.confirmed & 2 ? "U" : ".";
        const method = c.entity_name && c.method_name ? `${c.entity_name}.${c.method_name}` : "???";
        const denied = c.action === "denied" ? " **DENIED**" : "";
        const deps = db.query("SELECT depends_on_id FROM check_deps WHERE check_id = ?").all(c.id) as Dep[];
        const depStr = deps.length > 0 ? ` (after #${deps.map(d => d.depends_on_id).join(", #")})` : "";
        out.push(`- [${api}${ux}] #${c.id} **${c.actor}** \`${method}\`${denied}${c.description ? ` — ${c.description}` : ""}${depStr}`);
      }
      out.push("");
    }
  }

  console.log(out.join("\n"));
}

// --- Doctor ---

export function doctor(db: Database, fix: boolean): void {
  let total = 0;

  const badMethodLinks = db.query("SELECT id FROM story_links WHERE target_type = 'method' AND target_id NOT IN (SELECT id FROM methods)").all() as { id: number }[];
  const badEntityLinks = db.query("SELECT id FROM story_links WHERE target_type = 'entity' AND target_id NOT IN (SELECT id FROM entities)").all() as { id: number }[];
  const badDocLinks = db.query("SELECT id FROM story_links WHERE target_type = 'document' AND target_id NOT IN (SELECT id FROM documents)").all() as { id: number }[];
  const badNotifLinks = db.query("SELECT id FROM story_links WHERE target_type = 'notification' AND target_id NOT IN (SELECT id FROM notifications)").all() as { id: number }[];
  const orphanedLinks = [...badMethodLinks, ...badEntityLinks, ...badDocLinks, ...badNotifLinks];
  if (orphanedLinks.length > 0) {
    console.log(`  ${orphanedLinks.length} orphaned story_links (method:${badMethodLinks.length} entity:${badEntityLinks.length} document:${badDocLinks.length} notification:${badNotifLinks.length})`);
    total += orphanedLinks.length;
  }

  const badChecks = db.query("SELECT id FROM checks WHERE method_id IS NOT NULL AND method_id NOT IN (SELECT id FROM methods)").all() as { id: number }[];
  if (badChecks.length > 0) {
    console.log(`  ${badChecks.length} orphaned checks (method deleted)`);
    total += badChecks.length;
  }

  const badDeps = db.query("SELECT id FROM check_deps WHERE check_id NOT IN (SELECT id FROM checks) OR depends_on_id NOT IN (SELECT id FROM checks)").all() as { id: number }[];
  if (badDeps.length > 0) {
    console.log(`  ${badDeps.length} orphaned check_deps`);
    total += badDeps.length;
  }

  if (total === 0) {
    console.log("No orphaned references found.");
  } else if (fix) {
    for (const l of orphanedLinks) db.run("DELETE FROM story_links WHERE id = ?", [l.id]);
    for (const c of badChecks) db.run("DELETE FROM checks WHERE id = ?", [c.id]);
    for (const d of badDeps) db.run("DELETE FROM check_deps WHERE id = ?", [d.id]);
    console.log(`Removed ${total} orphaned rows.`);
  } else {
    console.log(`\n${total} orphaned rows total. Run with --fix to remove them.`);
  }
}
