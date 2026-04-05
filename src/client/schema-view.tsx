import { viewport, type ViewportControls } from "./viewport";
import { defIcon, useIcon } from "./icon";

type Column = { cid: number; name: string; type: string; notnull: number; dflt_value: string | null; pk: number };
type FK = { id: number; seq: number; table: string; from: string; to: string };
type Table = { table: string; columns: Column[]; foreignKeys: FK[] };

const TABLE_W = 220;
const PAD = 48;
const ROW_H = 22;
const HEADER_H = 32;
const GAP_X = 100;
const GAP_Y = 36;
const NS = "http://www.w3.org/2000/svg";
const KEY_ICON = "icon-key";
const FONT = "ui-monospace, SFMono-Regular, monospace";

type SchemaTheme = {
  tableFill: string; tableStroke: string; tableHeader: string;
  colText: string; typeText: string; pk: string;
  edge: string; edgeDot: string; grid: string;
  primaryFill: string; primaryStroke: string;
};

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function schemaTheme(): SchemaTheme {
  return {
    tableFill: css("--schema-table-fill"), tableStroke: css("--schema-table-stroke"),
    tableHeader: css("--schema-table-header"), colText: css("--schema-col-text"),
    typeText: css("--schema-type-text"), pk: css("--schema-pk"),
    edge: css("--schema-edge"), edgeDot: css("--schema-edge-dot"),
    grid: css("--schema-grid"),
    primaryFill: css("--schema-primary-fill"), primaryStroke: css("--schema-primary-stroke"),
  };
}

function el(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) {
    if (typeof c === "string") e.textContent = c;
    else e.appendChild(c);
  }
  return e;
}

function tableHeight(t: Table): number {
  return HEADER_H + t.columns.length * ROW_H + 10;
}

function isPrimary(table: string, allTables: Table[]): boolean {
  return allTables.some((t) => t.table !== table && t.foreignKeys.some((fk) => fk.table === table));
}

function layoutTables(tables: Table[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const refs = new Map<string, Set<string>>();
  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      if (!refs.has(t.table)) refs.set(t.table, new Set());
      refs.get(t.table)!.add(fk.table);
    }
  }

  const layers = new Map<string, number>();
  function layer(name: string, visited: Set<string>): number {
    if (layers.has(name)) return layers.get(name)!;
    if (visited.has(name)) return 0;
    visited.add(name);
    const targets = refs.get(name);
    const d = targets?.size ? Math.max(...[...targets].map((r) => layer(r, visited))) + 1 : 0;
    layers.set(name, d);
    return d;
  }
  for (const t of tables) layer(t.table, new Set());

  const byLayer = new Map<number, Table[]>();
  for (const t of tables) {
    const l = layers.get(t.table) ?? 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(t);
  }

  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const group = byLayer.get(l)!;
    let y = PAD;
    for (const t of group) {
      positions.set(t.table, { x: PAD + l * (TABLE_W + GAP_X), y });
      y += tableHeight(t) + GAP_Y;
    }
  }
  return positions;
}

function renderTable(t: Table, x: number, y: number, th: SchemaTheme, primary: boolean): SVGElement {
  const h = tableHeight(t);
  const g = el("g", { transform: `translate(${x},${y})` });

  g.appendChild(el("rect", {
    width: TABLE_W, height: h, rx: 6, x: 1, y: 2,
    fill: "black", "fill-opacity": primary ? 0.15 : 0.08,
    filter: "blur(4px)",
  }));

  g.appendChild(el("rect", {
    width: TABLE_W, height: h, rx: 6,
    fill: primary ? th.primaryFill : th.tableFill,
    stroke: primary ? th.primaryStroke : th.tableStroke,
    "stroke-width": primary ? 1 : 0.5,
  }));

  g.appendChild(el("text", {
    x: 12, y: 21,
    fill: primary ? th.pk : th.tableHeader,
    "font-size": 12, "font-weight": 600,
  }, t.table));

  g.appendChild(el("line", {
    x1: 0, y1: HEADER_H, x2: TABLE_W, y2: HEADER_H,
    stroke: primary ? th.primaryStroke : th.tableStroke, "stroke-opacity": 0.3,
  }));

  for (let i = 0; i < t.columns.length; i++) {
    const col = t.columns[i]!;
    const cy = HEADER_H + 17 + i * ROW_H;

    if (col.pk) {
      g.appendChild(useIcon(KEY_ICON, 8, cy - 11, 12, { color: th.pk }));
    }

    g.appendChild(el("text", {
      x: col.pk ? 24 : 12, y: cy,
      fill: col.pk ? th.pk : th.colText,
      "font-size": 11, "font-weight": col.pk ? 500 : 400,
    }, col.name));

    g.appendChild(el("text", {
      x: TABLE_W - 10, y: cy,
      fill: th.typeText,
      "font-size": 10, "text-anchor": "end",
    }, col.type.toLowerCase() || "any"));
  }

  return g;
}

