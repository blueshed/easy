import type { Database } from "bun:sqlite";
import { SCHEMAS, resolveFk, type SchemaDefinition, type ChildDef } from "./schemas";

// --- Target resolution for story links (polymorphic) ---

function resolveTarget(db: Database, type: string, name: string): number {
  switch (type) {
    case "entity": {
      const row = db.query("SELECT id FROM entities WHERE name = ?").get(name) as { id: number } | null;
      if (!row) throw new Error(`Entity '${name}' not found`);
      return row.id;
    }
    case "document": {
      const row = db.query("SELECT id FROM documents WHERE name = ?").get(name) as { id: number } | null;
      if (!row) throw new Error(`Document '${name}' not found`);
      return row.id;
    }
    case "method": {
      if (name.includes(".")) {
        const [ent, meth] = name.split(".");
        const eRow = db.query("SELECT id FROM entities WHERE name = ?").get(ent) as { id: number } | null;
        if (!eRow) throw new Error(`Entity '${ent}' not found`);
        const mRow = db.query("SELECT id FROM methods WHERE entity_id = ? AND name = ?").get(eRow.id, meth) as { id: number } | null;
        if (!mRow) throw new Error(`Method '${meth}' not found on '${ent}'`);
        return mRow.id;
      }
      const row = db.query("SELECT id FROM methods WHERE name = ?").get(name) as { id: number } | null;
      if (!row) throw new Error(`Method '${name}' not found`);
      return row.id;
    }
    case "notification": {
      const row = db.query("SELECT id FROM notifications WHERE channel = ?").get(name) as { id: number } | null;
      if (!row) throw new Error(`Notification '${name}' not found`);
      return row.id;
    }
    default:
      throw new Error(`Unknown target type '${type}'`);
  }
}

// --- Core save ---

export function save(db: Database, schemaName: string, obj: Record<string, unknown>): number {
  const schema = SCHEMAS[schemaName];
  if (!schema) throw new Error(`Unknown schema '${schemaName}'`);

  return db.transaction(() => doSave(db, schema, schemaName, obj))();
}

