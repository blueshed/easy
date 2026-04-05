import type { Graph } from "../graph-api";
import { el } from "./svg";
import { theme as loadTheme } from "./theme";
import { layout, NODE_W, NODE_H, PAD } from "./layout";
import { renderEdges } from "./edges";
import { renderNode } from "./nodes";

export type RenderResult = { width: number; height: number };

export function renderGraph(svg: SVGSVGElement, graph: Graph): RenderResult {
  const { tasks, deps } = graph;
  const t = loadTheme();

  // clear (keep first defs with filters)
  while (svg.children.length > 1) svg.removeChild(svg.lastChild!);

  // rebuild theme-dependent defs (markers, grid pattern)
  const defs = svg.querySelector("defs")!;
  defs.querySelectorAll("marker").forEach((m) => m.remove());
  defs.querySelectorAll("pattern").forEach((p) => p.remove());

  for (const [name, color] of [["pending", t.arrow.pending], ["active", t.arrow.active], ["done", t.arrow.done]] as const) {
    defs.appendChild(el("marker", {
      id: `arrow-${name}`, viewBox: "0 0 10 8", refX: 0, refY: 4, markerWidth: 8, markerHeight: 6, orient: "auto",
    }, el("path", { d: "M0,0 L10,4 L0,8 Z", fill: color })));
  }

  defs.appendChild(el("pattern", { id: "grid", width: 24, height: 24, patternUnits: "userSpaceOnUse" },
    el("circle", { cx: 0.5, cy: 0.5, r: 0.5, fill: t.gridDot })));

  if (!tasks.length) return { width: 0, height: 0 };

  // layout + bounds
  const positions = layout(tasks, deps);
  let maxX = 0, maxY = 0;
  for (const pos of positions.values()) {
    maxX = Math.max(maxX, pos.x + NODE_W + PAD);
    maxY = Math.max(maxY, pos.y + NODE_H + PAD);
  }

  // background
  svg.appendChild(el("rect", { width: maxX, height: maxY, fill: "url(#grid)" }));

  // edges then nodes
  renderEdges(svg, tasks, deps, positions, t);
  for (const task of tasks) {
    const pos = positions.get(task.id);
    if (pos) svg.appendChild(renderNode(task, pos, t));
  }

  return { width: maxX, height: maxY };
}
