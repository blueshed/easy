import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "fs";
import { resolve } from "path";

const DB = resolve(import.meta.dir, "../test-save.db");
process.env.MODEL_DB = DB;

import { openDb } from "./db";
import { save, del } from "./save";

import { ValidationError } from "./validate";

let db: ReturnType<typeof openDb>;

beforeAll(() => {
  try { unlinkSync(DB); } catch {}
  db = openDb();
});
afterAll(() => {
  db.close();
  try { unlinkSync(DB); } catch {}
});

// --- Entity + Fields ---

describe("save entity", () => {
  test("creates entity with fields inline", () => {
    const id = save(db, "entity", {
      name: "User",
      fields: [
        { name: "id", type: "number" },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
      ],
    });
    expect(id).toBeGreaterThan(0);
    const row = db.query("SELECT name FROM entities WHERE id = ?").get(id) as { name: string };
    expect(row.name).toBe("User");
  });

  test("coalesces new fields without removing old", () => {
    save(db, "entity", { name: "User", fields: [{ name: "avatar", type: "string" }] });
    const fields = db.query("SELECT name FROM fields WHERE entity_id = (SELECT id FROM entities WHERE name = 'User') ORDER BY name").all() as { name: string }[];
    const names = fields.map(f => f.name);
    expect(names).toContain("email");
    expect(names).toContain("avatar");
  });

  test("upserts by natural key", () => {
    const id1 = save(db, "entity", { name: "Project" });
    const id2 = save(db, "entity", { name: "Project" });
    expect(id1).toBe(id2);
  });

  test("rejects unknown schema", () => {
    expect(() => save(db, "bogus", {})).toThrow("Unknown schema");
  });

  test("rejects internal schema", () => {
    expect(() => save(db, "_story_link", {})).toThrow("internal schema");
  });
});

// --- Field standalone ---

describe("save field", () => {
  test("creates field on existing entity", () => {
    const id = save(db, "field", { entity: "User", name: "bio", type: "string" });
    expect(id).toBeGreaterThan(0);
  });

  test("rejects field on nonexistent entity", () => {
    expect(() => save(db, "field", { entity: "Bogus", name: "x", type: "string" })).toThrow();
  });
});

// --- Relation ---

describe("save relation", () => {
  test("creates relation between entities", () => {
    save(db, "entity", { name: "Task", fields: [{ name: "id", type: "number" }, { name: "user_id", type: "number" }] });
    const id = save(db, "relation", { from: "User", to: "Task", label: "tasks", cardinality: "*" });
    expect(id).toBeGreaterThan(0);
  });
});

// --- Method with children ---

describe("save method", () => {
  test("creates method with publishes and permissions inline", () => {
    const id = save(db, "method", {
      entity: "User",
      name: "updateProfile",
      args: [{ name: "name", type: "string" }],
      return_type: "boolean",
      publishes: ["name"],
      permissions: ["@user_id"],
    });
    expect(id).toBeGreaterThan(0);

    const pubs = db.query("SELECT property FROM publishes WHERE method_id = ?").all(id) as { property: string }[];
    expect(pubs.map(p => p.property)).toContain("name");

    const perms = db.query("SELECT path FROM method_permissions WHERE method_id = ?").all(id) as { path: string }[];
    expect(perms.map(p => p.path)).toContain("@user_id");
  });

  test("creates method with notifications", () => {
    const id = save(db, "method", {
      entity: "Task",
      name: "assign",
      args: [{ name: "user_id", type: "number" }],
      notifications: [{ channel: "task-assigned", recipients: "user_id" }],
    });
    const notifs = db.query("SELECT channel FROM notifications WHERE method_id = ?").all(id) as { channel: string }[];
    expect(notifs[0].channel).toBe("task-assigned");
  });
});

// --- Story with links ---

describe("save story", () => {
  test("creates story with links to entity and method", () => {
    const id = save(db, "story", {
      actor: "admin",
      action: "manage users",
      links: [
        { type: "entity", name: "User" },
        { type: "method", name: "User.updateProfile" },
      ],
    });
    expect(id).toBeGreaterThan(0);
    const links = db.query("SELECT target_type FROM story_links WHERE story_id = ?").all(id) as { target_type: string }[];
    expect(links.length).toBe(2);
  });

  test("rejects link to nonexistent entity", () => {
    expect(() => save(db, "story", {
      actor: "x", action: "y",
      links: [{ type: "entity", name: "Bogus" }],
    })).toThrow("not found");
  });
});