function doSave(
  db: Database,
  schema: SchemaDefinition,
  schemaName: string,
  obj: Record<string, unknown>,
  parentId?: number,
  parentFkColumn?: string,
): number {
  // 1. Resolve FKs
  const resolved: Record<string, number> = {};
  for (const fk of schema.fks) {
    const val = obj[fk.field];
    if (val !== undefined && val !== null) {
      resolved[fk.column] = resolveFk(db, fk, String(val));
    }
  }

  // Inject parent FK if this is a nested child
  if (parentId !== undefined && parentFkColumn) {
    resolved[parentFkColumn] = parentId;
  }

  // Special: nested expansion — inject document_id from parent
  if (schemaName === "expansion" && obj._document_id) {
    resolved["document_id"] = Number(obj._document_id);
  }

  // 2. Build column values (scalars only)
  const colValues: Record<string, unknown> = {};
  for (const [jsonKey, sqlCol] of Object.entries(schema.columns)) {
    if (jsonKey in obj) {
      let val = obj[jsonKey];
      // Boolean → integer
      if (schema.booleans?.includes(jsonKey)) {
        val = val ? 1 : 0;
      }
      // JSON-encode arrays/objects for string columns (e.g. method args)
      if (sqlCol === "args" && typeof val !== "string") {
        val = JSON.stringify(val);
      }
      colValues[sqlCol] = val;
    }
  }

  // 3. Handle special schemas
  if (schemaName === "_story_link") {
    return doSaveStoryLink(db, obj, parentId!);
  }
  if (schemaName === "_check_dep") {
    return doSaveCheckDep(db, obj, parentId!);
  }

  // 3b. Special: expansion parent — resolve "parent" field to parent_expansion_id
  if (schemaName === "expansion" && obj.parent) {
    const docId = resolved["document_id"] ?? parentId;
    if (docId) {
      const prow = db.query("SELECT id FROM expansions WHERE document_id = ? AND name = ?")
        .get(docId, String(obj.parent)) as { id: number } | null;
      if (!prow) throw new Error(`Parent expansion '${obj.parent}' not found`);
      resolved["parent_expansion_id"] = prow.id;
    }
  }

  // 4. Build natural key WHERE clause
  const whereColumns: string[] = [];
  const whereValues: unknown[] = [];
  for (const nk of schema.naturalKey) {
    // Check if this natural key field is an FK
    const fkRule = schema.fks.find((f) => f.field === nk);
    if (fkRule && resolved[fkRule.column] !== undefined) {
      whereColumns.push(fkRule.column);
      whereValues.push(resolved[fkRule.column]);
    } else if (nk === "_parent_id" && parentId !== undefined && parentFkColumn) {
      whereColumns.push(parentFkColumn);
      whereValues.push(parentId);
    } else if (schema.columns[nk]) {
      const val = colValues[schema.columns[nk]] ?? schema.defaults?.[nk];
      whereColumns.push(schema.columns[nk]);
      whereValues.push(val);
    }
  }

  // 5. Auto-increment seq for checks
  if (schemaName === "check" && !("seq" in obj) && resolved["checklist_id"]) {
    const maxSeq = db.query("SELECT COALESCE(MAX(seq), 0) as m FROM checks WHERE checklist_id = ?")
      .get(resolved["checklist_id"]) as { m: number };
    colValues["seq"] = maxSeq.m + 1;
  }

  // 5b. Handle 'denied' shorthand for checks
  if (schemaName === "check" && obj.denied) {
    colValues["action"] = "denied";
  }

  // 5c. Special: metadata uses INSERT OR REPLACE (no id column)
  if (schemaName === "metadata") {
    const key = obj.key as string;
    const value = obj.value as string;
    if (!key || value === undefined) throw new Error("Metadata requires key and value");
    db.run("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)", [key, value]);
    return 0; // no integer rowId for metadata
  }

  // 5b. Look up existing row
  let rowId: number;
  const whereClause = whereColumns.map((c) => `${c} = ?`).join(" AND ");
  const existing = whereClause
    ? (db.query(`SELECT id FROM ${schema.table} WHERE ${whereClause}`).get(...whereValues) as { id: number } | null)
    : null;

  if (existing) {
    // 6a. UPDATE — only provided columns (coalesce)
    const updateCols = { ...colValues, ...resolved };
    // Remove natural key columns from update (they don't change)
    for (const wc of whereColumns) delete updateCols[wc];
    if (parentFkColumn) delete updateCols[parentFkColumn];

    if (Object.keys(updateCols).length > 0) {
      const setClauses = Object.keys(updateCols).map((c) => `${c} = ?`);
      const setValues = Object.values(updateCols);
      db.run(
        `UPDATE ${schema.table} SET ${setClauses.join(", ")} WHERE id = ?`,
        [...setValues, existing.id],
      );
    }
    rowId = existing.id;
  } else {
    // 6b. INSERT — all provided values + defaults
    const insertCols: Record<string, unknown> = {};

    // Apply defaults first
    if (schema.defaults) {
      for (const [key, defaultVal] of Object.entries(schema.defaults)) {
        const sqlCol = schema.columns[key];
        if (sqlCol && !(sqlCol in colValues)) {
          let val = defaultVal;
          if (schema.booleans?.includes(key)) val = val ? 1 : 0;
          insertCols[sqlCol] = val;
        }
      }
    }

    // Then provided values (override defaults)
    Object.assign(insertCols, colValues);

    // Then resolved FKs
    Object.assign(insertCols, resolved);

    // Parent FK
    if (parentId !== undefined && parentFkColumn) {
      insertCols[parentFkColumn] = parentId;
    }

    const cols = Object.keys(insertCols);
    const placeholders = cols.map(() => "?").join(", ");
    const values = Object.values(insertCols);
    const info = db.run(
      `INSERT INTO ${schema.table} (${cols.join(", ")}) VALUES (${placeholders})`,
      values,
    );
    rowId = Number(info.lastInsertRowid);
  }

  // 7. Process children
  if (schema.children) {
    for (const childDef of schema.children) {
      const childArray = obj[childDef.key];
      if (!Array.isArray(childArray)) continue;

      const childSchema = SCHEMAS[childDef.schema];
      if (!childSchema) continue;

      for (const childItem of childArray) {
        const childObj = expandShorthand(childDef, childItem);
        // Special: nested expansions need document_id propagated
        if (childDef.schema === "expansion" && schemaName === "expansion") {
          // Parent is an expansion — propagate document_id from this expansion's row
          const parentRow = db.query("SELECT document_id FROM expansions WHERE id = ?").get(rowId) as { document_id: number } | null;
          if (parentRow) childObj._document_id = parentRow.document_id;
        }
        doSave(db, childSchema, childDef.schema, childObj, rowId, childDef.parentFkColumn);
      }
    }
  }

  return rowId;
}

// --- Shorthand expansion ---

function expandShorthand(childDef: ChildDef, item: unknown): Record<string, unknown> {
  if (typeof item === "string" && childDef.shorthandField) {
    return { [childDef.shorthandField]: item };
  }
  if (typeof item === "number" && childDef.shorthandField) {
    return { [childDef.shorthandField]: item };
  }
  return item as Record<string, unknown>;
}

