import { openDb } from "./db";
import { SCHEMAS } from "./schemas";
import { save, del } from "./save";
import { list, get, exportSpec, doctor } from "./query";

const db = openDb();
const [cmd, ...rawArgs] = process.argv.slice(2);

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | true> } {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) { flags[key] = next; i++; }
      else flags[key] = true;
    } else {
      positional.push(args[i]);
    }
  }
  return { positional, flags };
}

function dispatch(command: string, args: string[]): void {
  switch (command) {
    case "save": {
      const [schemaName, jsonStr] = args;
      if (!schemaName || !jsonStr) {
        console.error("Usage: bun model save <schema> <json>");
        throw new Error("fail");
      }
      if (!SCHEMAS[schemaName] || schemaName.startsWith("_")) {
        console.error(`Unknown schema '${schemaName}'. Known: ${publicSchemas().join(", ")}`);
        throw new Error("fail");
      }
      const obj = JSON.parse(jsonStr);
      const id = save(db, schemaName, obj);
      console.log(`Saved ${schemaName} (id: ${id})`);
      break;
    }

    case "delete": {
      const [schemaName, jsonStr] = args;
      if (!schemaName || !jsonStr) {
        console.error("Usage: bun model delete <schema> <json>");
        throw new Error("fail");
      }
      if (!SCHEMAS[schemaName] || schemaName.startsWith("_")) {
        console.error(`Unknown schema '${schemaName}'. Known: ${publicSchemas().join(", ")}`);
        throw new Error("fail");
      }
      const obj = JSON.parse(jsonStr);
      del(db, schemaName, obj);
      console.log(`Deleted ${schemaName}`);
      break;
    }

    case "batch": {
      // handled at entry point (needs async stdin)
      break;
    }

    case "list": {
      const schema = args[0];
      list(db, schema);
      break;
    }

    case "get": {
      const [schemaName, key] = args;
      if (!schemaName || !key) {
        console.error("Usage: bun model get <schema> <key>");
        throw new Error("fail");
      }
      get(db, schemaName, key);
      break;
    }

    case "export": {
      exportSpec(db);
      break;
    }

    case "doctor": {
      const { flags } = parseFlags(args);
      doctor(db, !!flags.fix);
      break;
    }

    default:
      console.error(cmd ? `Unknown command: ${command}` : "");
      usage();
      throw new Error("fail");
  }
}

function publicSchemas(): string[] {
  return Object.keys(SCHEMAS).filter(k => !k.startsWith("_"));
}

function usage() {
  const schemas = publicSchemas().join(", ");
  console.log(`Usage:
  Mutations:
    bun model save <schema> <json>       Upsert by natural key (coalescing)
    bun model delete <schema> <json>     Remove by natural key

  Queries:
    bun model list [schema]              List all, or items of a schema type
    bun model get <schema> <key>         Get one item as JSON
    bun model export                     Markdown spec to stdout
    bun model doctor [--fix]             Report/repair orphaned references

  Batch:
    bun model batch                      JSONL from stdin: ["save","entity",{...}]

  Schemas: ${schemas}`);
}

// --- Entry point ---

if (cmd === "batch") {
  const input = await Bun.stdin.text();
  const lines = input.trim().split("\n").filter(Boolean);
  let ok = 0, fail = 0;
  for (const line of lines) {
    try {
      const arr = JSON.parse(line) as [string, string, unknown];
      const [command, schemaName, obj] = arr;
      if (command === "save") {
        save(db, schemaName, obj as Record<string, unknown>);
      } else if (command === "delete") {
        del(db, schemaName, obj as Record<string, unknown>);
      } else {
        throw new Error(`Batch only supports save/delete, got '${command}'`);
      }
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
