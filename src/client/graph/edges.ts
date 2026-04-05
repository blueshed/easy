import type { Task, Dep } from "../graph-api";
import type { Theme } from "./theme";
import type { Pos } from "./layout";
import { NODE_W, NODE_H, GAP_X, GAP_Y, PAD } from "./layout";
import { el } from "./svg";

export function renderEdges(
  svgEl: SVGSVGElement,
  tasks: Task[],
  deps: Dep[],
  positions: Map<number, Pos>,
  t: Theme,
) {
  const taskMap = new Map(tasks.map((tk) => [tk.id, tk]));
  const layerMap = new Map<number, number>();
  for (const tk of tasks) {
    const pos = positions.get(tk.id);
    if (pos) layerMap.set(tk.id, Math.round((pos.x - PAD) / (NODE_W + GAP_X)));
  }

  for (const dep of deps) {
    const from = positions.get(dep.depends_on);
    const to = positions.get(dep.task_id);
    if (!from || !to) continue;

    const sourceTask = taskMap.get(dep.depends_on);
    const targetTask = taskMap.get(dep.task_id);

    const x1 = from.x + NODE_W;
    const y1 = from.y + NODE_H / 2;
    const x2 = to.x - 8;
    const y2 = to.y + NODE_H / 2;

    const isDone = sourceTask?.status === "done";
    const isActive = sourceTask?.status === "in_progress" || targetTask?.status === "in_progress";
    const edgeColor = isDone ? t.edge.done : isActive ? t.edge.active : t.edge.pending;
    const markerRef = isDone ? "arrow-done" : isActive ? "arrow-active" : "arrow-pending";

    const fromLayer = layerMap.get(dep.depends_on) ?? 0;
    const toLayer = layerMap.get(dep.task_id) ?? 0;
    const span = toLayer - fromLayer;

    let d: string;
    if (span > 1) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;
      let needsDetour = false;
      for (const tk of tasks) {
        const p = positions.get(tk.id);
        if (!p) continue;
        const tLayer = layerMap.get(tk.id) ?? 0;
        if (tLayer > fromLayer && tLayer < toLayer) {
          const cardTop = p.y - GAP_Y / 2;
          const cardBot = p.y + NODE_H + GAP_Y / 2;
          if (midY > cardTop && midY < cardBot) {
            needsDetour = true;
            break;
          }
        }
      }

      if (needsDetour) {
        const detourY = y2 < y1
          ? Math.min(y1, y2) - NODE_H - GAP_Y
          : Math.max(y1, y2) + NODE_H + GAP_Y;
        d = `M${x1},${y1} C${x1 + GAP_X},${y1} ${midX - GAP_X},${detourY} ${midX},${detourY} S${x2 - GAP_X},${y2} ${x2},${y2}`;
      } else {
        const dx = (x2 - x1) * 0.35;
        d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
      }
    } else {
      const dx = (x2 - x1) * 0.45;
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
    }

    const path = el("path", {
      d,
      fill: "none",
      stroke: edgeColor,
      "stroke-width": 1,
      "marker-end": `url(#${markerRef})`,
    });

    if (isActive) {
      path.setAttribute("stroke-dasharray", "4 8");
      path.classList.add("edge-active");
      path.setAttribute("stroke", t.arrow.active);
      path.setAttribute("stroke-opacity", "0.6");
    }

    svgEl.appendChild(path);
  }
}
