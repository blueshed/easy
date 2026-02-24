import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "fs";
import { resolve } from "path";

const DB = resolve(import.meta.dir, "../test-cli.db");
const CLI = resolve(import.meta.dir, "cli.ts");

function run(...args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", CLI, ...args], {
    env: { ...process.env, MODEL_DB: DB },
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  };
}

function batch(lines: unknown[][]) {
  const input = lines.map((l) => JSON.stringify(l)).join("\n");
  const proc = Bun.spawnSync(["bun", CLI, "batch"], {
    env: { ...process.env, MODEL_DB: DB },
    stdin: Buffer.from(input),
  });
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  };
}

beforeAll(() => {
  try { unlinkSync(DB); } catch {}
});
afterAll(() => {
  try { unlinkSync(DB); } catch {}
});

// --- Save Entity ---

describe("save entity", () => {
  test("creates entity with fields", () => {
    const r = run("save", "entity", JSON.stringify({
      name: "User",
      fields: [
        { name: "id", type: "number" },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
      ],
    }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Saved entity");
  });

  test("creates entity without fields", () => {
    const r = run("save", "entity", JSON.stringify({ name: "Project" }));
    expect(r.exitCode).toBe(0);
  });

  test("coalesces new fields without removing old", () => {
    const r = run("save", "entity", JSON.stringify({
      name: "User",
      fields: [{ name: "avatar", type: "string" }],
    }));
    expect(r.exitCode).toBe(0);
    // List should show all 4 fields
    const list = run("list", "entity");
    expect(list.stdout).toContain("email");
    expect(list.stdout).toContain("avatar");
  });

  test("updates field type via coalesce", () => {
    const r = run("save", "field", JSON.stringify({
      entity: "User",
      name: "avatar",
      type: "json",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates entity with methods inline", () => {
    const r = run("save", "entity", JSON.stringify({
      name: "Task",
      fields: [
        { name: "id", type: "number" },
        { name: "title", type: "string" },
        { name: "project_id", type: "number" },
      ],
      methods: [
        {
          name: "saveTask",
          args: [{ name: "body", type: "json" }],
          return_type: "{id:number}",
          publishes: ["title"],
          permissions: ["@project_id->acts_for[org_id=$]{active}.user_id"],
        },
      ],
    }));
    expect(r.exitCode).toBe(0);
  });

  test("fails on unknown schema", () => {
    const r = run("save", "bogus", "{}");
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toContain("Unknown schema");
  });

  test("fails on bad JSON", () => {
    const r = run("save", "entity", "not-json");
    expect(r.exitCode).not.toBe(0);
  });
});

// --- Save Relation ---

describe("save relation", () => {
  test("creates relation", () => {
    const r = run("save", "relation", JSON.stringify({
      from: "User",
      to: "Project",
      label: "projects",
      cardinality: "*",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates has-many relation", () => {
    const r = run("save", "relation", JSON.stringify({
      from: "Project",
      to: "Task",
      label: "tasks",
      cardinality: "*",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("defaults to empty label and * cardinality", () => {
    const r = run("save", "relation", JSON.stringify({
      from: "Task",
      to: "User",
    }));
    expect(r.exitCode).toBe(0);
  });
});

// --- Save Story ---

describe("save story", () => {
  test("creates story", () => {
    const r = run("save", "story", JSON.stringify({
      actor: "manager",
      action: "create projects",
      description: "to organise work",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates story with links", () => {
    const r = run("save", "story", JSON.stringify({
      actor: "developer",
      action: "manage tasks",
      links: [
        { type: "entity", name: "Task" },
        { type: "method", name: "Task.saveTask" },
      ],
    }));
    expect(r.exitCode).toBe(0);
  });
});

// --- Save Document ---

describe("save document", () => {
  test("creates document with expansions", () => {
    const r = run("save", "document", JSON.stringify({
      name: "ProjectDoc",
      entity: "Project",
      expansions: [
        { name: "tasks", entity: "Task", foreign_key: "project_id" },
      ],
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates collection document", () => {
    const r = run("save", "document", JSON.stringify({
      name: "TaskList",
      entity: "Task",
      collection: true,
      public: true,
      description: "All tasks",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates document with nested expansions", () => {
    run("save", "entity", JSON.stringify({
      name: "Comment",
      fields: [
        { name: "id", type: "number" },
        { name: "body", type: "string" },
        { name: "task_id", type: "number" },
      ],
    }));
    run("save", "relation", JSON.stringify({ from: "Task", to: "Comment", label: "comments", cardinality: "*" }));

    const r = run("save", "document", JSON.stringify({
      name: "TaskDoc",
      entity: "Task",
      expansions: [
        {
          name: "comments",
          entity: "Comment",
          foreign_key: "task_id",
        },
        {
          name: "owner",
          entity: "User",
          foreign_key: "created_by",
          belongs_to: true,
        },
      ],
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates cursor document", () => {
    const r = run("save", "document", JSON.stringify({
      name: "CommentList",
      entity: "Comment",
      collection: true,
      fetch: "cursor",
    }));
    expect(r.exitCode).toBe(0);
  });
});

// --- Save Method ---

describe("save method", () => {
  test("creates standalone method", () => {
    const r = run("save", "method", JSON.stringify({
      entity: "Project",
      name: "saveProject",
      args: [{ name: "body", type: "json" }],
      return_type: "{id:number}",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates method with publishes shorthand", () => {
    const r = run("save", "method", JSON.stringify({
      entity: "Project",
      name: "rename",
      args: [{ name: "name", type: "string" }],
      publishes: ["name"],
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates pre-auth method", () => {
    const r = run("save", "method", JSON.stringify({
      entity: "User",
      name: "login",
      args: [{ name: "email", type: "string" }, { name: "password", type: "string" }],
      return_type: "{id:number,name:string,email:string}",
      auth_required: false,
    }));
    expect(r.exitCode).toBe(0);
  });

  test("creates method with notification", () => {
    const r = run("save", "method", JSON.stringify({
      entity: "Task",
      name: "assign",
      args: [{ name: "assignee_id", type: "number" }],
      notifications: [{ channel: "task-assigned", recipients: "assignee_id" }],
    }));
    expect(r.exitCode).toBe(0);
  });
});

// --- Save Publish/Permission standalone ---

describe("save publish", () => {
  test("creates publish", () => {
    const r = run("save", "publish", JSON.stringify({
      method: "Project.saveProject",
      property: "description",
    }));
    expect(r.exitCode).toBe(0);
  });
});

describe("save permission", () => {
  test("creates permission", () => {
    const r = run("save", "permission", JSON.stringify({
      method: "Project.saveProject",
      path: "@org_id->acts_for[org_id=$]{active}.user_id",
      description: "Active org member",
    }));
    expect(r.exitCode).toBe(0);
  });
});

// --- Save Checklist ---

describe("save checklist", () => {
  test("creates checklist with checks", () => {
    const r = run("save", "checklist", JSON.stringify({
      name: "Task Access",
      description: "Verify task permissions",
      checks: [
        { actor: "developer", method: "Task.saveTask", description: "Dev can save" },
        { actor: "outsider", method: "Task.saveTask", action: "denied", description: "Outsider blocked" },
      ],
    }));
    expect(r.exitCode).toBe(0);
  });
  test("adds check dependency by natural key", () => {
    const r = run("save", "check", JSON.stringify({
      checklist: "Task Access",
      actor: "outsider",
      method: "Task.saveTask",
      depends_on: [{ checklist: "Task Access", actor: "developer", method: "Task.saveTask" }],
    }));
    expect(r.exitCode).toBe(0);
    const g = run("get", "checklist", "Task Access");
    expect(g.stdout).toContain("depends_on");
  });
});

// --- Save Metadata ---

describe("save metadata", () => {
  test("creates metadata", () => {
    const r = run("save", "metadata", JSON.stringify({ key: "theme", value: "Dark navy" }));
    expect(r.exitCode).toBe(0);
  });

  test("updates metadata", () => {
    const r = run("save", "metadata", JSON.stringify({ key: "theme", value: "Light blue" }));
    expect(r.exitCode).toBe(0);
    const g = run("get", "metadata", "theme");
    expect(g.stdout.trim()).toBe("Light blue");
  });

  test("creates additional metadata", () => {
    const r = run("save", "metadata", JSON.stringify({ key: "app-name", value: "Test App" }));
    expect(r.exitCode).toBe(0);
  });
});

// --- Delete ---

describe("delete", () => {
  test("deletes field by natural key", () => {
    const r = run("delete", "field", JSON.stringify({ entity: "User", name: "avatar" }));
    expect(r.exitCode).toBe(0);
    const list = run("list", "entity");
    expect(list.stdout).not.toContain("avatar");
  });

  test("deletes relation", () => {
    const r = run("delete", "relation", JSON.stringify({ from: "Task", to: "User" }));
    expect(r.exitCode).toBe(0);
  });

  test("deletes metadata", () => {
    const r = run("delete", "metadata", JSON.stringify({ key: "app-name" }));
    expect(r.exitCode).toBe(0);
  });

  test("fails on unknown schema", () => {
    const r = run("delete", "bogus", "{}");
    expect(r.exitCode).not.toBe(0);
  });
});

// --- List ---

describe("list", () => {
  test("list with no args shows entities", () => {
    const r = run("list");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("User");
    expect(r.stdout).toContain("Project");
    expect(r.stdout).toContain("Task");
  });

  test("list entity shows entities with fields", () => {
    const r = run("list", "entity");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("User");
    expect(r.stdout).toContain("email: string");
  });

  test("list story shows stories", () => {
    const r = run("list", "story");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("manager");
    expect(r.stdout).toContain("create projects");
  });

  test("list document shows documents", () => {
    const r = run("list", "document");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ProjectDoc");
    expect(r.stdout).toContain("TaskList");
  });

  test("list checklist shows checklists", () => {
    const r = run("list", "checklist");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Task Access");
  });

  test("list relation shows relations", () => {
    const r = run("list", "relation");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("User");
  });

  test("list method shows methods", () => {
    const r = run("list", "method");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("saveTask");
  });

  test("list metadata shows metadata", () => {
    const r = run("list", "metadata");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("theme");
  });

  test("list unknown schema fails", () => {
    const r = run("list", "bogus");
    expect(r.exitCode).not.toBe(0);
  });
});

// --- Get ---

describe("get", () => {
  test("get entity returns JSON", () => {
    const r = run("get", "entity", "User");
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.name).toBe("User");
    expect(data.fields).toBeDefined();
    expect(data.methods).toBeDefined();
  });

  test("get document returns JSON", () => {
    const r = run("get", "document", "ProjectDoc");
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.name).toBe("ProjectDoc");
    expect(data.entity).toBe("Project");
  });

  test("get checklist returns JSON", () => {
    const r = run("get", "checklist", "Task Access");
    expect(r.exitCode).toBe(0);
    const data = JSON.parse(r.stdout);
    expect(data.name).toBe("Task Access");
    expect(data.checks.length).toBeGreaterThan(0);
  });

  test("get metadata returns value", () => {
    const r = run("get", "metadata", "theme");
    expect(r.exitCode).toBe(0);
    expect(r.stdout.trim()).toBe("Light blue");
  });

  test("get missing entity fails", () => {
    const r = run("get", "entity", "Bogus");
    expect(r.exitCode).not.toBe(0);
  });
});

// --- Batch ---

describe("batch", () => {
  test("processes saves and deletes", () => {
    const r = batch([
      ["save", "entity", { name: "BatchTest", fields: [{ name: "id", type: "number" }] }],
      ["save", "metadata", { key: "batch-key", value: "batch-value" }],
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("2 ok, 0 failed");

    // Verify
    const list = run("list", "entity");
    expect(list.stdout).toContain("BatchTest");

    // Clean up
    const r2 = batch([
      ["delete", "entity", { name: "BatchTest" }],
      ["delete", "metadata", { key: "batch-key" }],
    ]);
    expect(r2.stdout).toContain("2 ok, 0 failed");
  });

  test("reports failures", () => {
    const r = batch([
      ["save", "relation", { from: "NonExistent", to: "AlsoNot" }],
    ]);
    expect(r.stdout).toContain("0 ok, 1 failed");
  });
});

// --- Export ---

describe("export", () => {
  test("produces markdown with all sections", () => {
    const r = run("export");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# Application Spec");
    expect(r.stdout).toContain("## Entities");
    expect(r.stdout).toContain("## Stories");
    expect(r.stdout).toContain("## Relations");
    expect(r.stdout).toContain("## Documents");
    expect(r.stdout).toContain("## Checklists");
  });

  test("includes entity fields", () => {
    const r = run("export");
    expect(r.stdout).toContain("| email | string |");
  });

  test("includes methods with publishes", () => {
    const r = run("export");
    expect(r.stdout).toContain("saveTask");
    expect(r.stdout).toContain("publishes `title`");
  });

  test("includes document expansions", () => {
    const r = run("export");
    expect(r.stdout).toContain("ProjectDoc");
    expect(r.stdout).toContain("`tasks`");
  });

  test("includes metadata", () => {
    const r = run("export");
    expect(r.stdout).toContain("## Metadata");
    expect(r.stdout).toContain("theme");
  });
});

// --- Doctor ---

describe("doctor", () => {
  test("reports no orphans on clean db", () => {
    const r = run("doctor");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("No orphaned references found.");
  });
});

// --- Usage ---

describe("usage", () => {
  test("shows usage with no args", () => {
    const r = run();
    expect(r.stdout).toContain("Usage:");
    expect(r.stdout).toContain("save");
    expect(r.stdout).toContain("delete");
    expect(r.stdout).toContain("batch");
  });

  test("shows error for unknown command", () => {
    const r = run("bogus-command");
    expect(r.exitCode).not.toBe(0);
  });
});
