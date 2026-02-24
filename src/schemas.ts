import type { Database } from "bun:sqlite";

// --- Types ---

export interface FkRule {
  /** JSON field name (e.g. "entity") */
  field: string;
  /** SQLite column to write the resolved ID into */
  column: string;
  /** How to resolve: simple table lookup or compound "Entity.method" split */
  resolve: SimpleFk | CompoundFk;
}

interface SimpleFk {
  type: "simple";
  table: string;
  lookupColumn: string; // column to match against (e.g. "name")
}

interface CompoundFk {
  type: "compound";
  /** First: resolve the left side of "Entity.method" */
  parentTable: string;
  parentLookupColumn: string;
  parentIdColumn: string; // FK column in the target table (e.g. "entity_id")
  /** Then: resolve the right side within that parent */
  table: string;
  lookupColumn: string;
}

export interface ChildDef {
  /** JSON array key (e.g. "fields") */
  key: string;
  /** Schema name of the child */
  schema: string;
  /** Column in the child table that references the parent row ID */
  parentFkColumn: string;
  /** For string shorthand: the field name to expand into (e.g. "property" for publishes) */
  shorthandField?: string;
}

export interface SchemaDefinition {
  table: string;
  naturalKey: string[];
  columns: Record<string, string>; // JSON field → SQLite column
  fks: FkRule[];
  children?: ChildDef[];
  defaults?: Record<string, unknown>;
  booleans?: string[]; // JSON fields stored as 0/1 integers
}

// --- FK Resolution ---

export function resolveFk(db: Database, rule: FkRule, value: string): number {
  if (rule.resolve.type === "simple") {
    const { table, lookupColumn } = rule.resolve;
    const row = db
      .query(`SELECT id FROM ${table} WHERE ${lookupColumn} = ?`)
      .get(value) as { id: number } | null;
    if (!row) throw new Error(`${table} '${value}' not found`);
    return row.id;
  }
  // compound: "Entity.method" → resolve entity, then method within entity
  const { parentTable, parentLookupColumn, parentIdColumn, table, lookupColumn } =
    rule.resolve;
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error(`Expected 'Parent.child' format, got '${value}'`);
  const [parentName, childName] = parts;
  const parentRow = db
    .query(`SELECT id FROM ${parentTable} WHERE ${parentLookupColumn} = ?`)
    .get(parentName) as { id: number } | null;
  if (!parentRow) throw new Error(`${parentTable} '${parentName}' not found`);
  const row = db
    .query(`SELECT id FROM ${table} WHERE ${parentIdColumn} = ? AND ${lookupColumn} = ?`)
    .get(parentRow.id, childName) as { id: number } | null;
  if (!row) throw new Error(`${table} '${childName}' not found on '${parentName}'`);
  return row.id;
}

// --- Schema Registry ---

