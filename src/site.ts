import { DB_PATH } from "./db";
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
} from "./etl";
import homepage from "./index.html";

let cachedDiagrams: Record<string, string> | null = null;
let cachedMtime: number = 0;

async function getDiagrams(): Promise<Record<string, string>> {
  const file = Bun.file(DB_PATH);
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

const server = Bun.serve({
  port: 8080,
  routes: {
    "/": homepage,

    "/api/documents": () => {
      try {
        return Response.json(getDocumentList());
      } catch {
        return Response.json([]);
      }
    },

    "/api/stories": () => {
      try {
        return Response.json(getStories());
      } catch {
        return Response.json([]);
      }
    },

    "/api/entities": () => {
      try {
        return Response.json(getEntityList());
      } catch {
        return Response.json([]);
      }
    },

    "/api/checklists": () => {
      try {
        return Response.json(getChecklistList());
      } catch {
        return Response.json([]);
      }
    },

    "/diagram/entities.svg": async () => {
      const d = await getDiagrams();
      return new Response(d.entities, { headers: SVG_HEADERS });
    },
    "/diagram/usecases.svg": async () => {
      const d = await getDiagrams();
      return new Response(d.usecases, { headers: SVG_HEADERS });
    },
    "/diagram/documents.svg": async () => {
      const d = await getDiagrams();
      return new Response(d.documents, { headers: SVG_HEADERS });
    },
  },

  fetch(req) {
    const url = new URL(req.url);

    // /api/documents/:name
    const apiMatch = url.pathname.match(/^\/api\/documents\/(.+)$/);
    if (apiMatch) {
      try {
        const detail = getDocumentDetail(decodeURIComponent(apiMatch[1]));
        if (!detail)
          return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(detail);
      } catch {
        return Response.json({ error: "no database" }, { status: 500 });
      }
    }

    // /api/checklists/:name
    const checklistApiMatch = url.pathname.match(/^\/api\/checklists\/(.+)$/);
    if (checklistApiMatch) {
      try {
        const detail = getChecklistDetail(decodeURIComponent(checklistApiMatch[1]));
        if (!detail)
          return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(detail);
      } catch {
        return Response.json({ error: "no database" }, { status: 500 });
      }
    }

    // /api/entities/:name
    const entityApiMatch = url.pathname.match(/^\/api\/entities\/(.+)$/);
    if (entityApiMatch) {
      try {
        const detail = getEntityDetail(decodeURIComponent(entityApiMatch[1]));
        if (!detail)
          return Response.json({ error: "not found" }, { status: 404 });
        return Response.json(detail);
      } catch {
        return Response.json({ error: "no database" }, { status: 500 });
      }
    }

    // /diagram/doc/:name.svg
    const svgMatch = url.pathname.match(/^\/diagram\/doc\/(.+)\.svg$/);
    if (svgMatch) {
      return documentDiagram(decodeURIComponent(svgMatch[1])).then(
        (svg) => new Response(svg, { headers: SVG_HEADERS }),
      );
    }

    // /diagram/entity/:name.svg
    const entitySvgMatch = url.pathname.match(/^\/diagram\/entity\/(.+)\.svg$/);
    if (entitySvgMatch) {
      return entityDiagram(decodeURIComponent(entitySvgMatch[1])).then(
        (svg) => new Response(svg, { headers: SVG_HEADERS }),
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Easy model site at ${server.url}`);
