import { Database } from "bun:sqlite";
import { resolve } from "path";

export const DB_PATH = resolve(process.env.MODEL_DB ?? "model.db");

export function openDb(readonly = false): Database {
  const db = new Database(DB_PATH, readonly ? { readonly: true } : undefined);
  if (!readonly) {
    db.exec(`
      -- Entities: database tables
      CREATE TABLE IF NOT EXISTS entities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS fields (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'string',
        UNIQUE(entity_id, name)
      );
      CREATE TABLE IF NOT EXISTS relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        to_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        label TEXT NOT NULL DEFAULT '',
        cardinality TEXT NOT NULL DEFAULT '*',
        UNIQUE(from_entity_id, to_entity_id, label)
      );

      -- User stories
      CREATE TABLE IF NOT EXISTS stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      -- Documents: Folly server.document() entry points
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        collection INTEGER NOT NULL DEFAULT 0,
        public INTEGER NOT NULL DEFAULT 0,
        fetch TEXT NOT NULL DEFAULT 'select'
      );

      -- Expansions: child entities loaded with a document
      CREATE TABLE IF NOT EXISTS expansions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        parent_expansion_id INTEGER REFERENCES expansions(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        foreign_key TEXT NOT NULL,
        belongs_to INTEGER NOT NULL DEFAULT 0,
        shallow INTEGER NOT NULL DEFAULT 0
      );

      -- Methods: RMI handlers on entities
      CREATE TABLE IF NOT EXISTS methods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]',
        return_type TEXT NOT NULL DEFAULT 'boolean',
        auth_required INTEGER NOT NULL DEFAULT 1,
        UNIQUE(entity_id, name)
      );

      -- Publishes: ctx.publish() calls within methods
      CREATE TABLE IF NOT EXISTS publishes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
        property TEXT NOT NULL
      );

      -- Notifications: ctx.notify() calls within methods
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
        channel TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        recipients TEXT NOT NULL
      );

      -- Permission paths: DZQL-style traversal expressions per method
      CREATE TABLE IF NOT EXISTS method_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method_id INTEGER NOT NULL REFERENCES methods(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT ''
      );

      -- Story links: connect stories to artifacts
      CREATE TABLE IF NOT EXISTS story_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        story_id INTEGER NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        UNIQUE(story_id, target_type, target_id)
      );

      -- Checklists: named sequences of verifiable steps
      CREATE TABLE IF NOT EXISTS checklists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT ''
      );

      -- Checks: individual steps — actor + method + can/denied + confirmed bitmask (1=api, 2=ux, 3=both)
      CREATE TABLE IF NOT EXISTS checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checklist_id INTEGER NOT NULL REFERENCES checklists(id) ON DELETE CASCADE,
        actor TEXT NOT NULL,
        method_id INTEGER REFERENCES methods(id) ON DELETE SET NULL,
        action TEXT NOT NULL DEFAULT 'can',
        description TEXT NOT NULL DEFAULT '',
        confirmed INTEGER NOT NULL DEFAULT 0,
        seq INTEGER NOT NULL DEFAULT 0
      );

      -- Check dependencies: DAG of step ordering
      CREATE TABLE IF NOT EXISTS check_deps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        check_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
        depends_on_id INTEGER NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
        UNIQUE(check_id, depends_on_id)
      );

      -- Metadata: key-value store for project-level settings (theme, etc.)
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    // Migration: add fetch column to existing databases
    try {
      db.exec(`ALTER TABLE documents ADD COLUMN fetch TEXT NOT NULL DEFAULT 'select'`);
    } catch {
      // Column already exists
    }
  }
  return db;
}
