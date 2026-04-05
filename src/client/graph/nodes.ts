import type { Task } from "../graph-api";
import type { Theme } from "./theme";
import type { Pos } from "./layout";
import { NODE_W, NODE_H } from "./layout";
import { el } from "./svg";

export function renderNode(task: Task, pos: Pos, t: Theme): SVGElement {
  const s = t[task.status] ?? t.pending;
  const isActive = task.status === "in_progress";

  const g = el("g", { transform: `translate(${pos.x},${pos.y})` });

  const card = el("rect", {
    width: NODE_W, height: NODE_H, rx: 6,
    fill: s.fill, stroke: s.stroke,
    "stroke-width": isActive ? 1.5 : 0.5,
    filter: isActive ? "url(#glow)" : "url(#shadow)",
  });
  if (isActive) card.setAttribute("stroke-opacity", "0.8");
  g.appendChild(card);

  g.appendChild(el("line", {
    x1: 8, y1: 1, x2: NODE_W - 8, y2: 1,
    stroke: s.stroke, "stroke-opacity": 0.15, "stroke-width": 1,
  }));

  const dot = el("circle", { cx: 14, cy: NODE_H / 2, r: 3.5, fill: s.dot });
  if (isActive) dot.classList.add("dot-active");
  if (task.status === "done") dot.setAttribute("fill-opacity", "0.6");
  g.appendChild(dot);

  g.appendChild(el("text", {
    x: 26, y: 23, fill: s.text,
    "font-family": "ui-monospace, SFMono-Regular, monospace",
    "font-size": 12, "font-weight": 500, "letter-spacing": "-0.02em",
  }, task.name));

  if (task.description) {
    const maxChars = Math.floor((NODE_W - 32) / 5.5);
    const truncated = task.description.length > maxChars
      ? task.description.slice(0, maxChars - 1) + "\u2026"
      : task.description;
    g.appendChild(el("text", {
      x: 26, y: 40, fill: t.descText,
      "font-family": "system-ui, -apple-system, sans-serif",
      "font-size": 10, "font-weight": 400,
    }, truncated));
  }

  if (task.status === "done") {
    const nameEl = g.querySelector("text") as SVGTextElement;
    requestAnimationFrame(() => {
      if (nameEl?.getComputedTextLength) {
        const w = nameEl.getComputedTextLength();
        g.appendChild(el("line", {
          x1: 24, y1: 21, x2: 26 + w, y2: 21,
          stroke: s.dot, "stroke-width": 0.5, "stroke-opacity": 0.4,
        }));
      }
    });
  }

  return g;
}