// --- Special: story links ---

function doSaveStoryLink(db: Database, obj: Record<string, unknown>, storyId: number): number {
  const type = String(obj.type);
  const name = String(obj.name);
  const targetId = resolveTarget(db, type, name);

  const existing = db
    .query("SELECT id FROM story_links WHERE story_id = ? AND target_type = ? AND target_id = ?")
    .get(storyId, type, targetId) as { id: number } | null;
  if (existing) return existing.id;

  const info = db.run(
    "INSERT INTO story_links (story_id, target_type, target_id) VALUES (?, ?, ?)",
    [storyId, type, targetId],
  );
  return Number(info.lastInsertRowid);
}

// --- Special: check deps ---

function doSaveCheckDep(db: Database, obj: Record<string, unknown>, checkId: number): number {
  let depId = Number(obj.depends_on_id ?? obj.depends_on ?? obj.id ?? 0);

  // Resolve by natural key: checklist + actor + method
  if (!depId && obj.checklist && obj.actor && obj.method) {
    const parts = String(obj.method).split(".");
    if (parts.length !== 2) throw new Error(`Invalid method format '${obj.method}' — expected Entity.method`);
    const entity = db.query("SELECT id FROM entities WHERE name = ?").get(parts[0]) as { id: number } | null;
    if (!entity) throw new Error(`Entity '${parts[0]}' not found`);
    const method = db.query("SELECT id FROM methods WHERE entity_id = ? AND name = ?").get(entity.id, parts[1]) as { id: number } | null;
    if (!method) throw new Error(`Method '${obj.method}' not found`);
    const cl = db.query("SELECT id FROM checklists WHERE name = ?").get(String(obj.checklist)) as { id: number } | null;
    if (!cl) throw new Error(`Checklist '${obj.checklist}' not found`);
    const check = db.query("SELECT id FROM checks WHERE checklist_id = ? AND actor = ? AND method_id = ?")
      .get(cl.id, String(obj.actor), method.id) as { id: number } | null;
    if (!check) throw new Error(`Check '${obj.actor} ${obj.method}' not found in '${obj.checklist}'`);
    depId = check.id;
  }

  if (!depId) throw new Error("Check dependency requires depends_on_id or checklist + actor + method");

  const existing = db
    .query("SELECT id FROM check_deps WHERE check_id = ? AND depends_on_id = ?")
    .get(checkId, depId) as { id: number } | null;
  if (existing) return existing.id;

  const info = db.run(
    "INSERT INTO check_deps (check_id, depends_on_id) VALUES (?, ?)",
    [checkId, depId],
  );
  return Number(info.lastInsertRowid);
}

// --- Core delete ---

export function del(db: Database, schemaName: string, obj: Record<string, unknown>): void {
  const schema = SCHEMAS[schemaName];
  if (!schema) throw new Error(`Unknown schema '${schemaName}'`);

  db.transaction(() => {
    // Resolve FKs
    const resolved: Record<string, number> = {};
    for (const fk of schema.fks) {
      const val = obj[fk.field];
      if (val !== undefined && val !== null) {
        resolved[fk.column] = resolveFk(db, fk, String(val));
      }
    }

    // Build WHERE clause from natural key
    const whereColumns: string[] = [];
    const whereValues: unknown[] = [];
    for (const nk of schema.naturalKey) {
      const fkRule = schema.fks.find((f) => f.field === nk);
      if (fkRule && resolved[fkRule.column] !== undefined) {
        whereColumns.push(fkRule.column);
        whereValues.push(resolved[fkRule.column]);
      } else if (schema.columns[nk]) {
        whereColumns.push(schema.columns[nk]);
        whereValues.push(obj[nk]);
      }
    }

    if (whereColumns.length === 0) throw new Error("Cannot delete: no natural key provided");

    const whereClause = whereColumns.map((c) => `${c} = ?`).join(" AND ");

    // Clean up polymorphic story_links for entity/document/method deletions
    if (schemaName === "entity" || schemaName === "document" || schemaName === "method") {
      const targetType = schemaName;
      const row = db
        .query(`SELECT id FROM ${schema.table} WHERE ${whereClause}`)
        .get(...whereValues) as { id: number } | null;
      if (row) {
        db.run("DELETE FROM story_links WHERE target_type = ? AND target_id = ?", [targetType, row.id]);
      }
    }

    db.run(`DELETE FROM ${schema.table} WHERE ${whereClause}`, whereValues);
  })();
}