// --- Document with expansions ---

describe("save document", () => {
  test("creates document with expansions", () => {
    const id = save(db, "document", {
      name: "UserDoc",
      entity: "User",
      expansions: [{ name: "tasks", entity: "Task", foreign_key: "user_id" }],
    });
    expect(id).toBeGreaterThan(0);
    const exps = db.query("SELECT name FROM expansions WHERE document_id = ?").all(id) as { name: string }[];
    expect(exps[0].name).toBe("tasks");
  });
});

// --- Metadata ---

describe("save metadata", () => {
  test("creates and updates metadata", () => {
    save(db, "metadata", { key: "theme", value: "dark" });
    const v1 = db.query("SELECT value FROM metadata WHERE key = 'theme'").get() as { value: string };
    expect(v1.value).toBe("dark");

    save(db, "metadata", { key: "theme", value: "light" });
    const v2 = db.query("SELECT value FROM metadata WHERE key = 'theme'").get() as { value: string };
    expect(v2.value).toBe("light");
  });

  test("rejects metadata without key", () => {
    expect(() => save(db, "metadata", { value: "x" })).toThrow();
  });
});

// --- Flag ---

describe("save flag", () => {
  test("creates flag", () => {
    save(db, "flag", { name: "ci", status: "pass" });
    const row = db.query("SELECT status FROM flags WHERE name = 'ci'").get() as { status: string };
    expect(row.status).toBe("pass");
  });

  test("updates flag status", () => {
    save(db, "flag", { name: "ci", status: "fail" });
    const row = db.query("SELECT status FROM flags WHERE name = 'ci'").get() as { status: string };
    expect(row.status).toBe("fail");
  });

  test("creates flag with cmd", () => {
    save(db, "flag", { name: "lint", cmd: "bun run lint", status: "unknown" });
    const row = db.query("SELECT cmd FROM flags WHERE name = 'lint'").get() as { cmd: string };
    expect(row.cmd).toBe("bun run lint");
  });

  test("rejects flag without name", () => {
    expect(() => save(db, "flag", { status: "pass" })).toThrow();
  });
});

// --- Task with deps ---

describe("save task", () => {
  test("creates task", () => {
    const id = save(db, "task", { name: "build", description: "Build the app", status: "done" });
    expect(id).toBeGreaterThan(0);
  });

  test("creates task with dependency", () => {
    save(db, "task", { name: "test" });
    const id = save(db, "task", { name: "deploy", depends_on: [{ name: "build" }, { name: "test" }] });
    const deps = db.query("SELECT depends_on_id FROM task_deps WHERE task_id = ?").all(id) as { depends_on_id: number }[];
    expect(deps.length).toBe(2);
  });

  test("rejects self-dependency", () => {
    expect(() => save(db, "task", { name: "self-ref", depends_on: [{ name: "self-ref" }] })).toThrow("itself");
  });

  test("rejects circular dependency", () => {
    save(db, "task", { name: "a" });
    save(db, "task", { name: "b", depends_on: [{ name: "a" }] });
    expect(() => save(db, "task", { name: "a", depends_on: [{ name: "b" }] })).toThrow("Cycle");
  });

  test("rejects dependency on nonexistent task", () => {
    expect(() => save(db, "task", { name: "x", depends_on: [{ name: "nonexistent" }] })).toThrow("not found");
  });
});

// --- Memory ---

describe("save memory", () => {
  test("creates memory", () => {
    const id = save(db, "memory", { tag: "arch", content: "Uses pg_notify" });
    expect(id).toBeGreaterThan(0);
  });

  test("upserts same tag+content", () => {
    const id1 = save(db, "memory", { tag: "arch", content: "Uses pg_notify" });
    const id2 = save(db, "memory", { tag: "arch", content: "Uses pg_notify" });
    expect(id1).toBe(id2);
  });
});

// --- Checklist with checks ---

