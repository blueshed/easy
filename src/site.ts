import { Database } from "bun:sqlite";
import { getDbPath } from "./db";
import {
  etl,
  documentDiagram,
  entityDiagram,
  getStories,
  getDocumentList,
  getDocumentDetail,
  getEntityList,
  getEntityDetail,
  getChecklistList,
  getChecklistDetail,
  getMetadata,
  getTaskGraph,
  getMemories,
  getFlags,
  getDomainSchema,
} from "./etl";
import homepage from "./client/index.html";

let cachedDiagrams: Record<string, string> | null = null;
let cachedMtime: number = 0;
let diagramPromise: Promise<Record<string, string>> | null = null;

// WebSocket support
const clients = new Set<any>();

function broadcastChange(schema: string, op: string) {
  cachedDiagrams = null;
  diagramPromise = null;
  const msg = JSON.stringify({ type: "change", schema, op });
  for (const ws of clients) {
    try { ws.send(msg); } catch { clients.delete(ws); }
  }
}

async function getDiagrams(): Promise<Record<string, string>> {
  const file = Bun.file(getDbPath());
  const mtime = (await file.exists()) ? (await file.stat()).mtimeMs : 0;
  if (cachedDiagrams && mtime === cachedMtime) return cachedDiagrams;
  if (!diagramPromise) {
    diagramPromise = etl().then((result) => {
      cachedDiagrams = result;
      cachedMtime = mtime;
      diagramPromise = null;
      return result;
    }).catch((err) => {
      diagramPromise = null;
      throw err;
    });
  }
  return diagramPromise;
}

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "no-cache",
};

function svgResponse(svg: string) {
  return new Response(svg, { headers: SVG_HEADERS });
}

function readSchema() {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { readonly: true });
  try {
    db.exec("PRAGMA foreign_keys = ON");
    // Exclude internal tables (migrations) and agentic dev tables (tasks, task_deps, memories, flags)
    const DEV_TABLES = new Set(["migrations", "tasks", "task_deps", "memories", "flags"]);
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all() as { name: string }[]).filter((t) => !DEV_TABLES.has(t.name));
    return tables.map((t) => ({
      table: t.name,
      columns: db.prepare(`PRAGMA table_info("${t.name.replace(/"/g, '""')}")`).all(),
      foreignKeys: db.prepare(`PRAGMA foreign_key_list("${t.name.replace(/"/g, '""')}")`).all(),
    }));
  } finally {
    db.close();
  }
}

const PORT = Number(process.env.PORT ?? 8080);

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255,
  routes: {
    "/": homepage,

    // --- List endpoints ---

    "/api/documents": () => {
      try { return Response.json(getDocumentList()); }
      catch (e) { console.error("GET /api/documents failed:", e); return Response.json([]); }
    },

    "/api/stories": () => {
      try { return Response.json(getStories()); }
      catch (e) { console.error("GET /api/stories failed:", e); return Response.json([]); }
    },

    "/api/entities": () => {
      try { return Response.json(getEntityList()); }
      catch (e) { console.error("GET /api/entities failed:", e); return Response.json([]); }
    },

    "/api/checklists": () => {
      try { return Response.json(getChecklistList()); }
      catch (e) { console.error("GET /api/checklists failed:", e); return Response.json([]); }
    },

    "/api/metadata": () => {
      try { return Response.json(getMetadata()); }
      catch (e) { console.error("GET /api/metadata failed:", e); return Response.json({}); }
    },

    "/api/tasks": () => {
      try { return Response.json(getTaskGraph()); }
      catch (e) { console.error("GET /api/tasks failed:", e); return Response.json({ tasks: [], deps: [], flags: [] }); }
    },

    "/api/memories": () => {
      try { return Response.json(getMemories()); }
      catch (e) { console.error("GET /api/memories failed:", e); return Response.json([]); }
    },

    "/api/flags": () => {
      try { return Response.json(getFlags()); }
      catch (e) { console.error("GET /api/flags failed:", e); return Response.json([]); }
    },

    "/api/schema": () => {
      try { return Response.json(readSchema()); }
      catch (e) { console.error("GET /api/schema failed:", e); return Response.json([]); }
    },

    "/api/domain-schema": () => {
      try { return Response.json(getDomainSchema()); }
      catch (e) { console.error("GET /api/domain-schema failed:", e); return Response.json([]); }
    },

    "/api/reference": async () => {
      const file = Bun.file(import.meta.dir + "/../.claude/skills/model-app/reference.md");
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    },

    "/api/ai": async () => {
      const skillFile = Bun.file(import.meta.dir + "/../.claude/skills/model-app/SKILL.md");
      const refFile = Bun.file(import.meta.dir + "/../.claude/skills/model-app/reference.md");
      if (!(await skillFile.exists()) || !(await refFile.exists())) return new Response("Not found", { status: 404 });
      let skill = await skillFile.text();
      const ref = await refFile.text();
      skill = skill.replace(/^---\n[\s\S]*?\n---\n*/, "");
      return new Response(skill + "\n---\n\n" + ref, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    },

    // --- Internal CLI webhook ---

    "/api/internal/reload": {
      async POST(req: Request) {
        let schema = "*", op = "reload";
        try {
          const body = await req.json() as { schema?: string; op?: string };
          if (body.schema) schema = body.schema;
          if (body.op) op = body.op;
        } catch {}
        broadcastChange(schema, op);
        return new Response("ok");
      },
    },

    // --- Detail endpoints ---

    "/api/documents/:name": (req) => {
      try {
        const detail = getDocumentDetail(req.params.name);
        if (!detail) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(detail);
      } catch {
        return Response.json({ error: "no database" }, { status: 500 });
      }
    },

    "/api/entities/:name": (req) => {
      try {
        const detail = getEntityDetail(req.params.name);
        if (!detail) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(detail);
      } catch {
        return Response.json({ error: "no database" }, { status: 500 });
      }
    },

    "/api/checklists/:name": (req) => {
      try {
        const detail = getChecklistDetail(req.params.name);
        if (!detail) return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(detail);
      } catch {
        return Response.json({ error: "no database" }, { status: 500 });
      }
    },

    // --- Overview diagrams ---

    "/diagram/entities.svg": async () => svgResponse((await getDiagrams()).entities),
    "/diagram/usecases.svg": async () => svgResponse((await getDiagrams()).usecases),
    "/diagram/documents.svg": async () => svgResponse((await getDiagrams()).documents),

    // --- Per-item diagrams ---

    "/diagram/doc/:name": async (req) => {
      const name = req.params.name.replace(/\.svg$/, "");
      return svgResponse(await documentDiagram(decodeURIComponent(name)));
    },

    "/diagram/entity/:name": async (req) => {
      const name = req.params.name.replace(/\.svg$/, "");
      return svgResponse(await entityDiagram(decodeURIComponent(name)));
    },
  },

  websocket: {
    open(ws) {
      clients.add(ws);
    },
    message(ws, msg) {
      // clients don't send messages yet — reserved for future use
    },
    close(ws) {
      clients.delete(ws);
    },
  },

  fetch(req) {
    // WebSocket upgrade
    if (new URL(req.url).pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Easy model site at ${server.url}`);