function renderEdges(svgEl: SVGSVGElement, tables: Table[], positions: Map<string, { x: number; y: number }>, th: SchemaTheme) {
  const tableMap = new Map(tables.map((t) => [t.table, t]));

  for (const t of tables) {
    for (const fk of t.foreignKeys) {
      const from = positions.get(t.table);
      const to = positions.get(fk.table);
      if (!from || !to) continue;

      const fromCol = t.columns.findIndex((c) => c.name === fk.from);
      const toTable = tableMap.get(fk.table);
      const toCol = toTable?.columns.findIndex((c) => c.name === fk.to) ?? 0;

      const fromY = from.y + HEADER_H + 13 + fromCol * ROW_H;
      const toY = to.y + HEADER_H + 13 + toCol * ROW_H;

      let x1: number, x2: number;
      if (from.x > to.x) {
        x1 = from.x;
        x2 = to.x + TABLE_W;
      } else {
        x1 = from.x + TABLE_W;
        x2 = to.x;
      }

      const dx = (x2 - x1) * 0.4;
      svgEl.appendChild(el("path", {
        d: `M${x1},${fromY} C${x1 + dx},${fromY} ${x2 - dx},${toY} ${x2},${toY}`,
        fill: "none", stroke: th.edge, "stroke-width": 1, "stroke-dasharray": "4 4",
      }));

      svgEl.appendChild(el("circle", { cx: x2, cy: toY, r: 3, fill: th.edgeDot }));

      const midX = (x1 + x2) / 2;
      const midY = (fromY + toY) / 2 - 6;
      svgEl.appendChild(el("text", {
        x: midX, y: midY, fill: th.typeText,
        "font-size": 9, "text-anchor": "middle",
      }, `${fk.from} \u2192 ${fk.to}`));
    }
  }
}

export function SchemaView(url = "/api/schema"): { el: SVGSVGElement; controls: ViewportControls } {
  const svgEl = document.createElementNS(NS, "svg") as SVGSVGElement;
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgEl.setAttribute("font-family", FONT);
  svgEl.style.width = "100%";
  svgEl.style.height = "100%";
  svgEl.style.display = "block";

  const controls = viewport(svgEl);

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => load());

  async function load() {
    const res = await fetch(url);
    const tables: Table[] = await res.json();
    const th = schemaTheme();

    svgEl.innerHTML = "";

    const defs = el("defs") as SVGDefsElement;
    defs.appendChild(el("pattern", { id: "schema-grid", width: 24, height: 24, patternUnits: "userSpaceOnUse" },
      el("circle", { cx: 0.5, cy: 0.5, r: 0.5, fill: th.grid })));
    svgEl.appendChild(defs);
    defIcon(svgEl, "key");

    const positions = layoutTables(tables);

    let maxX = 0, maxY = 0;
    for (const [name, pos] of positions) {
      const t = tables.find((tb) => tb.table === name)!;
      maxX = Math.max(maxX, pos.x + TABLE_W + PAD);
      maxY = Math.max(maxY, pos.y + tableHeight(t) + PAD);
    }
    controls.setSize(maxX, maxY);

    svgEl.appendChild(el("rect", { width: maxX, height: maxY, fill: "url(#schema-grid)" }));

    renderEdges(svgEl, tables, positions, th);
    for (const t of tables) {
      const pos = positions.get(t.table);
      if (pos) svgEl.appendChild(renderTable(t, pos.x, pos.y, th, isPrimary(t.table, tables)));
    }
  }
  load();

  return { el: svgEl, controls };
}