describe("save checklist", () => {
  test("creates checklist with checks", () => {
    const id = save(db, "checklist", {
      name: "Auth",
      description: "Verify auth",
      checks: [
        { actor: "admin", method: "User.updateProfile" },
        { actor: "guest", method: "User.updateProfile", denied: true },
      ],
    });
    const checks = db.query("SELECT action FROM checks WHERE checklist_id = ? ORDER BY seq").all(id) as { action: string }[];
    expect(checks[0].action).toBe("can");
    expect(checks[1].action).toBe("denied");
  });

  test("auto-increments seq", () => {
    const id = db.query("SELECT id FROM checklists WHERE name = 'Auth'").get() as { id: number };
    const seqs = db.query("SELECT seq FROM checks WHERE checklist_id = ? ORDER BY seq").all(id.id) as { seq: number }[];
    expect(seqs[0].seq).toBe(1);
    expect(seqs[1].seq).toBe(2);
  });
});

// --- Story link types ---

describe("story link resolvers", () => {
  test("links to document", () => {
    const id = save(db, "story", {
      actor: "user", action: "view doc",
      links: [{ type: "document", name: "UserDoc" }],
    });
    const links = db.query("SELECT target_type FROM story_links WHERE story_id = ?").all(id) as { target_type: string }[];
    expect(links.some(l => l.target_type === "document")).toBe(true);
  });

  test("links to notification", () => {
    // Task.assign already has a notification "task-assigned"
    const id = save(db, "story", {
      actor: "user", action: "get notified",
      links: [{ type: "notification", name: "task-assigned" }],
    });
    const links = db.query("SELECT target_type FROM story_links WHERE story_id = ?").all(id) as { target_type: string }[];
    expect(links.some(l => l.target_type === "notification")).toBe(true);
  });

  test("rejects link to nonexistent document", () => {
    expect(() => save(db, "story", {
      actor: "x", action: "y",
      links: [{ type: "document", name: "Bogus" }],
    })).toThrow("not found");
  });

  test("rejects link to nonexistent method", () => {
    expect(() => save(db, "story", {
      actor: "x", action: "y",
      links: [{ type: "method", name: "Bogus.nope" }],
    })).toThrow("not found");
  });

  test("rejects unknown link type", () => {
    expect(() => save(db, "story", {
      actor: "x", action: "y",
      links: [{ type: "bogus", name: "x" }],
    })).toThrow("Unknown target type");
  });
});

// --- Expansion parent ---

describe("expansion with parent", () => {
  test("creates nested expansion via parent field", () => {
    save(db, "entity", { name: "Comment", fields: [{ name: "id", type: "number" }, { name: "task_id", type: "number" }] });
    save(db, "expansion", { document: "UserDoc", name: "comments", entity: "Comment", foreign_key: "task_id", parent: "tasks" });
    const exp = db.query("SELECT parent_expansion_id FROM expansions WHERE name = 'comments'").get() as { parent_expansion_id: number };
    expect(exp.parent_expansion_id).toBeGreaterThan(0);
  });

  test("rejects nonexistent parent expansion", () => {
    expect(() => save(db, "expansion", {
      document: "UserDoc", name: "bogus", entity: "Task", foreign_key: "user_id", parent: "nonexistent",
    })).toThrow("not found");
  });
});

// --- Boolean and update paths ---

describe("coalesce update", () => {
  test("updates only provided fields on existing entity", () => {
    save(db, "entity", { name: "Project" });
    save(db, "field", { entity: "Project", name: "id", type: "number" });
    save(db, "document", { name: "ProjDoc", entity: "Project", collection: true, public: false });
    // Update to public
    save(db, "document", { name: "ProjDoc", entity: "Project", public: true });
    const doc = db.query("SELECT public, collection FROM documents WHERE name = 'ProjDoc'").get() as { public: number; collection: number };
    expect(doc.public).toBe(1);
    expect(doc.collection).toBe(1); // preserved from first save
  });
});

// --- Check dep by natural key ---

