import { openDb } from "./db";

const db = openDb();

// --- Helpers ---

function entityId(name: string): number {
  const row = db.query("SELECT id FROM entities WHERE name = ?").get(name) as {
    id: number;
  } | null;
  if (!row) {
    console.error(`Entity '${name}' not found.`);
    throw new Error(`Entity '${name}' not found.`);
  }
  return row.id;
}

function documentId(name: string): number {
  const row = db.query("SELECT id FROM documents WHERE name = ?").get(name) as {
    id: number;
  } | null;
  if (!row) {
    throw new Error(`Document '${name}' not found.`);
  }
  return row.id;
}

function methodId(entityDotMethod: string): number {
  const [entName, methName] = entityDotMethod.split(".");
  if (!entName || !methName) {
    console.error("Use Entity.method format.");
    throw new Error("fail");
  }
  const eid = entityId(entName);
  const row = db
    .query("SELECT id FROM methods WHERE entity_id = ? AND name = ?")
    .get(eid, methName) as { id: number } | null;
  if (!row) {
    console.error(`Method '${methName}' not found on '${entName}'.`);
    throw new Error("fail");
  }
  return row.id;
}

function resolveTarget(type: string, name: string): number {
  switch (type) {
    case "entity":
      return entityId(name);
    case "document":
      return documentId(name);
    case "method": {
      // Accept either "Entity.method" or just "method" (search all entities)
      if (name.includes(".")) return methodId(name);
      const row = db
        .query(
          "SELECT m.id FROM methods m JOIN entities e ON m.entity_id = e.id WHERE m.name = ?",
        )
        .get(name) as { id: number } | null;
      if (!row) {
        console.error(`Method '${name}' not found.`);
        throw new Error("fail");
      }
      return row.id;
    }
    case "notification": {
      const row = db
        .query("SELECT id FROM notifications WHERE channel = ?")
        .get(name) as { id: number } | null;
      if (!row) {
        console.error(`Notification '${name}' not found.`);
        throw new Error("fail");
      }
      return row.id;
    }
    default:
      console.error(
        `Unknown target type '${type}'. Use: entity, document, method, notification`,
      );
      throw new Error("fail");
  }
}

