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
import { REFERENCE } from "./reference";
import homepage from "./index.html";

let cachedDiagrams: Record<string, string> | null = null;
let cachedMtime: number = 0;

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

const server = Bun.serve({
  port: 8080,
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

    "/api/reference": () => Response.json(REFERENCE),

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
