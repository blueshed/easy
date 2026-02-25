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
} from "./etl";
import homepage from "./index.html";

let cachedDiagrams: Record<string, string> | null = null;
let cachedMtime: number = 0;

// SSE support
const clients = new Set<ReadableStreamDefaultController<any>>();
function broadcastReload() {
  cachedDiagrams = null; // invalidate cache
  for (const client of clients) {
    try {
      client.enqueue("data: reload\n\n");
    } catch {
      clients.delete(client);
    }
  }
}

async function getDiagrams(): Promise<Record<string, string>> {
  const file = Bun.file(getDbPath());
  const mtime = (await file.exists()) ? (await file.stat()).mtimeMs : 0;
  if (cachedDiagrams && mtime === cachedMtime) return cachedDiagrams;
  cachedDiagrams = await etl();
  cachedMtime = mtime;
  return cachedDiagrams;
}

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "no-cache",
};

function svgResponse(svg: string) {
  return new Response(svg, { headers: SVG_HEADERS });
}

// SSE keepalive — send a comment every 30s so connections don't idle out
setInterval(() => {
  for (const client of clients) {
    try {
      client.enqueue(": keepalive\n\n");
    } catch {
      clients.delete(client);
    }
  }
}, 5_000);

const server = Bun.serve({
  port: 8080,
  idleTimeout: 255,
  routes: {
    "/": homepage,

    // --- List endpoints ---

    "/api/documents": () => {
      try { return Response.json(getDocumentList()); }
      catch { return Response.json([]); }
    },

    "/api/stories": () => {
      try { return Response.json(getStories()); }
      catch { return Response.json([]); }
    },

    "/api/entities": () => {
      try { return Response.json(getEntityList()); }
      catch { return Response.json([]); }
    },

    "/api/checklists": () => {
      try { return Response.json(getChecklistList()); }
      catch { return Response.json([]); }
    },

    "/api/metadata": () => {
      try { return Response.json(getMetadata()); }
      catch { return Response.json({}); }
    },

    "/api/reference": async () => {
      const file = Bun.file(import.meta.dir + "/../.claude/skills/model-app/reference.md");
      if (!(await file.exists())) return new Response("Not found", { status: 404 });
      return new Response(file, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
    },

    // --- Internal CLI webhook ---

    "/api/internal/reload": {
      async POST(req: Request) {
        broadcastReload();
        return new Response("ok");
      },
    },

    // --- SSE Endpoint ---

    "/api/events": (req) => {
      let ctrl: ReadableStreamDefaultController<any>;
      return new Response(
        new ReadableStream({
          start(controller) {
            ctrl = controller;
            clients.add(ctrl);
            req.signal.addEventListener("abort", () => {
              clients.delete(ctrl);
            });
          },
          cancel() {
            clients.delete(ctrl);
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }
      );
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

  fetch() {
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Easy model site at ${server.url}`);
