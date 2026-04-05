import { el, SVG_NS } from "./graph/svg";

interface EntityData {
  name: string;
  fields: { name: string; type: string }[];
  methods: { name: string; args: string; return_type: string }[];
  relations: { entity: string; label: string; cardinality: string; direction: string }[];
}

const ROW_H = 22;
const HEADER_H = 32;
const PAD = 40;
const GAP_X = 100;
const GAP_Y = 20;
const REL_W = 150;
const REL_H = 36;
const FONT = "ui-monospace, SFMono-Regular, monospace";
const CHAR_W_11 = 6.8;  // approximate char width at font-size 11
const CHAR_W_10 = 6.2;  // approximate char width at font-size 10

function css(n: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

/** Compute box width from content so text never overlaps. */
function calcWidth(data: EntityData): number {
  // header
  let max = data.name.length * 7.2 + 24;
  // fields: "name" (left) + "type" (right) + gap
  for (const f of data.fields)
    max = Math.max(max, f.name.length * CHAR_W_11 + f.type.length * CHAR_W_10 + 40);
  // methods: "name(args)" (left) + " : return_type" (right) + gap
  for (const m of data.methods) {
    const sig = `${m.name}(${m.args})`;
    max = Math.max(max, sig.length * CHAR_W_10 + m.return_type.length * CHAR_W_10 + 48);
  }
  return Math.max(240, Math.ceil(max));
}

function bodyHeight(fields: number, methods: number): number {
  return HEADER_H + (fields + methods) * ROW_H + (methods > 0 ? 10 : 0) + 8;
}

export function EntityDiagram(data: EntityData): SVGSVGElement {
  const th = {
    fill: css("--schema-primary-fill"), stroke: css("--schema-primary-stroke"),
    header: css("--schema-pk"), col: css("--schema-col-text"),
    type: css("--schema-type-text"), method: css("--text-secondary"),
    relFill: css("--schema-table-fill"), relStroke: css("--schema-table-stroke"),
    relText: css("--schema-table-header"),
    edge: css("--schema-edge"), dot: css("--schema-edge-dot"),
  };

  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("font-family", FONT);

  const boxW = calcWidth(data);
  const h = bodyHeight(data.fields.length, data.methods.length);

  // --- Main entity box ---
  const g = el("g", { transform: `translate(${PAD},${PAD})` });

  g.appendChild(el("rect", {
    width: boxW, height: h, rx: 6, x: 1, y: 2,
    fill: "black", "fill-opacity": 0.12, filter: "blur(4px)",
  }));
  g.appendChild(el("rect", {
    width: boxW, height: h, rx: 6,
    fill: th.fill, stroke: th.stroke, "stroke-width": 1,
  }));
  g.appendChild(el("text", {
    x: 12, y: 22, fill: th.header, "font-size": 13, "font-weight": 700,
  }, data.name));
  g.appendChild(el("line", {
    x1: 0, y1: HEADER_H, x2: boxW, y2: HEADER_H,
    stroke: th.stroke, "stroke-opacity": 0.3,
  }));

  let cy = HEADER_H + 18;
  for (const f of data.fields) {
    const pk = f.name === "id";
    g.appendChild(el("text", {
      x: 12, y: cy, fill: pk ? th.header : th.col,
      "font-size": 11, "font-weight": pk ? 600 : 400,
    }, f.name));
    g.appendChild(el("text", {
      x: boxW - 12, y: cy, fill: th.type,
      "font-size": 10, "text-anchor": "end",
    }, f.type.toLowerCase()));
    cy += ROW_H;
  }

  if (data.methods.length) {
    cy += 2;
    g.appendChild(el("line", {
      x1: 8, y1: cy - 8, x2: boxW - 8, y2: cy - 8,
      stroke: th.stroke, "stroke-opacity": 0.25, "stroke-dasharray": "2 2",
    }));
    cy += 4;
    for (const m of data.methods) {
      g.appendChild(el("text", {
        x: 12, y: cy, fill: th.method, "font-size": 10,
      }, `${m.name}(${m.args})`));
      g.appendChild(el("text", {
        x: boxW - 12, y: cy, fill: th.type,
        "font-size": 10, "text-anchor": "end",
      }, `: ${m.return_type}`));
      cy += ROW_H;
    }
  }
  svg.appendChild(g);

  // --- Related entities (deduplicated) ---
  // Group relations by target entity so each entity appears once
  const relMap = new Map<string, typeof data.relations>();
  for (const r of data.relations) {
    if (!relMap.has(r.entity)) relMap.set(r.entity, []);
    relMap.get(r.entity)!.push(r);
  }
  const uniqueEntities = [...relMap.keys()];

  if (uniqueEntities.length) {
    const relX = PAD + boxW + GAP_X;
    const totalRelH = uniqueEntities.length * (REL_H + GAP_Y) - GAP_Y;
    const relStartY = PAD + Math.max(0, (h - totalRelH) / 2);

    // Draw edges first (behind nodes)
    let edgeIdx = 0;
    for (let i = 0; i < uniqueEntities.length; i++) {
      const entityName = uniqueEntities[i];
      const rels = relMap.get(entityName)!;
      const ry = relStartY + i * (REL_H + GAP_Y);
      const toY = ry + REL_H / 2;

      for (const r of rels) {
        // Spread connection points across the body of the main box
        const totalEdges = data.relations.length;
        const fromY = PAD + HEADER_H + ((edgeIdx + 0.5) / totalEdges) * (h - HEADER_H);
        const x1 = PAD + boxW, x2 = relX;
        const dx = (x2 - x1) * 0.4;

        svg.appendChild(el("path", {
          d: `M${x1},${fromY} C${x1 + dx},${fromY} ${x2 - dx},${toY} ${x2},${toY}`,
          fill: "none", stroke: th.edge, "stroke-width": 1, "stroke-dasharray": "4 3",
        }));

        // Cardinality label on edge
        const mx = (x1 + x2) / 2, my = (fromY + toY) / 2 - 7;
        const card = r.cardinality === "1" ? "1" : "*";
        const label = r.label ? `${r.label} (${card})` : card;
        svg.appendChild(el("text", {
          x: mx, y: my, fill: th.type, "font-size": 9, "text-anchor": "middle",
        }, label));

        edgeIdx++;
      }

      svg.appendChild(el("circle", { cx: relX, cy: toY, r: 3, fill: th.dot }));
    }

    // Draw related entity boxes on top
    for (let i = 0; i < uniqueEntities.length; i++) {
      const ry = relStartY + i * (REL_H + GAP_Y);
      const entityName = uniqueEntities[i];
      const rg = el("g", { transform: `translate(${relX},${ry})`, cursor: "pointer" });
      (rg as any).addEventListener("click", () => { location.hash = `/entities/${entityName}`; });
      rg.appendChild(el("rect", {
        width: REL_W, height: REL_H, rx: 6,
        fill: th.relFill, stroke: th.relStroke, "stroke-width": 0.5,
      }));
      rg.appendChild(el("text", {
        x: REL_W / 2, y: 23, fill: th.relText,
        "font-size": 12, "font-weight": 500, "text-anchor": "middle",
      }, uniqueEntities[i]));
      svg.appendChild(rg);
    }
  }

  // ViewBox
  const totalW = uniqueEntities.length ? PAD + boxW + GAP_X + REL_W + PAD : PAD + boxW + PAD;
  const totalRelH = uniqueEntities.length ? uniqueEntities.length * (REL_H + GAP_Y) - GAP_Y : 0;
  const totalH = Math.max(h, totalRelH) + PAD * 2;
  svg.setAttribute("viewBox", `0 0 ${totalW} ${totalH}`);

  return svg;
}
