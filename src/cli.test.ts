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
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
    exitCode: proc.exitCode,
  };
}

function batch(lines: string[][]): { stdout: string; stderr: string; exitCode: number } {
  const input = lines.map((l) => JSON.stringify(l)).join("\n");
  const proc = Bun.spawnSync(["bun", CLI, "batch"], {
    env: { ...process.env, MODEL_DB: DB },
    stdin: Buffer.from(input),
  });
  return {
    stdout: proc.stdout.toString().trim(),
    stderr: proc.stderr.toString().trim(),
    exitCode: proc.exitCode,
  };
}

beforeAll(() => {
  try { unlinkSync(DB); } catch {}
});

afterAll(() => {
  try { unlinkSync(DB); } catch {}
});

// ─── Entities ───

describe("entities", () => {
  test("add-entity", () => {
    const r = run("add-entity", "User");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Entity 'User' added.");
  });

  test("add-entity second", () => {
    const r = run("add-entity", "Project");
    expect(r.exitCode).toBe(0);
  });

  test("add-entity third", () => {
    const r = run("add-entity", "Task");
    expect(r.exitCode).toBe(0);
  });

  test("add-field", () => {
    const r = run("add-field", "User", "email", "string");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Field 'email: string'");
  });

  test("add-field default type", () => {
    const r = run("add-field", "User", "name");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("name: string");
  });

  test("add-field to Project", () => {
    run("add-field", "Project", "title", "string");
    const r = run("add-field", "Project", "owner_id", "number");
    expect(r.exitCode).toBe(0);
  });

  test("add-field to Task", () => {
    run("add-field", "Task", "project_id", "number");
    run("add-field", "Task", "assignee_id", "number");
    const r = run("add-field", "Task", "summary", "string");
    expect(r.exitCode).toBe(0);
  });

  test("add-relation", () => {
    const r = run("add-relation", "User", "Project", "owner", "1");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Relation 'User' -> 'Project' added.");
  });

  test("add-relation has-many", () => {
    const r = run("add-relation", "Project", "Task");
    expect(r.exitCode).toBe(0);
  });

  test("list shows entities and relations", () => {
    const r = run("list");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("User");
    expect(r.stdout).toContain("email: string");
    expect(r.stdout).toContain("Project");
    expect(r.stdout).toContain("Relations:");
  });

  test("add-field missing args fails", () => {
    const r = run("add-field", "User");
    expect(r.exitCode).not.toBe(0);
  });

  test("add-field unknown entity fails", () => {
    const r = run("add-field", "Bogus", "x");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Stories ───

describe("stories", () => {
  test("add-story", () => {
    const r = run("add-story", "manager", "create projects", "to organise work");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Story #");
    expect(r.stdout).toContain("As a manager, I can create projects");
  });

  test("add-story without description", () => {
    const r = run("add-story", "developer", "view tasks");
    expect(r.exitCode).toBe(0);
  });

  test("list-stories", () => {
    const r = run("list-stories");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("manager");
    expect(r.stdout).toContain("create projects");
  });

  test("add-story missing args fails", () => {
    const r = run("add-story", "actor");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Documents ───

describe("documents", () => {
  test("add-document", () => {
    const r = run("add-document", "ProjectDoc", "Project");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Document 'ProjectDoc' -> 'Project'");
  });

  test("add-document with flags", () => {
    const r = run("add-document", "TaskList", "Task", "--collection", "--public", "--description", "All tasks");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("collection");
    expect(r.stdout).toContain("public");
  });

  test("add-document with cursor", () => {
    const r = run("add-document", "UserProfile", "User", "--cursor");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("cursor");
  });

  test("list-documents", () => {
    const r = run("list-documents");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("ProjectDoc");
    expect(r.stdout).toContain("TaskList");
  });

  test("add-document missing entity fails", () => {
    const r = run("add-document", "Broken");
    expect(r.exitCode).not.toBe(0);
  });

  test("add-document unknown entity fails", () => {
    const r = run("add-document", "Broken", "Nope");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Expansions ───

describe("expansions", () => {
  test("add-expansion", () => {
    const r = run("add-expansion", "ProjectDoc", "tasks", "Task", "project_id");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Expansion 'tasks' -> 'Task'");
  });

  test("add-expansion with belongs-to", () => {
    const r = run("add-expansion", "ProjectDoc", "owner", "User", "owner_id", "--belongs-to");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("belongs-to");
  });

  test("add-expansion nested", () => {
    const r = run("add-expansion", "ProjectDoc", "assignee", "User", "assignee_id", "--shallow", "--parent", "tasks");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("nested under 'tasks'");
    expect(r.stdout).toContain("shallow");
  });

  test("list-documents shows expansions", () => {
    const r = run("list-documents");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("tasks -> Task via project_id");
    expect(r.stdout).toContain("owner -> User via owner_id");
  });

  test("add-expansion missing args fails", () => {
    const r = run("add-expansion", "ProjectDoc", "x");
    expect(r.exitCode).not.toBe(0);
  });

  test("add-expansion bad parent fails", () => {
    const r = run("add-expansion", "ProjectDoc", "x", "User", "fk", "--parent", "nonexistent");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Methods ───

describe("methods", () => {
  test("add-method", () => {
    const r = run("add-method", "Project", "create", '[{"name":"title","type":"string"}]', "Project");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Method 'Project.create");
  });

  test("add-method with permission", () => {
    const r = run("add-method", "Task", "assign", '[{"name":"user_id","type":"number"}]', "boolean", "--permission", "project_id.owner_id");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Method 'Task.assign");
    expect(r.stdout).toContain("Permission 'project_id.owner_id' added.");
  });

  test("add-method no-auth", () => {
    const r = run("add-method", "User", "register", '[{"name":"email","type":"string"}]', "User", "--no-auth");
    expect(r.exitCode).toBe(0);
  });

  test("add-method defaults", () => {
    const r = run("add-method", "Project", "archive");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("([])");
    expect(r.stdout).toContain("-> boolean");
  });

  test("list shows methods", () => {
    const r = run("list");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("create(");
    expect(r.stdout).toContain("assign(");
  });

  test("add-method missing name fails", () => {
    const r = run("add-method", "User");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Publishes ───

describe("publishes", () => {
  test("add-publish", () => {
    const r = run("add-publish", "Project.create", "title");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Publish 'title' added");
  });

  test("add-publish second", () => {
    const r = run("add-publish", "Project.create", "owner_id");
    expect(r.exitCode).toBe(0);
  });

  test("add-publish missing args fails", () => {
    const r = run("add-publish", "Project.create");
    expect(r.exitCode).not.toBe(0);
  });

  test("add-publish bad method fails", () => {
    const r = run("add-publish", "Bogus.nope", "x");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Notifications ───

describe("notifications", () => {
  test("add-notification", () => {
    const r = run("add-notification", "Task.assign", "task-assigned", "assignee_id", '{"task_id":"number"}');
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Notification 'task-assigned'");
  });

  test("add-notification missing args fails", () => {
    const r = run("add-notification", "Task.assign");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Permissions ───

describe("permissions", () => {
  test("add-permission", () => {
    const r = run("add-permission", "Project.create", "id", "must be project owner");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Permission path added");
    expect(r.stdout).toContain("must be project owner");
  });

  test("add-permission missing args fails", () => {
    const r = run("add-permission", "Project.create");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Story Links ───

describe("story-links", () => {
  test("link-story to document", () => {
    // Story #1 exists from earlier
    const r = run("link-story", "1", "document", "ProjectDoc");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("linked to document");
  });

  test("link-story to entity", () => {
    const r = run("link-story", "1", "entity", "Project");
    expect(r.exitCode).toBe(0);
  });

  test("link-story to method", () => {
    const r = run("link-story", "1", "method", "Project.create");
    expect(r.exitCode).toBe(0);
  });

  test("list-stories shows links", () => {
    const r = run("list-stories");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("-> document:");
    expect(r.stdout).toContain("-> entity:");
  });

  test("link-story bad story fails", () => {
    const r = run("link-story", "999", "entity", "User");
    expect(r.exitCode).not.toBe(0);
  });

  test("link-story bad target type fails", () => {
    const r = run("link-story", "1", "bogus", "x");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Metadata ───

describe("metadata", () => {
  test("set-meta", () => {
    const r = run("set-meta", "app-name", "Test App");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("app-name: Test App");
  });

  test("get-meta specific key", () => {
    const r = run("get-meta", "app-name");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Test App");
  });

  test("get-meta all", () => {
    run("set-meta", "version", "1.0");
    const r = run("get-meta");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("app-name:");
    expect(r.stdout).toContain("version:");
  });

  test("get-meta missing key", () => {
    const r = run("get-meta", "nope");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("(no value");
  });

  test("set-theme / get-theme", () => {
    run("set-theme", "Dark modern dashboard");
    const r = run("get-theme");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Dark modern dashboard");
  });

  test("clear-theme", () => {
    run("clear-theme");
    const r = run("get-theme");
    expect(r.stdout).toContain("(no theme set)");
  });

  test("clear-meta", () => {
    run("clear-meta", "version");
    const r = run("get-meta", "version");
    expect(r.stdout).toContain("(no value");
  });
});

// ─── Checklists ───

describe("checklists", () => {
  test("add-checklist", () => {
    const r = run("add-checklist", "auth-flow", "Verify authentication works");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Checklist 'auth-flow' added");
  });

  test("add-check", () => {
    const r = run("add-check", "auth-flow", "manager", "Project.create", "manager can create");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Check #");
    expect(r.stdout).toContain("manager can Project.create");
  });

  test("add-check denied", () => {
    const r = run("add-check", "auth-flow", "guest", "Project.create", "guest cannot create", "--denied");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("denied");
  });

  test("add-check with after", () => {
    // Get check IDs from list output — the first check should be around id 1
    const list = run("list-checks", "auth-flow");
    // Extract first check ID
    const match = list.stdout.match(/#(\d+)/);
    const firstId = match ? match[1] : "1";

    const r = run("add-check", "auth-flow", "developer", "Task.assign", "dev can assign", "--after", firstId);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("depends on");
  });

  test("confirm-check api", () => {
    const list = run("list-checks", "auth-flow");
    const match = list.stdout.match(/#(\d+)/);
    const id = match ? match[1] : "1";

    const r = run("confirm-check", id, "--api");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("confirmed (api)");
  });

  test("confirm-check ux", () => {
    const list = run("list-checks", "auth-flow");
    const match = list.stdout.match(/#(\d+)/);
    const id = match ? match[1] : "1";

    const r = run("confirm-check", id, "--ux");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("confirmed (ux)");
  });

  test("unconfirm-check", () => {
    const list = run("list-checks", "auth-flow");
    const match = list.stdout.match(/#(\d+)/);
    const id = match ? match[1] : "1";

    const r = run("unconfirm-check", id, "--api");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("unconfirmed");
  });

  test("list-checks", () => {
    const r = run("list-checks");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("auth-flow");
    expect(r.stdout).toContain("manager");
  });

  test("list-checks filtered", () => {
    const r = run("list-checks", "auth-flow");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("auth-flow");
  });

  test("list-checks missing checklist", () => {
    const r = run("list-checks", "nonexistent");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("not found");
  });

  test("add-check missing args fails", () => {
    const r = run("add-check", "auth-flow", "actor");
    expect(r.exitCode).not.toBe(0);
  });

  test("confirm-check missing flag fails", () => {
    const r = run("confirm-check", "1");
    expect(r.exitCode).not.toBe(0);
  });
});

// ─── Export Spec ───

describe("export-spec", () => {
  test("produces markdown", () => {
    const r = run("export-spec");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("# Application Spec");
  });

  test("includes metadata", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("## Metadata");
    expect(r.stdout).toContain("app-name");
  });

  test("includes stories", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("## Stories");
    expect(r.stdout).toContain("manager");
  });

  test("includes entities with fields", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("## Entities");
    expect(r.stdout).toContain("### User");
    expect(r.stdout).toContain("| email | string |");
  });

  test("includes methods and publishes", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("**Methods:**");
    expect(r.stdout).toContain("publishes `title`");
  });

  test("includes relations", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("## Relations");
    expect(r.stdout).toContain("User");
    expect(r.stdout).toContain("Project");
  });

  test("includes documents with expansions", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("## Documents");
    expect(r.stdout).toContain("### ProjectDoc");
    expect(r.stdout).toContain("**Expansions:**");
  });

  test("includes changes", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("**Changes:**");
  });

  test("includes checklists", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("## Checklists");
    expect(r.stdout).toContain("auth-flow");
  });

  test("includes notifications", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("notifies `task-assigned`");
  });

  test("includes permission paths", () => {
    const r = run("export-spec");
    expect(r.stdout).toContain("permission:");
  });
});

// ─── Batch Mode ───

describe("batch", () => {
  test("processes multiple commands", () => {
    const r = batch([
      ["add-entity", "Comment"],
      ["add-field", "Comment", "body", "string"],
      ["add-field", "Comment", "task_id", "number"],
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Entity 'Comment' added.");
    expect(r.stdout).toContain("Batch: 3 ok, 0 failed, 3 total");
  });

  test("reports failures", () => {
    const r = batch([
      ["add-field", "Nonexistent", "x", "string"],
      ["add-entity", "BatchTest"],
    ]);
    expect(r.stdout).toContain("1 ok, 1 failed, 2 total");
  });
});

// ─── Remove operations ───

describe("remove operations", () => {
  test("remove-publish", () => {
    const r = run("remove-publish", "Project.create", "owner_id");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-notification", () => {
    const r = run("remove-notification", "Task.assign", "task-assigned");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-expansion", () => {
    const r = run("remove-expansion", "ProjectDoc", "assignee");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-method", () => {
    const r = run("remove-method", "Project", "archive");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-field", () => {
    const r = run("remove-field", "Comment", "task_id");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-relation", () => {
    const r = run("remove-relation", "User", "Project", "owner");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Relation removed");
  });

  test("unlink-story", () => {
    const r = run("unlink-story", "1", "entity", "Project");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("unlinked");
  });

  test("remove-story", () => {
    const r = run("remove-story", "2");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-checklist", () => {
    const r = run("remove-checklist", "auth-flow");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-document", () => {
    const r = run("remove-document", "UserProfile");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-entity cascades", () => {
    const r = run("remove-entity", "Comment");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("removed");
  });

  test("remove-entity BatchTest", () => {
    const r = run("remove-entity", "BatchTest");
    expect(r.exitCode).toBe(0);
  });
});

// ─── Edge cases ───

describe("edge cases", () => {
  test("unknown command fails", () => {
    const r = run("bogus-command");
    expect(r.exitCode).not.toBe(0);
  });

  test("no command shows usage", () => {
    const r = run();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Usage:");
  });

  test("empty list", () => {
    // After cleanup, some entities remain (User, Project, Task)
    const r = run("list");
    expect(r.exitCode).toBe(0);
  });
});
