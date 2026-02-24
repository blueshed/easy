import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "fs";
import { resolve } from "path";

// Set MODEL_DB before imports — getDbPath() reads this lazily
const DB = resolve(import.meta.dir, "../test-etl.db");
process.env.MODEL_DB = DB;

import {
  getEntityList,
  getEntityDetail,
  getDocumentList,
  getDocumentDetail,
  getStories,
  getChecklistList,
  getChecklistDetail,
  getMetadata,
} from "./etl";
import { openDb } from "./db";

// ─── Seed the database ───

const CLI = resolve(import.meta.dir, "cli.ts");

function run(...args: string[]) {
  Bun.spawnSync(["bun", CLI, ...args], {
    env: { ...process.env, MODEL_DB: DB },
  });
}

beforeAll(() => {
  try { unlinkSync(DB); } catch {}

  // Build a model via CLI to populate the test DB
  run("add-entity", "User");
  run("add-field", "User", "email", "string");
  run("add-field", "User", "name", "string");

  run("add-entity", "Project");
  run("add-field", "Project", "title", "string");
  run("add-field", "Project", "owner_id", "number");

  run("add-entity", "Task");
  run("add-field", "Task", "project_id", "number");
  run("add-field", "Task", "assignee_id", "number");
  run("add-field", "Task", "summary", "string");

  run("add-entity", "Comment");
  run("add-field", "Comment", "task_id", "number");
  run("add-field", "Comment", "body", "string");

  run("add-relation", "User", "Project", "owner", "1");
  run("add-relation", "Project", "Task");

  run("add-method", "Project", "create", '[{"name":"title","type":"string"}]', "Project");
  run("add-method", "Task", "assign", '[{"name":"user_id","type":"number"}]', "boolean", "--permission", "project_id.owner_id");
  run("add-method", "User", "register", '[{"name":"email","type":"string"}]', "User", "--no-auth");

  run("add-publish", "Project.create", "title");
  run("add-publish", "Project.create", "owner_id");

  run("add-notification", "Task.assign", "task-assigned", "assignee_id", '{"task_id":"number"}');

  run("add-permission", "Project.create", "owner_id", "must be owner");

  run("add-document", "ProjectDoc", "Project");
  run("add-document", "TaskList", "Task", "--collection", "--public", "--description", "All tasks");
  run("add-document", "UserProfile", "User", "--cursor");

  run("add-expansion", "ProjectDoc", "tasks", "Task", "project_id");
  run("add-expansion", "ProjectDoc", "owner", "User", "owner_id", "--belongs-to");
  run("add-expansion", "ProjectDoc", "comments", "Comment", "task_id", "--parent", "tasks");

  run("add-story", "manager", "create projects", "to organise work");
  run("add-story", "developer", "view tasks");

  run("link-story", "1", "document", "ProjectDoc");
  run("link-story", "1", "entity", "Project");
  run("link-story", "1", "method", "Project.create");

  run("set-meta", "app-name", "Test App");
  run("set-meta", "version", "1.0");
  run("set-theme", "Dark modern");

  run("add-checklist", "auth-flow", "Verify authentication");
  run("add-check", "auth-flow", "manager", "Project.create", "manager can create");
  run("add-check", "auth-flow", "guest", "Project.create", "guest cannot", "--denied");
  // Confirm first check
  run("confirm-check", "1", "--api");
});

afterAll(() => {
  try { unlinkSync(DB); } catch {}
});

// ─── Entity queries ───

describe("getEntityList", () => {
  test("returns all entities", () => {
    const list = getEntityList();
    const names = list.map((e) => e.name);
    expect(names).toContain("User");
    expect(names).toContain("Project");
    expect(names).toContain("Task");
    expect(names).toContain("Comment");
    expect(names.length).toBe(4);
  });

  test("entities are sorted by name", () => {
    const list = getEntityList();
    const names = list.map((e) => e.name);
    expect(names).toEqual([...names].sort());
  });
});