export const SCHEMAS: Record<string, SchemaDefinition> = {
  entity: {
    table: "entities",
    naturalKey: ["name"],
    columns: { name: "name" },
    fks: [],
    children: [
      { key: "fields", schema: "field", parentFkColumn: "entity_id" },
      { key: "methods", schema: "method", parentFkColumn: "entity_id" },
    ],
  },

  field: {
    table: "fields",
    naturalKey: ["entity", "name"],
    columns: { name: "name", type: "type" },
    fks: [
      {
        field: "entity",
        column: "entity_id",
        resolve: { type: "simple", table: "entities", lookupColumn: "name" },
      },
    ],
    defaults: { type: "string" },
  },

  relation: {
    table: "relations",
    naturalKey: ["from", "to", "label"],
    columns: { label: "label", cardinality: "cardinality" },
    fks: [
      {
        field: "from",
        column: "from_entity_id",
        resolve: { type: "simple", table: "entities", lookupColumn: "name" },
      },
      {
        field: "to",
        column: "to_entity_id",
        resolve: { type: "simple", table: "entities", lookupColumn: "name" },
      },
    ],
    defaults: { label: "", cardinality: "*" },
  },

  story: {
    table: "stories",
    naturalKey: ["actor", "action"],
    columns: { actor: "actor", action: "action", description: "description" },
    fks: [],
    defaults: { description: "" },
    children: [
      { key: "links", schema: "_story_link", parentFkColumn: "story_id" },
    ],
  },

  document: {
    table: "documents",
    naturalKey: ["name"],
    columns: {
      name: "name",
      collection: "collection",
      public: "public",
      fetch: "fetch",
      description: "description",
    },
    fks: [
      {
        field: "entity",
        column: "entity_id",
        resolve: { type: "simple", table: "entities", lookupColumn: "name" },
      },
    ],
    defaults: { collection: false, public: false, fetch: "select", description: "" },
    booleans: ["collection", "public"],
    children: [
      { key: "expansions", schema: "expansion", parentFkColumn: "document_id" },
    ],
  },

  expansion: {
    table: "expansions",
    naturalKey: ["document", "name"],
    columns: {
      name: "name",
      foreign_key: "foreign_key",
      belongs_to: "belongs_to",
      shallow: "shallow",
    },
    fks: [
      {
        field: "document",
        column: "document_id",
        resolve: { type: "simple", table: "documents", lookupColumn: "name" },
      },
      {
        field: "entity",
        column: "entity_id",
        resolve: { type: "simple", table: "entities", lookupColumn: "name" },
      },
    ],
    defaults: { belongs_to: false, shallow: false },
    booleans: ["belongs_to", "shallow"],
    children: [
      { key: "expansions", schema: "expansion", parentFkColumn: "parent_expansion_id" },
    ],
  },

  method: {
    table: "methods",
    naturalKey: ["entity", "name"],
    columns: {
      name: "name",
      args: "args",
      return_type: "return_type",
      auth_required: "auth_required",
    },
    fks: [
      {
        field: "entity",
        column: "entity_id",
        resolve: { type: "simple", table: "entities", lookupColumn: "name" },
      },
    ],
    defaults: { args: "[]", return_type: "boolean", auth_required: true },
    booleans: ["auth_required"],
    children: [
      {
        key: "publishes",
        schema: "publish",
        parentFkColumn: "method_id",
        shorthandField: "property",
      },
      {
        key: "permissions",
        schema: "permission",
        parentFkColumn: "method_id",
        shorthandField: "path",
      },
      {
        key: "notifications",
        schema: "notification",
        parentFkColumn: "method_id",
      },
    ],
  },

  publish: {
    table: "publishes",
    naturalKey: ["method", "property"],
    columns: { property: "property" },
    fks: [
      {
        field: "method",
        column: "method_id",
        resolve: {
          type: "compound",
          parentTable: "entities",
          parentLookupColumn: "name",
          parentIdColumn: "entity_id",
          table: "methods",
          lookupColumn: "name",
        },
      },
    ],
  },

  notification: {
    table: "notifications",
    naturalKey: ["method", "channel"],
    columns: {
      channel: "channel",
      payload: "payload",
      recipients: "recipients",
    },
    fks: [
      {
        field: "method",
        column: "method_id",
        resolve: {
          type: "compound",
          parentTable: "entities",
          parentLookupColumn: "name",
          parentIdColumn: "entity_id",
          table: "methods",
          lookupColumn: "name",
        },
      },
    ],
    defaults: { payload: "{}" },
  },

  permission: {
    table: "method_permissions",
    naturalKey: ["method", "path"],
    columns: { path: "path", description: "description" },
    fks: [
      {
        field: "method",
        column: "method_id",
        resolve: {
          type: "compound",
          parentTable: "entities",
          parentLookupColumn: "name",
          parentIdColumn: "entity_id",
          table: "methods",
          lookupColumn: "name",
        },
      },
    ],
    defaults: { description: "" },
  },

  checklist: {
    table: "checklists",
    naturalKey: ["name"],
    columns: { name: "name", description: "description" },
    fks: [],
    defaults: { description: "" },
    children: [
      { key: "checks", schema: "check", parentFkColumn: "checklist_id" },
    ],
  },

  check: {
    table: "checks",
    naturalKey: ["checklist", "actor", "method"],
    columns: {
      actor: "actor",
      action: "action",
      description: "description",
      confirmed: "confirmed",
      seq: "seq",
    },
    fks: [
      {
        field: "checklist",
        column: "checklist_id",
        resolve: { type: "simple", table: "checklists", lookupColumn: "name" },
      },
      {
        field: "method",
        column: "method_id",
        resolve: {
          type: "compound",
          parentTable: "entities",
          parentLookupColumn: "name",
          parentIdColumn: "entity_id",
          table: "methods",
          lookupColumn: "name",
        },
      },
    ],
    defaults: { action: "can", description: "", confirmed: 0, seq: 0 },
    children: [
      { key: "depends_on", schema: "_check_dep", parentFkColumn: "check_id" },
    ],
  },

  metadata: {
    table: "metadata",
    naturalKey: ["key"],
    columns: { key: "key", value: "value" },
    fks: [],
  },

  // --- Internal child schemas (not directly invokable) ---

  _story_link: {
    table: "story_links",
    naturalKey: ["_parent_id", "type", "name"],
    columns: { target_type: "target_type" },
    fks: [], // special: resolved in save.ts via resolveTarget
  },

  _check_dep: {
    table: "check_deps",
    naturalKey: ["_parent_id", "depends_on_id"],
    columns: {},
    fks: [], // special: depends_on_id is a check ID resolved by reference
  },
};
