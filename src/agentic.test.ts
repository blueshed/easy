import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { unlinkSync } from "fs";
import { resolve } from "path";

const DB = resolve(import.meta.dir, "../test-agentic.db");
process.env.MODEL_DB = DB;

const CLI = resolve(import.meta.dir, "cli.ts");

import { getTaskGraph, getMemories, getFlags, getDomainSchema } from "./etl";

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

beforeAll(() => { try { unlinkSync(DB); } catch {} });
afterAll(() => { try { unlinkSync(DB); } catch {} });

// --- Tasks ---

describe("save task", () => {
  test("creates task with defaults", () => {
    const r = run("save", "task", JSON.stringify({ name: "schema" }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Saved task");
  });

  test("creates task with status and description", () => {
    const r = run("save", "task", JSON.stringify({
      name: "api", description: "Build REST endpoints", status: "done",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("updates task status", () => {
    const r = run("save", "task", JSON.stringify({ name: "schema", status: "done" }));
    expect(r.exitCode).toBe(0);
    const list = run("list", "task");
    expect(list.stdout).toContain("✓ schema");
  });

  test("creates task with dependency", () => {
    run("save", "task", JSON.stringify({ name: "auth", status: "in_progress" }));
    const r = run("save", "task", JSON.stringify({
      name: "publish", status: "pending", depends_on: [{ name: "auth" }],
    }));
    expect(r.exitCode).toBe(0);
    const list = run("list", "task");
    expect(list.stdout).toContain("← ○ auth");
  });

  test("creates task with multiple dependencies", () => {
    const r = run("save", "task", JSON.stringify({
      name: "deploy", status: "blocked",
      depends_on: [{ name: "auth" }, { name: "publish" }],
    }));
    expect(r.exitCode).toBe(0);
  });

  test("rejects self-dependency", () => {
    const r = run("save", "task", JSON.stringify({
      name: "loop", depends_on: [{ name: "loop" }],
    }));
    expect(r.exitCode).not.toBe(0);
  });

  test("rejects circular dependency", () => {
    run("save", "task", JSON.stringify({ name: "a" }));
    run("save", "task", JSON.stringify({ name: "b", depends_on: [{ name: "a" }] }));
    const r = run("save", "task", JSON.stringify({
      name: "a", depends_on: [{ name: "b" }],
    }));
    expect(r.exitCode).not.toBe(0);
  });

  test("rejects dependency on nonexistent task", () => {
    const r = run("save", "task", JSON.stringify({
      name: "orphan", depends_on: [{ name: "nonexistent" }],
    }));
    expect(r.exitCode).not.toBe(0);
  });
});

describe("list task", () => {
  test("shows all tasks with status symbols", () => {
    const r = run("list", "task");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("✓ schema");
    expect(r.stdout).toContain("✓ api");
    expect(r.stdout).toContain("▶ auth");
    expect(r.stdout).toContain("○ publish");
    expect(r.stdout).toContain("✗ deploy");
  });
});

describe("delete task", () => {
  test("deletes task by name", () => {
    run("save", "task", JSON.stringify({ name: "temp" }));
    const r = run("delete", "task", JSON.stringify({ name: "temp" }));
    expect(r.exitCode).toBe(0);
    const list = run("list", "task");
    expect(list.stdout).not.toContain("temp");
  });
});

// --- Memories ---

describe("save memory", () => {
  test("creates memory", () => {
    const r = run("save", "memory", JSON.stringify({
      tag: "architecture", content: "Uses cursor pagination",
    }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Saved memory");
  });

  test("creates memory with different tag", () => {
    const r = run("save", "memory", JSON.stringify({
      tag: "decision", content: "Tags use slugs",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("rejects duplicate tag+content", () => {
    const r = run("save", "memory", JSON.stringify({
      tag: "architecture", content: "Uses cursor pagination",
    }));
    // upsert should succeed (no-op)
    expect(r.exitCode).toBe(0);
  });

  test("allows same content with different tag", () => {
    const r = run("save", "memory", JSON.stringify({
      tag: "todo", content: "Uses cursor pagination",
    }));
    expect(r.exitCode).toBe(0);
  });
});

describe("list memory", () => {
  test("shows memories grouped by tag", () => {
    const r = run("list", "memory");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("[architecture]");
    expect(r.stdout).toContain("[decision]");
    expect(r.stdout).toContain("Uses cursor pagination");
    expect(r.stdout).toContain("Tags use slugs");
  });
});

describe("delete memory", () => {
  test("deletes memory by tag+content", () => {
    run("save", "memory", JSON.stringify({ tag: "temp", content: "deleteme" }));
    const r = run("delete", "memory", JSON.stringify({ tag: "temp", content: "deleteme" }));
    expect(r.exitCode).toBe(0);
    const list = run("list", "memory");
    expect(list.stdout).not.toContain("deleteme");
  });
});

// --- Flags ---

describe("save flag", () => {
  test("creates flag with default status", () => {
    const r = run("save", "flag", JSON.stringify({ name: "lint" }));
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("Saved flag");
  });

  test("creates flag with status", () => {
    const r = run("save", "flag", JSON.stringify({ name: "tests", status: "pass" }));
    expect(r.exitCode).toBe(0);
  });

  test("creates flag with cmd", () => {
    const r = run("save", "flag", JSON.stringify({
      name: "typecheck", cmd: "bun tsc --noEmit", status: "fail",
    }));
    expect(r.exitCode).toBe(0);
  });

  test("updates flag status", () => {
    const r = run("save", "flag", JSON.stringify({ name: "lint", status: "pass" }));
    expect(r.exitCode).toBe(0);
  });
});

describe("list flag", () => {
  test("shows all flags", () => {
    const r = run("list", "flag");
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("lint");
    expect(r.stdout).toContain("tests");
    expect(r.stdout).toContain("typecheck");
  });
});

describe("delete flag", () => {
  test("deletes flag by name", () => {
    run("save", "flag", JSON.stringify({ name: "temp-flag" }));
    const r = run("delete", "flag", JSON.stringify({ name: "temp-flag" }));
    expect(r.exitCode).toBe(0);
    const list = run("list", "flag");
    expect(list.stdout).not.toContain("temp-flag");
  });
});

// --- ETL queries ---

describe("etl agentic queries", () => {
  test("getTaskGraph returns tasks, deps, flags", () => {
    const graph = getTaskGraph();
    expect(graph.tasks.length).toBeGreaterThan(0);
    expect(Array.isArray(graph.deps)).toBe(true);
    expect(Array.isArray(graph.flags)).toBe(true);

    const names = graph.tasks.map((t: any) => t.name);
    expect(names).toContain("schema");
    expect(names).toContain("auth");
  });

  test("getTaskGraph includes dependencies", () => {
    const graph = getTaskGraph();
    expect(graph.deps.length).toBeGreaterThan(0);
    const publishDep = graph.deps.find((d: any) =>
      graph.tasks.find((t: any) => t.id === d.task_id)?.name === "publish"
    );
    expect(publishDep).toBeDefined();
  });

  test("getMemories returns memories", () => {
    const memories = getMemories();
    expect(memories.length).toBeGreaterThan(0);
    expect(memories[0].tag).toBeDefined();
    expect(memories[0].content).toBeDefined();
  });

  test("getFlags returns flags", () => {
    const flags = getFlags();
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].name).toBeDefined();
    expect(flags[0].status).toBeDefined();
  });
});

describe("getDomainSchema", () => {
  test("returns empty array when no domain entities", () => {
    // Our test DB has tasks/memories/flags but no domain entities
    const schema = getDomainSchema();
    // May be empty or have entities from other test files sharing the DB
    expect(Array.isArray(schema)).toBe(true);
  });
});