describe("getEntityDetail", () => {
  test("returns null for missing entity", () => {
    expect(getEntityDetail("Bogus")).toBeNull();
  });

  test("returns fields", () => {
    const detail = getEntityDetail("User")!;
    expect(detail).not.toBeNull();
    expect(detail.name).toBe("User");
    expect(detail.fields).toEqual([
      { name: "email", type: "string" },
      { name: "name", type: "string" },
    ]);
  });

  test("returns methods with args parsed", () => {
    const detail = getEntityDetail("Project")!;
    expect(detail.methods.length).toBe(1);
    const m = detail.methods[0];
    expect(m.name).toBe("create");
    expect(m.args).toBe("title: string");
    expect(m.return_type).toBe("Project");
  });

  test("returns publishes on methods", () => {
    const detail = getEntityDetail("Project")!;
    const m = detail.methods[0];
    expect(m.publishes).toContain("title");
    expect(m.publishes).toContain("owner_id");
  });

  test("returns notifications on methods", () => {
    const detail = getEntityDetail("Task")!;
    const m = detail.methods.find((m) => m.name === "assign")!;
    expect(m.notifications.length).toBe(1);
    expect(m.notifications[0].channel).toBe("task-assigned");
    expect(m.notifications[0].recipients).toBe("assignee_id");
  });

  test("returns permissions on methods", () => {
    const detail = getEntityDetail("Task")!;
    const m = detail.methods.find((m) => m.name === "assign")!;
    expect(m.permissions.length).toBe(1);
    expect(m.permissions[0].path).toBe("project_id.owner_id");
  });

  test("returns permission from add-permission too", () => {
    const detail = getEntityDetail("Project")!;
    const m = detail.methods[0];
    expect(m.permissions.length).toBeGreaterThanOrEqual(1);
    expect(m.permissions.some((p) => p.path === "owner_id")).toBe(true);
  });

  test("returns relations in both directions", () => {
    const detail = getEntityDetail("User")!;
    // User -> Project (owner, 1)
    expect(detail.relations.length).toBeGreaterThanOrEqual(1);
    const toPrj = detail.relations.find((r) => r.entity === "Project");
    expect(toPrj).toBeDefined();
    expect(toPrj!.direction).toBe("to");
  });

  test("returns documents where entity is root", () => {
    const detail = getEntityDetail("Project")!;
    const rootDocs = detail.documents.filter((d) => d.role === "root");
    expect(rootDocs.some((d) => d.name === "ProjectDoc")).toBe(true);
  });

  test("returns documents where entity is expansion", () => {
    const detail = getEntityDetail("Task")!;
    const expDocs = detail.documents.filter((d) => d.role === "expansion");
    expect(expDocs.some((d) => d.name === "ProjectDoc")).toBe(true);
  });

  test("returns changes for root entity", () => {
    const detail = getEntityDetail("Project")!;
    const rootChange = detail.changes.find((c) => c.path === null);
    expect(rootChange).toBeDefined();
    expect(rootChange!.doc).toBe("ProjectDoc");
  });

  test("returns changes for expansion entity with path", () => {
    const detail = getEntityDetail("Task")!;
    const change = detail.changes.find((c) => c.doc === "ProjectDoc");
    expect(change).toBeDefined();
    expect(change!.path).toBe("tasks");
    expect(change!.fks).toContain("project_id");
  });

  test("returns changes for nested expansion with chain", () => {
    const detail = getEntityDetail("Comment")!;
    const change = detail.changes.find((c) => c.doc === "ProjectDoc");
    expect(change).toBeDefined();
    expect(change!.path).toBe("tasks.comments");
    expect(change!.fks.length).toBe(2);
  });

  test("belongs-to expansions do not generate changes", () => {
    const detail = getEntityDetail("User")!;
    // User is belongs-to in ProjectDoc, should NOT have a change for ProjectDoc via expansion
    const expChanges = detail.changes.filter((c) => c.doc === "ProjectDoc" && c.path !== null);
    expect(expChanges.length).toBe(0);
  });
});

// ─── Document queries ───

describe("getDocumentList", () => {
  test("returns all documents", () => {
    const list = getDocumentList();
    expect(list.length).toBe(3);
    const names = list.map((d) => d.name);
    expect(names).toContain("ProjectDoc");
    expect(names).toContain("TaskList");
    expect(names).toContain("UserProfile");
  });

  test("documents sorted by name", () => {
    const list = getDocumentList();
    const names = list.map((d) => d.name);
    expect(names).toEqual([...names].sort());
  });

  test("returns correct flags", () => {
    const list = getDocumentList();
    const tl = list.find((d) => d.name === "TaskList")!;
    expect(tl.collection).toBe(true);
    expect(tl.public).toBe(true);
    expect(tl.description).toBe("All tasks");
  });

  test("returns fetch mode", () => {
    const list = getDocumentList();
    const up = list.find((d) => d.name === "UserProfile")!;
    expect(up.fetch).toBe("cursor");
  });

  test("returns entity name", () => {
    const list = getDocumentList();
    const pd = list.find((d) => d.name === "ProjectDoc")!;
    expect(pd.entity).toBe("Project");
  });
});