function parseFlags(args: string[]): {
  positional: string[];
  flags: Record<string, string | true>;
} {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else flags[key] = true;
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

// --- Command dispatch ---

function dispatch(cmd: string, rawArgs: string[]): void {
  const { positional: args, flags } = parseFlags(rawArgs);

  switch (cmd) {
    // === Entities (existing) ===

    case "add-entity": {
      const [name] = args;
      if (!name) {
        usage();
        throw new Error("fail");
      }
      db.run("INSERT OR IGNORE INTO entities (name) VALUES (?)", [name]);
      console.log(`Entity '${name}' added.`);
      break;
    }
    case "add-field": {
      const [entity, field, type = "string"] = args;
      if (!entity || !field) {
        usage();
        throw new Error("fail");
      }
      const eid = entityId(entity);
      db.run(
        "INSERT OR IGNORE INTO fields (entity_id, name, type) VALUES (?, ?, ?)",
        [eid, field, type],
      );
      console.log(`Field '${field}: ${type}' added to '${entity}'.`);
      break;
    }
    case "add-relation": {
      const [from, to, label = "", cardinality = "*"] = args;
      if (!from || !to) {
        usage();
        throw new Error("fail");
      }
      const fid = entityId(from);
      const tid = entityId(to);
      db.run(
        "INSERT OR IGNORE INTO relations (from_entity_id, to_entity_id, label, cardinality) VALUES (?, ?, ?, ?)",
        [fid, tid, label, cardinality],
      );
      console.log(`Relation '${from}' -> '${to}' added.`);
      break;
    }
    case "remove-entity": {
      const [name] = args;
      if (!name) {
        usage();
        throw new Error("fail");
      }
      db.run("DELETE FROM entities WHERE name = ?", [name]);
      console.log(`Entity '${name}' removed.`);
      break;
    }
    case "remove-field": {
      const [entity, field] = args;
      if (!entity || !field) {
        usage();
        throw new Error("fail");
      }
      const eid = entityId(entity);
      db.run("DELETE FROM fields WHERE entity_id = ? AND name = ?", [
        eid,
        field,
      ]);
      console.log(`Field '${field}' removed from '${entity}'.`);
      break;
    }
    case "remove-relation": {
      const [from, to, label = ""] = args;
      if (!from || !to) {
        usage();
        throw new Error("fail");
      }
      const fid = entityId(from);
      const tid = entityId(to);
      db.run(
        "DELETE FROM relations WHERE from_entity_id = ? AND to_entity_id = ? AND label = ?",
        [fid, tid, label],
      );
      console.log(`Relation removed.`);
      break;
    }

    // === Stories ===

    case "add-story": {
      const [actor, action, description = ""] = args;
      if (!actor || !action) {
        console.error(
          "Usage: bun model add-story <actor> <action> [description]",
        );
        throw new Error("fail");
      }
      const info = db.run(
        "INSERT INTO stories (actor, action, description) VALUES (?, ?, ?)",
        [actor, action, description],
      );
      console.log(
        `Story #${info.lastInsertRowid} added: As a ${actor}, I can ${action}`,
      );
      break;
    }
    case "remove-story": {
      const [id] = args;
      if (!id) {
        console.error("Usage: bun model remove-story <id>");
        throw new Error("fail");
      }
      db.run("DELETE FROM stories WHERE id = ?", [Number(id)]);
      console.log(`Story #${id} removed.`);
      break;
    }

    // === Documents ===

    case "add-document": {
      const [name, entity] = args;
      if (!name || !entity) {
        console.error(
          "Usage: bun model add-document <Name> <Entity> [--collection] [--public] [--cursor] [--stream] [--description <text>]",
        );
        throw new Error("fail");
      }
      const eid = entityId(entity);
      const collection = flags.collection ? 1 : 0;
      const pub = flags.public ? 1 : 0;
      const fetchMode = flags.stream ? "stream" : flags.cursor ? "cursor" : "select";
      const description = typeof flags.description === "string" ? flags.description : "";
      db.run(
        "INSERT OR IGNORE INTO documents (name, entity_id, collection, public, fetch, description) VALUES (?, ?, ?, ?, ?, ?)",
        [name, eid, collection, pub, fetchMode, description],
      );
      const tags = [collection ? "collection" : "", pub ? "public" : "", fetchMode !== "select" ? fetchMode : ""]
        .filter(Boolean)
        .join(", ");
      console.log(
        `Document '${name}' -> '${entity}'${tags ? ` (${tags})` : ""} added.`,
      );
      break;
    }
    case "remove-document": {
      const [name] = args;
      if (!name) {
        console.error("Usage: bun model remove-document <Name>");
        throw new Error("fail");
      }
      db.run("DELETE FROM documents WHERE name = ?", [name]);
      console.log(`Document '${name}' removed.`);
      break;
    }

    // === Expansions ===

    case "add-expansion": {
      const [docName, name, entity, foreignKey] = args;
      if (!docName || !name || !entity || !foreignKey) {
        console.error(
          "Usage: bun model add-expansion <Document> <name> <Entity> <foreign_key> [--belongs-to] [--shallow] [--parent <expansion_name>]",
        );
        throw new Error("fail");
      }
      const did = documentId(docName);
      const eid = entityId(entity);
      const belongsTo = flags["belongs-to"] ? 1 : 0;
      const shallow = flags.shallow ? 1 : 0;
      let parentExpId: number | null = null;
      if (flags.parent) {
        const parentName = flags.parent as string;
        const prow = db
          .query("SELECT id FROM expansions WHERE document_id = ? AND name = ?")
          .get(did, parentName) as { id: number } | null;
        if (!prow) {
          console.error(
            `Parent expansion '${parentName}' not found on document '${docName}'.`,
          );
          throw new Error("fail");
        }
        parentExpId = prow.id;
      }
      db.run(
        "INSERT INTO expansions (document_id, parent_expansion_id, name, entity_id, foreign_key, belongs_to, shallow) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [did, parentExpId, name, eid, foreignKey, belongsTo, shallow],
      );
      const where = parentExpId ? ` (nested under '${flags.parent}')` : "";
      const tags = [belongsTo ? "belongs-to" : "", shallow ? "shallow" : ""]
        .filter(Boolean)
        .join(", ");
      console.log(
        `Expansion '${name}' -> '${entity}' on '${docName}'${where}${tags ? ` (${tags})` : ""} added.`,
      );
      break;
    }
    case "remove-expansion": {
      const [docName, name] = args;
      if (!docName || !name) {
        console.error("Usage: bun model remove-expansion <Document> <name>");
        throw new Error("fail");
      }
      const did = documentId(docName);
      db.run("DELETE FROM expansions WHERE document_id = ? AND name = ?", [
        did,
        name,
      ]);
      console.log(`Expansion '${name}' removed from '${docName}'.`);
      break;
    }

    // === Methods ===

    case "add-method": {
      const [entity, name, argsJson = "[]", returnType = "boolean"] = args;
      if (!entity || !name) {
        console.error(
          "Usage: bun model add-method <Entity> <name> [args_json] [return_type] [--no-auth] [--permission <perm>]",
        );
        throw new Error("fail");
      }
      const eid = entityId(entity);
      const authRequired = flags["no-auth"] ? 0 : 1;
      db.run(
        "INSERT OR IGNORE INTO methods (entity_id, name, args, return_type, auth_required) VALUES (?, ?, ?, ?, ?)",
        [eid, name, argsJson, returnType, authRequired],
      );
      console.log(
        `Method '${entity}.${name}(${argsJson}) -> ${returnType}' added.`,
      );
      // Convenience: --permission adds a permission path in the same call
      if (flags["permission"] && typeof flags["permission"] === "string") {
        const mid = methodId(`${entity}.${name}`);
        db.run(
          "INSERT INTO method_permissions (method_id, path, description) VALUES (?, ?, '')",
          [mid, flags["permission"]],
        );
        console.log(`  Permission '${flags["permission"]}' added.`);
      }
      break;
    }
    case "remove-method": {
      const [entity, name] = args;
      if (!entity || !name) {
        console.error("Usage: bun model remove-method <Entity> <name>");
        throw new Error("fail");
      }
      const eid = entityId(entity);
      db.run("DELETE FROM methods WHERE entity_id = ? AND name = ?", [
        eid,
        name,
      ]);
      console.log(`Method '${entity}.${name}' removed.`);
      break;
    }

    // === Publish ===

    case "add-publish": {
      const [entityMethod, property] = args;
      if (!entityMethod || !property) {
        console.error(
          "Usage: bun model add-publish <Entity.method> <property>",
        );
        throw new Error("fail");
      }
      const mid = methodId(entityMethod);
      db.run("INSERT INTO publishes (method_id, property) VALUES (?, ?)", [
        mid,
        property,
      ]);
      console.log(`Publish '${property}' added to '${entityMethod}'.`);
      break;
    }

    case "remove-publish": {
      const [entityMethod, property] = args;
      if (!entityMethod || !property) {
        console.error(
          "Usage: bun model remove-publish <Entity.method> <property>",
        );
        throw new Error("fail");
      }
      const mid = methodId(entityMethod);
      db.run("DELETE FROM publishes WHERE method_id = ? AND property = ?", [
        mid,
        property,
      ]);
      console.log(`Publish '${property}' removed from '${entityMethod}'.`);
      break;
    }

    // === Notifications ===

    case "add-notification": {
      const [entityMethod, channel, recipients, payload = "{}"] = args;
      if (!entityMethod || !channel || !recipients) {
        console.error(
          "Usage: bun model add-notification <Entity.method> <channel> <recipients> [payload_json]",
        );
        throw new Error("fail");
      }
      const mid = methodId(entityMethod);
      db.run(
        "INSERT INTO notifications (method_id, channel, payload, recipients) VALUES (?, ?, ?, ?)",
        [mid, channel, payload, recipients],
      );
      console.log(
        `Notification '${channel}' -> '${recipients}' added to '${entityMethod}'.`,
      );
      break;
    }

    case "remove-notification": {
      const [entityMethod, channel] = args;
      if (!entityMethod || !channel) {
        console.error(
          "Usage: bun model remove-notification <Entity.method> <channel>",
        );
        throw new Error("fail");
      }
      const mid = methodId(entityMethod);
      db.run("DELETE FROM notifications WHERE method_id = ? AND channel = ?", [
        mid,
        channel,
      ]);
      console.log(`Notification '${channel}' removed from '${entityMethod}'.`);
      break;
    }

    // === Permission Paths ===

    case "add-permission": {
      const [entityMethod, path, description = ""] = args;
      if (!entityMethod || !path) {
        console.error(
          "Usage: bun model add-permission <Entity.method> <path> [description]",
        );
        throw new Error("fail");
      }
      const mid = methodId(entityMethod);
      const info = db.run(
        "INSERT INTO method_permissions (method_id, path, description) VALUES (?, ?, ?)",
        [mid, path, description],
      );
      console.log(
        `Permission path added to '${entityMethod}': ${path}${description ? ` — ${description}` : ""} (id: ${info.lastInsertRowid})`,
      );
      break;
    }
    case "remove-permission": {
      const [id] = args;
      if (!id) {
        console.error("Usage: bun model remove-permission <id>");
        throw new Error("fail");
      }
      db.run("DELETE FROM method_permissions WHERE id = ?", [Number(id)]);
      console.log(`Permission path #${id} removed.`);
      break;
    }

    // === Checklists ===

    case "add-checklist": {
      const [name, description = ""] = args;
      if (!name) {
        console.error("Usage: bun model add-checklist <name> [description]");
        throw new Error("fail");
      }
      const info = db.run(
        "INSERT OR IGNORE INTO checklists (name, description) VALUES (?, ?)",
        [name, description],
      );
      console.log(`Checklist '${name}' added (id: ${info.lastInsertRowid}).`);
      break;
    }
    case "remove-checklist": {
      const [name] = args;
      if (!name) {
        console.error("Usage: bun model remove-checklist <name>");
        throw new Error("fail");
      }
      db.run("DELETE FROM checklists WHERE name = ?", [name]);
      console.log(`Checklist '${name}' removed.`);
      break;
    }

    case "add-check": {
      const [checklistName, actor, entityMethod, description = ""] = args;
      if (!checklistName || !actor || !entityMethod) {
        console.error(
          "Usage: bun model add-check <checklist> <actor> <Entity.method> [description] [--denied] [--after <check_id>]",
        );
        throw new Error("fail");
      }
      const clRow = db
        .query("SELECT id FROM checklists WHERE name = ?")
        .get(checklistName) as { id: number } | null;
      if (!clRow) {
        console.error(`Checklist '${checklistName}' not found.`);
        throw new Error("fail");
      }
      const mid = methodId(entityMethod);
      const action = flags.denied ? "denied" : "can";
      // Auto-increment seq within checklist
      const maxSeq = db
        .query(
          "SELECT COALESCE(MAX(seq), 0) as m FROM checks WHERE checklist_id = ?",
        )
        .get(clRow.id) as { m: number };
      const info = db.run(
        "INSERT INTO checks (checklist_id, actor, method_id, action, description, seq) VALUES (?, ?, ?, ?, ?, ?)",
        [clRow.id, actor, mid, action, description, maxSeq.m + 1],
      );
      const checkId = info.lastInsertRowid;
      console.log(
        `Check #${checkId} added: ${actor} ${action} ${entityMethod}${description ? ` — ${description}` : ""}`,
      );
      // Handle --after dependency
      if (flags.after) {
        const afterIds = (flags.after as string).split(",").map(Number);
        for (const depId of afterIds) {
          const depExists = db
            .query("SELECT id FROM checks WHERE id = ?")
            .get(depId);
          if (!depExists) {
            console.error(
              `Warning: check #${depId} not found, skipping dependency.`,
            );
            continue;
          }
          db.run(
            "INSERT OR IGNORE INTO check_deps (check_id, depends_on_id) VALUES (?, ?)",
            [checkId, depId],
          );
          console.log(`  depends on #${depId}`);
        }
      }
      break;
    }
    case "remove-check": {
      const [id] = args;
      if (!id) {
        console.error("Usage: bun model remove-check <check_id>");
        throw new Error("fail");
      }
      db.run("DELETE FROM checks WHERE id = ?", [Number(id)]);
      console.log(`Check #${id} removed.`);
      break;
    }

    case "add-check-dep": {
      const [checkId, dependsOnId] = args;
      if (!checkId || !dependsOnId) {
        console.error(
          "Usage: bun model add-check-dep <check_id> <depends_on_id>",
        );
        throw new Error("fail");
      }
      db.run(
        "INSERT OR IGNORE INTO check_deps (check_id, depends_on_id) VALUES (?, ?)",
        [Number(checkId), Number(dependsOnId)],
      );
      console.log(`Check #${checkId} now depends on #${dependsOnId}.`);
      break;
    }
    case "remove-check-dep": {
      const [checkId, dependsOnId] = args;
      if (!checkId || !dependsOnId) {
        console.error(
          "Usage: bun model remove-check-dep <check_id> <depends_on_id>",
        );
        throw new Error("fail");
      }
      db.run(
        "DELETE FROM check_deps WHERE check_id = ? AND depends_on_id = ?",
        [Number(checkId), Number(dependsOnId)],
      );
      console.log(`Dependency removed.`);
      break;
    }

    case "confirm-check": {
      const [id] = args;
      if (!id || (!flags.api && !flags.ux)) {
        console.error("Usage: bun model confirm-check <check_id> --api|--ux");
        throw new Error("fail");
      }
      const mask = (flags.api ? 1 : 0) | (flags.ux ? 2 : 0);
      db.run("UPDATE checks SET confirmed = confirmed | ? WHERE id = ?", [
        mask,
        Number(id),
      ]);
      const which = [flags.api ? "api" : "", flags.ux ? "ux" : ""]
        .filter(Boolean)
        .join("+");
      console.log(`Check #${id} confirmed (${which}).`);
      break;
    }
    case "unconfirm-check": {
      const [id] = args;
      if (!id || (!flags.api && !flags.ux)) {
        console.error("Usage: bun model unconfirm-check <check_id> --api|--ux");
        throw new Error("fail");
      }
      const mask = (flags.api ? 1 : 0) | (flags.ux ? 2 : 0);
      db.run("UPDATE checks SET confirmed = confirmed & ? WHERE id = ?", [
        3 & ~mask,
        Number(id),
      ]);
      const which = [flags.api ? "api" : "", flags.ux ? "ux" : ""]
        .filter(Boolean)
        .join("+");
      console.log(`Check #${id} unconfirmed (${which}).`);
      break;
    }

    case "list-checks": {
      type CL = { id: number; name: string; description: string };
      type CK = {
        id: number;
        actor: string;
        action: string;
        description: string;
        confirmed: number;
        seq: number;
        entity_name: string | null;
        method_name: string | null;
      };
      type Dep = { depends_on_id: number };

      const checklistFilter = args[0];
      const checklists = checklistFilter
        ? (db
            .query("SELECT * FROM checklists WHERE name = ?")
            .all(checklistFilter) as CL[])
        : (db.query("SELECT * FROM checklists ORDER BY name").all() as CL[]);

      if (checklists.length === 0) {
        console.log(
          checklistFilter
            ? `Checklist '${checklistFilter}' not found.`
            : "No checklists.",
        );
        break;
      }

      for (const cl of checklists) {
        const checks = db
          .query(
            `SELECT c.id, c.actor, c.action, c.description, c.confirmed, c.seq,
                  e.name as entity_name, m.name as method_name
           FROM checks c
           LEFT JOIN methods m ON c.method_id = m.id
           LEFT JOIN entities e ON m.entity_id = e.id
           WHERE c.checklist_id = ?
           ORDER BY c.seq, c.id`,
          )
          .all(cl.id) as CK[];

        const apiDone = checks.filter((c) => c.confirmed & 1).length;
        const uxDone = checks.filter((c) => c.confirmed & 2).length;
        console.log(
          `\n${cl.name}${cl.description ? ` — ${cl.description}` : ""} [api:${apiDone}/${checks.length} ux:${uxDone}/${checks.length}]`,
        );

        for (const c of checks) {
          const api = c.confirmed & 1 ? "A" : ".";
          const ux = c.confirmed & 2 ? "U" : ".";
          const method =
            c.entity_name && c.method_name
              ? `${c.entity_name}.${c.method_name}`
              : "???";
          const denied = c.action === "denied" ? " DENIED" : "";
          const deps = db
            .query("SELECT depends_on_id FROM check_deps WHERE check_id = ?")
            .all(c.id) as Dep[];
          const depStr =
            deps.length > 0
              ? ` (after ${deps.map((d) => `#${d.depends_on_id}`).join(", ")})`
              : "";
          console.log(
            `  #${c.id} [${api}${ux}] ${c.actor.padEnd(15)} ${method.padEnd(30)}${denied}${c.description ? ` — ${c.description}` : ""}${depStr}`,
          );
        }
      }
      break;
    }

    // === Story Links ===

    case "link-story": {
      const [storyId, targetType, targetName] = args;
      if (!storyId || !targetType || !targetName) {
        console.error(
          "Usage: bun model link-story <story_id> <target_type> <target_name>",
        );
        throw new Error("fail");
      }
      const sid = Number(storyId);
      const exists = db.query("SELECT id FROM stories WHERE id = ?").get(sid);
      if (!exists) {
        console.error(`Story #${sid} not found.`);
        throw new Error("fail");
      }
      const tid = resolveTarget(targetType, targetName);
      db.run(
        "INSERT OR IGNORE INTO story_links (story_id, target_type, target_id) VALUES (?, ?, ?)",
        [sid, targetType, tid],
      );
      console.log(`Story #${sid} linked to ${targetType} '${targetName}'.`);
      break;
    }
    case "unlink-story": {
      const [storyId, targetType, targetName] = args;
      if (!storyId || !targetType || !targetName) {
        console.error(
          "Usage: bun model unlink-story <story_id> <target_type> <target_name>",
        );
        throw new Error("fail");
      }
      const sid = Number(storyId);
      const tid = resolveTarget(targetType, targetName);
      db.run(
        "DELETE FROM story_links WHERE story_id = ? AND target_type = ? AND target_id = ?",
        [sid, targetType, tid],
      );
      console.log(`Story #${sid} unlinked from ${targetType} '${targetName}'.`);
      break;
    }

    // === Metadata ===

    case "set-meta": {
      const key = args[0];
      const value = args.slice(1).join(" ").trim();
      if (!key || !value) {
        console.error("Usage: bun model set-meta <key> <value>");
        throw new Error("fail");
      }
      db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)",
        [key, value],
      );
      console.log(`${key}: ${value}`);
      break;
    }
    case "get-meta": {
      const key = args[0];
      if (!key) {
        // List all metadata
        const rows = db
          .query("SELECT key, value FROM metadata ORDER BY key")
          .all() as { key: string; value: string }[];
        if (rows.length === 0) {
          console.log("(no metadata)");
        } else {
          for (const r of rows) console.log(`${r.key}: ${r.value}`);
        }
      } else {
        const row = db
          .query("SELECT value FROM metadata WHERE key = ?")
          .get(key) as { value: string } | null;
        if (row) {
          console.log(row.value);
        } else {
          console.log(`(no value for '${key}')`);
        }
      }
      break;
    }
    case "clear-meta": {
      const key = args[0];
      if (!key) {
        console.error("Usage: bun model clear-meta <key>");
        throw new Error("fail");
      }
      db.run("DELETE FROM metadata WHERE key = ?", [key]);
      console.log(`${key} cleared.`);
      break;
    }
    // Shortcuts
    case "set-theme": {
      const text = args.join(" ").trim();
      if (!text) {
        console.error("Usage: bun model set-theme <description>");
        throw new Error("fail");
      }
      db.run(
        "INSERT OR REPLACE INTO metadata (key, value) VALUES ('theme', ?)",
        [text],
      );
      console.log(`theme: ${text}`);
      break;
    }
    case "get-theme": {
      const row = db
        .query("SELECT value FROM metadata WHERE key = 'theme'")
        .get() as { value: string } | null;
      if (row) {
        console.log(row.value);
      } else {
        console.log("(no theme set)");
      }
      break;
    }
    case "clear-theme": {
      db.run("DELETE FROM metadata WHERE key = 'theme'");
      console.log("Theme cleared.");
      break;
    }

    // === Listing ===

    case "list": {
      type E = { id: number; name: string };
      type F = { name: string; type: string };
      type R = {
        from_name: string;
        to_name: string;
        label: string;
        cardinality: string;
      };
      type M = {
        id: number;
        name: string;
        args: string;
        return_type: string;
        auth_required: number;
      };
      type MPerm = { path: string };

      const entities = db
        .query("SELECT * FROM entities ORDER BY name")
        .all() as E[];
      if (entities.length === 0) {
        console.log("No entities.");
        break;
      }
      for (const e of entities) {
        const fields = db
          .query(
            "SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id",
          )
          .all(e.id) as F[];
        const methods = db
          .query(
            "SELECT id, name, args, return_type, auth_required FROM methods WHERE entity_id = ? ORDER BY id",
          )
          .all(e.id) as M[];
        console.log(e.name);
        for (const f of fields) console.log(`  ${f.name}: ${f.type}`);
        if (methods.length > 0) {
          console.log("  --");
          for (const m of methods) {
            const perms = db
              .query("SELECT path FROM method_permissions WHERE method_id = ?")
              .all(m.id) as MPerm[];
            const perm =
              perms.length > 0
                ? ` [${perms.map((p) => p.path).join(" | ")}]`
                : m.auth_required
                  ? " [auth]"
                  : "";
            console.log(`  ${m.name}(${m.args}) -> ${m.return_type}${perm}`);
          }
        }
      }
      const rels = db
        .query(
          `
      SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
      FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
      ORDER BY e1.name
    `,
        )
        .all() as R[];
      if (rels.length > 0) {
        console.log("\nRelations:");
        for (const r of rels)
          console.log(
            `  ${r.from_name} -> ${r.to_name} ${r.label ? `[${r.label}]` : ""} ${r.cardinality}`,
          );
      }
      break;
    }

    case "list-stories": {
      type S = {
        id: number;
        actor: string;
        action: string;
        description: string;
      };
      type L = { target_type: string; target_id: number };

      const stories = db
        .query("SELECT * FROM stories ORDER BY id")
        .all() as S[];
      if (stories.length === 0) {
        console.log("No stories.");
        break;
      }
      for (const s of stories) {
        console.log(
          `#${s.id} As a ${s.actor}, I can ${s.action}${s.description ? ` (${s.description})` : ""}`,
        );
        const links = db
          .query(
            "SELECT target_type, target_id FROM story_links WHERE story_id = ? ORDER BY target_type",
          )
          .all(s.id) as L[];
        for (const l of links) {
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
          console.log(`  -> ${l.target_type}: ${name}`);
        }
      }
      break;
    }

    case "list-documents": {
      type D = {
        id: number;
        name: string;
        entity_name: string;
        collection: number;
        public: number;
        fetch: string;
        description: string;
      };
      type Exp = {
        id: number;
        name: string;
        entity_name: string;
        foreign_key: string;
        belongs_to: number;
        shallow: number;
        parent_expansion_id: number | null;
      };

      const docs = db
        .query(
          `
      SELECT d.id, d.name, e.name as entity_name, d.collection, d.public, d.fetch, d.description
      FROM documents d JOIN entities e ON d.entity_id = e.id ORDER BY d.name
    `,
        )
        .all() as D[];
      if (docs.length === 0) {
        console.log("No documents.");
        break;
      }
      for (const d of docs) {
        const flags = [
          d.collection ? "collection" : "",
          d.public ? "public" : "",
          d.fetch !== "select" ? d.fetch : "",
        ]
          .filter(Boolean)
          .join(", ");
        console.log(
          `${d.name} -> ${d.entity_name}${flags ? ` (${flags})` : ""}${d.description ? ` — ${d.description}` : ""}`,
        );
        const exps = db
          .query(
            `
        SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
        FROM expansions x JOIN entities e ON x.entity_id = e.id
        WHERE x.document_id = ? ORDER BY x.id
      `,
          )
          .all(d.id) as Exp[];
        function printExp(parentId: number | null, indent: string) {
          for (const x of exps.filter(
            (e) => e.parent_expansion_id === parentId,
          )) {
            const tags = [
              x.belongs_to ? "belongs-to" : "",
              x.shallow ? "shallow" : "",
            ]
              .filter(Boolean)
              .join(", ");
            console.log(
              `${indent}${x.name} -> ${x.entity_name} via ${x.foreign_key}${tags ? ` (${tags})` : ""}`,
            );
            if (!x.shallow) printExp(x.id, indent + "  ");
          }
        }
        printExp(null, "  ");
      }
      break;
    }

    case "export-spec": {
      type E = { id: number; name: string };
      type F = { name: string; type: string };
      type R = {
        from_name: string;
        to_name: string;
        label: string;
        cardinality: string;
      };
      type M = {
        id: number;
        name: string;
        args: string;
        return_type: string;
        auth_required: number;
      };
      type P = { property: string };
      type N = { channel: string; recipients: string; payload: string };
      type Perm = { path: string; description: string };
      type S = {
        id: number;
        actor: string;
        action: string;
        description: string;
      };
      type SL = { target_type: string; target_id: number };
      type D = {
        id: number;
        name: string;
        entity_name: string;
        entity_id: number;
        collection: number;
        public: number;
        fetch: string;
        description: string;
      };
      type Exp = {
        id: number;
        name: string;
        entity_name: string;
        foreign_key: string;
        belongs_to: number;
        shallow: number;
        parent_expansion_id: number | null;
      };

      const out: string[] = [];
      out.push("# Application Spec\n");

      // Metadata
      const metaRows = db
        .query("SELECT key, value FROM metadata ORDER BY key")
        .all() as { key: string; value: string }[];
      if (metaRows.length > 0) {
        out.push("## Metadata\n");
        for (const m of metaRows) {
          out.push(`- **${m.key}**: ${m.value}`);
        }
        out.push("");
      }

      // Stories
      const stories = db
        .query("SELECT * FROM stories ORDER BY id")
        .all() as S[];
      if (stories.length > 0) {
        out.push("## Stories\n");
        for (const s of stories) {
          out.push(
            `- ${s.id}# As a **${s.actor}**, I can **${s.action}**${s.description ? ` — ${s.description}` : ""}`,
          );
        }
        out.push("");
      }

      // Entities
      const entities = db
        .query("SELECT * FROM entities ORDER BY name")
        .all() as E[];
      if (entities.length > 0) {
        out.push("## Entities\n");
        for (const e of entities) {
          out.push(`### ${e.name}\n`);
          const fields = db
            .query(
              "SELECT name, type FROM fields WHERE entity_id = ? ORDER BY id",
            )
            .all(e.id) as F[];
          if (fields.length > 0) {
            out.push("| Field | Type |");
            out.push("|---|---|");
            for (const f of fields) out.push(`| ${f.name} | ${f.type} |`);
            out.push("");
          }
          // @change targets
          const changeLines: string[] = [];

          // Root: documents where this entity is the root
          const rootDocs = db
            .query(
              "SELECT name, collection FROM documents WHERE entity_id = ? ORDER BY name",
            )
            .all(e.id) as { name: string; collection: number }[];
          for (const rd of rootDocs) {
            const flag = rd.collection ? " (collection)" : "";
            changeLines.push(`- \`${rd.name}(id)\`${flag}`);
          }

          // Child: expansions where this entity appears (non-belongs_to)
          const entityExps = db
            .query(
              `
          SELECT x.id, x.name, x.foreign_key, x.parent_expansion_id, x.document_id,
                 d.name as doc_name
          FROM expansions x
          JOIN documents d ON x.document_id = d.id
          WHERE x.entity_id = ? AND x.belongs_to = 0
          ORDER BY x.id
        `,
            )
            .all(e.id) as {
            id: number;
            name: string;
            foreign_key: string;
            parent_expansion_id: number | null;
            document_id: number;
            doc_name: string;
          }[];
          if (entityExps.length > 0) {
            const allExps = db
              .query(
                "SELECT id, name, foreign_key, parent_expansion_id, document_id FROM expansions",
              )
              .all() as {
              id: number;
              name: string;
              foreign_key: string;
              parent_expansion_id: number | null;
              document_id: number;
            }[];
            const expMap = new Map(allExps.map((x) => [x.id, x]));
            for (const ex of entityExps) {
              const chain: { name: string; foreign_key: string }[] = [
                { name: ex.name, foreign_key: ex.foreign_key },
              ];
              let cur = ex.parent_expansion_id;
              while (cur !== null) {
                const parent = expMap.get(cur);
                if (!parent) break;
                chain.push({
                  name: parent.name,
                  foreign_key: parent.foreign_key,
                });
                cur = parent.parent_expansion_id;
              }
              chain.reverse(); // top-down order
              const docId = chain[0].foreign_key;
              const path = chain.map((c) => c.name).join(".");
              const parentIds = chain.slice(1).map((c) => c.foreign_key);
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

          const methods = db
            .query("SELECT * FROM methods WHERE entity_id = ? ORDER BY id")
            .all(e.id) as M[];
          if (methods.length > 0) {
            out.push("**Methods:**\n");
            for (const m of methods) {
              let argStr: string;
              try {
                const arr = JSON.parse(m.args) as {
                  name: string;
                  type: string;
                }[];
                argStr = arr.map((a) => `${a.name}: ${a.type}`).join(", ");
              } catch {
                argStr = m.args;
              }
              const authTag = m.auth_required ? " (auth required)" : "";
              out.push(
                `- \`${m.name}(${argStr})\` → \`${m.return_type}\`${authTag}`,
              );
              const pubs = db
                .query("SELECT property FROM publishes WHERE method_id = ?")
                .all(m.id) as P[];
              for (const p of pubs) out.push(`  - publishes \`${p.property}\``);
              const notifs = db
                .query(
                  "SELECT channel, recipients, payload FROM notifications WHERE method_id = ?",
                )
                .all(m.id) as N[];
              for (const n of notifs)
                out.push(`  - notifies \`${n.channel}\` → ${n.recipients}`);
              const perms = db
                .query(
                  "SELECT path, description FROM method_permissions WHERE method_id = ?",
                )
                .all(m.id) as Perm[];
              for (const p of perms)
                out.push(
                  `  - permission: \`${p.path}\`${p.description ? ` — ${p.description}` : ""}`,
                );
            }
            out.push("");
          }
        }

        // Relations
        const rels = db
          .query(
            `
        SELECT e1.name as from_name, e2.name as to_name, r.label, r.cardinality
        FROM relations r JOIN entities e1 ON r.from_entity_id = e1.id JOIN entities e2 ON r.to_entity_id = e2.id
        ORDER BY e1.name
      `,
          )
          .all() as R[];
        if (rels.length > 0) {
          out.push("## Relations\n");
          for (const r of rels) {
            const card = r.cardinality === "1" ? "belongs-to" : "has-many";
            out.push(
              `- **${r.from_name}** → **${r.to_name}**${r.label ? ` (${r.label})` : ""} [${card}]`,
            );
          }
          out.push("");
        }
      }

      // Documents
      const docs = db
        .query(
          `
      SELECT d.id, d.name, e.name as entity_name, e.id as entity_id, d.collection, d.public, d.fetch, d.description
      FROM documents d JOIN entities e ON d.entity_id = e.id ORDER BY d.name
    `,
        )
        .all() as D[];
      if (docs.length > 0) {
        out.push("## Documents\n");
        for (const d of docs) {
          const flags = [
            d.collection ? "collection" : "",
            d.public ? "public" : "",
            d.fetch !== "select" ? d.fetch : "",
          ]
            .filter(Boolean)
            .join(", ");
          out.push(`### ${d.name}\n`);
          if (d.description) out.push(`${d.description}\n`);
          out.push(
            `- **Entity:** ${d.entity_name}${flags ? ` (${flags})` : ""}`,
          );

          const exps = db
            .query(
              `
          SELECT x.id, x.name, e.name as entity_name, x.foreign_key, x.belongs_to, x.shallow, x.parent_expansion_id
          FROM expansions x JOIN entities e ON x.entity_id = e.id
          WHERE x.document_id = ? ORDER BY x.id
        `,
            )
            .all(d.id) as Exp[];

          if (exps.length > 0) {
            out.push("- **Expansions:**");
            function printExp(parentId: number | null, indent: string) {
              for (const x of exps.filter(
                (e) => e.parent_expansion_id === parentId,
              )) {
                const rel = x.belongs_to
                  ? "belongs-to"
                  : x.shallow
                    ? "shallow"
                    : "has-many";
                out.push(
                  `${indent}- \`${x.name}\` → ${x.entity_name} via \`${x.foreign_key}\` (${rel})`,
                );
                if (!x.shallow) printExp(x.id, indent + "  ");
              }
            }
            printExp(null, "  ");
          }

          // Linked stories
          const linked = db
            .query(
              `
          SELECT s.actor, s.action FROM stories s
          JOIN story_links sl ON sl.story_id = s.id
          WHERE sl.target_type = 'document' AND sl.target_id = ?
          ORDER BY s.id
        `,
            )
            .all(d.id) as { actor: string; action: string }[];
          if (linked.length > 0) {
            out.push("- **Stories:**");
            for (const s of linked)
              out.push(`  - As a ${s.actor}, I can ${s.action}`);
          }
          out.push("");
        }
      }

      // Checklists
      type CL = { id: number; name: string; description: string };
      type CK = {
        id: number;
        actor: string;
        action: string;
        description: string;
        confirmed: number;
        seq: number;
        entity_name: string | null;
        method_name: string | null;
      };
      type DepX = { depends_on_id: number };

      const cls = db
        .query("SELECT * FROM checklists ORDER BY name")
        .all() as CL[];
      if (cls.length > 0) {
        out.push("## Checklists\n");
        for (const cl of cls) {
          const cks = db
            .query(
              `SELECT c.id, c.actor, c.action, c.description, c.confirmed, c.seq,
                    e.name as entity_name, m.name as method_name
             FROM checks c
             LEFT JOIN methods m ON c.method_id = m.id
             LEFT JOIN entities e ON m.entity_id = e.id
             WHERE c.checklist_id = ?
             ORDER BY c.seq, c.id`,
            )
            .all(cl.id) as CK[];
          const apiDone = cks.filter((c) => c.confirmed & 1).length;
          const uxDone = cks.filter((c) => c.confirmed & 2).length;
          out.push(
            `### ${cl.name} [api:${apiDone}/${cks.length} ux:${uxDone}/${cks.length}]\n`,
          );
          if (cl.description) out.push(`${cl.description}\n`);
          for (const c of cks) {
            const api = c.confirmed & 1 ? "A" : ".";
            const ux = c.confirmed & 2 ? "U" : ".";
            const method =
              c.entity_name && c.method_name
                ? `${c.entity_name}.${c.method_name}`
                : "???";
            const denied = c.action === "denied" ? " **DENIED**" : "";
            const deps = db
              .query("SELECT depends_on_id FROM check_deps WHERE check_id = ?")
              .all(c.id) as DepX[];
            const depStr =
              deps.length > 0
                ? ` (after #${deps.map((d) => d.depends_on_id).join(", #")})`
                : "";
            out.push(
              `- [${api}${ux}] #${c.id} **${c.actor}** \`${method}\`${denied}${c.description ? ` — ${c.description}` : ""}${depStr}`,
            );
          }
          out.push("");
        }
      }

      console.log(out.join("\n"));
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}`);
      usage();
      throw new Error("fail");
  }
}

// --- Entry point ---

const [cmd, ...rawArgs] = process.argv.slice(2);

if (cmd === "batch") {
  // Read JSONL from stdin: each line is ["command", "arg1", "arg2", ...]
  const input = await Bun.stdin.text();
  const lines = input.trim().split("\n").filter(Boolean);
  let ok = 0,
    fail = 0;
  for (const line of lines) {
    try {
      const arr = JSON.parse(line) as string[];
      const [c, ...a] = arr;
      dispatch(c, a);
      ok++;
    } catch (e: any) {
      console.error(`FAIL: ${line}\n  ${e.message}`);
      fail++;
    }
  }
  console.log(`\nBatch: ${ok} ok, ${fail} failed, ${lines.length} total`);
} else if (!cmd) {
  usage();
} else {
  try {
    dispatch(cmd, rawArgs);
  } catch {
    process.exit(1);
  }
}

db.close();

function usage() {
  console.log(`Usage:
  Entities:
    bun model add-entity <Name>
    bun model add-field <Entity> <field> [type]
    bun model add-relation <From> <To> [label] [cardinality]
    bun model remove-entity <Name>
    bun model remove-field <Entity> <field>
    bun model remove-relation <From> <To> [label]

  Stories:
    bun model add-story <actor> <action> [description]
    bun model remove-story <id>

  Documents:
    bun model add-document <Name> <Entity> [--collection] [--public] [--cursor] [--stream] [--description <text>]
    bun model remove-document <Name>

  Expansions:
    bun model add-expansion <Document> <name> <Entity> <foreign_key> [--belongs-to] [--shallow] [--parent <name>]
    bun model remove-expansion <Document> <name>

  Methods:
    bun model add-method <Entity> <name> [args_json] [return_type] [--no-auth]
    bun model remove-method <Entity> <name>

  Publish / Notify:
    bun model add-publish <Entity.method> <property>
    bun model remove-publish <Entity.method> <property>
    bun model add-notification <Entity.method> <channel> <recipients> [payload_json]
    bun model remove-notification <Entity.method> <channel>

  Permissions:
    bun model add-permission <Entity.method> <path> [description]
    bun model remove-permission <id>

  Story Links:
    bun model link-story <story_id> <target_type> <target_name>
    bun model unlink-story <story_id> <target_type> <target_name>

  Metadata:
    bun model set-meta <key> <value>
    bun model get-meta [key]              (omit key to list all)
    bun model clear-meta <key>
    bun model set-theme <description>     (shortcut for set-meta theme ...)
    bun model get-theme
    bun model clear-theme

  Listing:
    bun model list
    bun model list-stories
    bun model list-documents

  Export:
    bun model export-spec

  Checklists:
    bun model add-checklist <name> [description]
    bun model remove-checklist <name>
    bun model add-check <checklist> <actor> <Entity.method> [description] [--denied] [--after <check_id>]
    bun model remove-check <check_id>
    bun model add-check-dep <check_id> <depends_on_id>
    bun model remove-check-dep <check_id> <depends_on_id>
    bun model confirm-check <check_id> --api|--ux
    bun model unconfirm-check <check_id> --api|--ux
    bun model list-checks [checklist]

  Batch:
    bun model batch              (reads JSONL from stdin)`);
}
