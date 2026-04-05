import { el, SVG_NS } from "./graph/svg";

export interface ExpansionNode {
  name: string;
  entity: string;
  type: "has-many" | "belongs-to" | "shallow";
  children: ExpansionNode[];
}

const NODE_W = 160;
const NODE_H = 40;
const PAD = 32;
const GAP_X = 80;
const GAP_Y = 16;
const FONT = "ui-monospace, SFMono-Regular, monospace";

function css(n: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

type Pos = { x: number; y: number };

function subtreeH(children: ExpansionNode[]): number {
  if (!children.length) return NODE_H;
  let h = 0;
  for (let i = 0; i < children.length; i++) {
    if (i > 0) h += GAP_Y;
    h += subtreeH(children[i].children);
  }
  return Math.max(NODE_H, h);
}

export function DocumentDiagram(doc: {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
  fetch: string;
  expansions: ExpansionNode[];
}): SVGSVGElement {
  const th = {
    docFill: css("--accent-dim"), docStroke: css("--accent"), docText: css("--accent"),
    entFill: css("--schema-primary-fill"), entStroke: css("--schema-primary-stroke"), entText: css("--schema-pk"),
    expFill: css("--schema-table-fill"), expStroke: css("--schema-table-stroke"), expText: css("--schema-table-header"),
    edge: css("--schema-edge"), dot: css("--schema-edge-dot"),
    label: css("--schema-type-text"), sub: css("--text-muted"),
  };

  const svg = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svg.setAttribute("font-family", FONT);

  const edges: SVGElement[] = [];
  const nodes: SVGElement[] = [];
  let maxX = 0, maxY = 0;

  function addNode(pos: Pos, label: string, sub: string | undefined, fill: string, stroke: string, text: string) {
    const g = el("g", { transform: `translate(${pos.x},${pos.y})` });
    g.appendChild(el("rect", { width: NODE_W, height: NODE_H, rx: 6, fill, stroke, "stroke-width": 0.5 }));
    g.appendChild(el("text", {
      x: NODE_W / 2, y: sub ? 17 : 25, fill: text,
      "font-size": 11, "font-weight": 600, "text-anchor": "middle",
    }, label));
    if (sub) {
      g.appendChild(el("text", {
        x: NODE_W / 2, y: 32, fill: th.sub, "font-size": 9, "text-anchor": "middle",
      }, sub));
    }
    maxX = Math.max(maxX, pos.x + NODE_W);
    maxY = Math.max(maxY, pos.y + NODE_H);
    nodes.push(g);
  }

  function addEdge(from: Pos, to: Pos, label: string, dashed: boolean) {
    const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
    const x2 = to.x, y2 = to.y + NODE_H / 2;
    const dx = (x2 - x1) * 0.4;

    const attrs: Record<string, string | number> = {
      d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
      fill: "none", stroke: th.edge, "stroke-width": 1,
    };
    if (dashed) attrs["stroke-dasharray"] = "4 4";
    edges.push(el("path", attrs));
    edges.push(el("circle", { cx: x2, cy: y2, r: 2.5, fill: th.dot }));

    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 6;
    edges.push(el("text", {
      x: mx, y: my, fill: th.label, "font-size": 8, "text-anchor": "middle",
    }, label));
  }

  // Layout
  const exps = doc.expansions || [];
  const treeH = subtreeH(exps);
  const totalH = Math.max(NODE_H, treeH);

  const docPos: Pos = { x: PAD, y: PAD + (totalH - NODE_H) / 2 };
  const rootPos: Pos = { x: PAD + NODE_W + GAP_X, y: PAD + (totalH - NODE_H) / 2 };

  function layoutExps(children: ExpansionNode[], depth: number, startY: number, parentPos: Pos) {
    let y = startY;
    for (const exp of children) {
      const childH = subtreeH(exp.children);
      const pos: Pos = { x: PAD + depth * (NODE_W + GAP_X), y: y + (childH - NODE_H) / 2 };
      const suffix = exp.type === "has-many" ? " []" : exp.type === "shallow" ? " *" : "";

      addEdge(parentPos, pos, `${exp.name} (${exp.type})`, exp.type === "shallow");
      addNode(pos, exp.entity + suffix, exp.name, th.expFill, th.expStroke, th.expText);

      if (exp.children.length) layoutExps(exp.children, depth + 1, y, pos);
      y += childH + GAP_Y;
    }
  }

  // Build diagram
  const flags = [doc.collection ? "collection" : "", doc.public ? "public" : "", doc.fetch !== "select" ? doc.fetch : ""]
    .filter(Boolean).join(", ");

  addNode(docPos, doc.name, flags || undefined, th.docFill, th.docStroke, th.docText);
  addEdge(docPos, rootPos, "root", false);
  addNode(rootPos, doc.entity, undefined, th.entFill, th.entStroke, th.entText);

  if (exps.length) layoutExps(exps, 2, PAD, rootPos);

  // Render edges behind nodes
  for (const e of edges) svg.appendChild(e);
  for (const n of nodes) svg.appendChild(n);

  svg.setAttribute("viewBox", `0 0 ${maxX + PAD} ${maxY + PAD}`);

  return svg;
}