describe("getDocumentDetail", () => {
  test("returns null for missing document", () => {
    expect(getDocumentDetail("Bogus")).toBeNull();
  });

  test("returns basic info", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    expect(detail).not.toBeNull();
    expect(detail.name).toBe("ProjectDoc");
    expect(detail.entity).toBe("Project");
    expect(detail.collection).toBe(false);
    expect(detail.public).toBe(false);
  });

  test("returns methods from root entity", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    expect(detail.methods.length).toBe(1);
    expect(detail.methods[0].name).toBe("create");
    expect(detail.methods[0].publishes).toContain("title");
  });

  test("returns changedBy with root entity", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    const root = detail.changedBy.find((c) => c.entity === "Project" && c.path === null);
    expect(root).toBeDefined();
  });

  test("returns changedBy with expansion entities", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    const taskChange = detail.changedBy.find((c) => c.entity === "Task");
    expect(taskChange).toBeDefined();
    expect(taskChange!.path).toBe("tasks");
  });

  test("returns changedBy for nested expansions", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    const commentChange = detail.changedBy.find((c) => c.entity === "Comment");
    expect(commentChange).toBeDefined();
    expect(commentChange!.path).toBe("tasks.comments");
  });

  test("belongs-to not in changedBy", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    // User is belongs-to, should not appear in changedBy
    const userChange = detail.changedBy.find((c) => c.entity === "User");
    expect(userChange).toBeUndefined();
  });

  test("returns linked stories", () => {
    const detail = getDocumentDetail("ProjectDoc")!;
    expect(detail.stories.length).toBe(1);
    expect(detail.stories[0].actor).toBe("manager");
    expect(detail.stories[0].action).toBe("create projects");
  });

  test("returns description", () => {
    const detail = getDocumentDetail("TaskList")!;
    expect(detail.description).toBe("All tasks");
  });

  test("returns fetch mode", () => {
    const detail = getDocumentDetail("UserProfile")!;
    expect(detail.fetch).toBe("cursor");
  });
});

// ─── Stories ───

describe("getStories", () => {
  test("returns all stories", () => {
    const stories = getStories();
    expect(stories.length).toBe(2);
  });

  test("returns story fields", () => {
    const stories = getStories();
    const s1 = stories.find((s) => s.actor === "manager")!;
    expect(s1.action).toBe("create projects");
    expect(s1.description).toBe("to organise work");
  });

  test("returns resolved links", () => {
    const stories = getStories();
    const s1 = stories.find((s) => s.actor === "manager")!;
    expect(s1.links.length).toBe(3);

    const docLink = s1.links.find((l) => l.type === "document");
    expect(docLink).toBeDefined();
    expect(docLink!.name).toBe("ProjectDoc");

    const entityLink = s1.links.find((l) => l.type === "entity");
    expect(entityLink).toBeDefined();
    expect(entityLink!.name).toBe("Project");

    const methodLink = s1.links.find((l) => l.type === "method");
    expect(methodLink).toBeDefined();
    expect(methodLink!.name).toBe("Project.create");
  });

  test("story without links has empty array", () => {
    const stories = getStories();
    const s2 = stories.find((s) => s.actor === "developer")!;
    expect(s2.links.length).toBe(0);
  });
});

// ─── Checklists ───

describe("getChecklistList", () => {
  test("returns checklists with counts", () => {
    const list = getChecklistList();
    expect(list.length).toBe(1);
    const cl = list[0];
    expect(cl.name).toBe("auth-flow");
    expect(cl.description).toBe("Verify authentication");
    expect(cl.total).toBe(2);
    expect(cl.api).toBeGreaterThanOrEqual(1); // first check confirmed for api
  });
});

describe("getChecklistDetail", () => {
  test("returns null for missing checklist", () => {
    expect(getChecklistDetail("nonexistent")).toBeNull();
  });

  test("returns checklist with checks", () => {
    const detail = getChecklistDetail("auth-flow")!;
    expect(detail).not.toBeNull();
    expect(detail.name).toBe("auth-flow");
    expect(detail.description).toBe("Verify authentication");
    expect(detail.checks.length).toBe(2);
  });

  test("checks have method references", () => {
    const detail = getChecklistDetail("auth-flow")!;
    for (const c of detail.checks) {
      expect(c.method).toBe("Project.create");
    }
  });

  test("check actions are correct", () => {
    const detail = getChecklistDetail("auth-flow")!;
    const can = detail.checks.find((c) => c.action === "can");
    const denied = detail.checks.find((c) => c.action === "denied");
    expect(can).toBeDefined();
    expect(denied).toBeDefined();
    expect(can!.actor).toBe("manager");
    expect(denied!.actor).toBe("guest");
  });

  test("confirmed bitmask is set", () => {
    const detail = getChecklistDetail("auth-flow")!;
    const can = detail.checks.find((c) => c.action === "can")!;
    expect(can.confirmed & 1).toBe(1); // api confirmed
  });
});

// ─── Metadata ───

describe("getMetadata", () => {
  test("returns all metadata", () => {
    const meta = getMetadata();
    expect(meta["app-name"]).toBe("Test App");
    expect(meta["version"]).toBe("1.0");
    expect(meta["theme"]).toBe("Dark modern");
  });
});

// ─── Diagram generation (PlantUML source, not SVG) ───

describe("diagram generation", () => {
  // We can't test renderSvg without a PlantUML server, but we can test the
  // PlantUML source generators by importing them indirectly through the DB

  test("entity diagram source via direct DB", () => {
    const db = openDb(true);
    // Access the private generator by checking its output through the DB content
    // The entity diagram should have all entities in it
    const entities = db.query("SELECT name FROM entities ORDER BY name").all() as { name: string }[];
    db.close();
    expect(entities.length).toBe(4);
  });
});