describe("check dep by natural key", () => {
  test("adds check dependency by checklist+actor+method", () => {
    const clId = save(db, "checklist", {
      name: "DepTest",
      checks: [
        { actor: "owner", method: "User.updateProfile" },
        { actor: "stranger", method: "User.updateProfile", denied: true },
      ],
    });
    // Add dep: stranger depends on owner
    save(db, "check", {
      checklist: "DepTest",
      actor: "stranger",
      method: "User.updateProfile",
      depends_on: [{
        checklist: "DepTest",
        actor: "owner",
        method: "User.updateProfile",
      }],
    });
    const checks = db.query("SELECT id FROM checks WHERE checklist_id = ? ORDER BY seq").all(clId) as { id: number }[];
    const deps = db.query("SELECT depends_on_id FROM check_deps WHERE check_id = ?").all(checks[1].id) as { depends_on_id: number }[];
    expect(deps.length).toBe(1);
    expect(deps[0].depends_on_id).toBe(checks[0].id);
  });

  test("rejects check dep with bad method format", () => {
    expect(() => save(db, "check", {
      checklist: "DepTest", actor: "owner", method: "User.updateProfile",
      depends_on: [{ checklist: "DepTest", actor: "owner", method: "badformat" }],
    })).toThrow("Entity.method");
  });
});

// --- Publish/Permission standalone ---

describe("save publish standalone", () => {
  test("creates publish by method reference", () => {
    const id = save(db, "publish", { method: "User.updateProfile", property: "email" });
    expect(id).toBeGreaterThan(0);
  });
});

describe("save notification standalone", () => {
  test("creates notification by method reference", () => {
    const id = save(db, "notification", { method: "User.updateProfile", channel: "profile-updated", recipients: "user_id" });
    expect(id).toBeGreaterThan(0);
  });
});

// --- Delete ---

describe("del", () => {
  test("deletes entity and cascades", () => {
    save(db, "entity", { name: "Temp", fields: [{ name: "id", type: "number" }] });
    del(db, "entity", { name: "Temp" });
    const row = db.query("SELECT id FROM entities WHERE name = 'Temp'").get();
    expect(row).toBeNull();
  });

  test("deletes metadata", () => {
    save(db, "metadata", { key: "temp", value: "v" });
    del(db, "metadata", { key: "temp" });
    const row = db.query("SELECT key FROM metadata WHERE key = 'temp'").get();
    expect(row).toBeNull();
  });

  test("cleans up story_links on entity delete", () => {
    save(db, "entity", { name: "Ephemeral" });
    save(db, "story", { actor: "x", action: "y", links: [{ type: "entity", name: "Ephemeral" }] });
    const before = db.query("SELECT id FROM story_links WHERE target_type = 'entity'").all();
    del(db, "entity", { name: "Ephemeral" });
    const after = db.query("SELECT id FROM story_links WHERE target_type = 'entity' AND target_id NOT IN (SELECT id FROM entities)").all();
    expect(after.length).toBe(0);
  });

  test("rejects delete on unknown schema", () => {
    expect(() => del(db, "bogus", {})).toThrow("Unknown schema");
  });

  test("rejects delete on internal schema", () => {
    expect(() => del(db, "_story_link", {})).toThrow("internal schema");
  });

  test("deletes document and cleans up story_links", () => {
    save(db, "entity", { name: "TempEnt", fields: [{ name: "id", type: "number" }] });
    save(db, "document", { name: "TempDoc", entity: "TempEnt" });
    save(db, "story", { actor: "z", action: "z", links: [{ type: "document", name: "TempDoc" }] });
    del(db, "document", { name: "TempDoc" });
    const orphans = db.query("SELECT id FROM story_links WHERE target_type = 'document' AND target_id NOT IN (SELECT id FROM documents)").all();
    expect(orphans.length).toBe(0);
  });
});

// --- Validation ---

describe("validation", () => {
  test("rejects missing natural key", () => {
    expect(() => save(db, "entity", {})).toThrow(ValidationError);
  });

  test("rejects invalid boolean field", () => {
    expect(() => save(db, "document", {
      name: "BadDoc", entity: "User", collection: "yes" as any,
    })).toThrow(ValidationError);
  });

  test("rejects non-array children", () => {
    expect(() => save(db, "entity", {
      name: "Bad", fields: "not-an-array" as any,
    })).toThrow(ValidationError);
  });

  test("rejects invalid FK type", () => {
    expect(() => save(db, "field", {
      entity: { bad: true } as any, name: "x", type: "string",
    })).toThrow(ValidationError);
  });
});
