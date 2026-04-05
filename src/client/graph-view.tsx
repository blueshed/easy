import { signal, effect } from "@blueshed/railroad";
import type { Graph } from "./graph-api";
import { SVG_NS } from "./graph/svg";
import { renderGraph } from "./graph/render";
import { viewport } from "./viewport";

export function GraphView() {
  const graph = signal<Graph>({ tasks: [], deps: [], flags: [] });
  const listeners: ((g: Graph) => void)[] = [];

  function update(g: Graph) {
    graph.set(g);
    for (const fn of listeners) fn(g);
  }

  if (!document.getElementById("graph-styles")) {
    const style = document.createElement("style");
    style.id = "graph-styles";
    style.textContent = `
      @keyframes pulse-dot { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      @keyframes dash-flow { to { stroke-dashoffset: -12; } }
      .edge-active { animation: dash-flow 0.8s linear infinite; }
      .dot-active { animation: pulse-dot 2s ease-in-out infinite; }
    `;
    document.head.appendChild(style);
  }

  const svgEl = (
    <svg xmlns={SVG_NS} style="width:100%;height:100%;display:block" preserveAspectRatio="xMidYMid meet">
      <defs>
        <filter id="shadow" x="-8%" y="-8%" width="116%" height="132%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" flood-color="#000" flood-opacity="0.3" />
        </filter>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
    </svg>
  ) as SVGSVGElement;

  const controls = viewport(svgEl);

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => graph.set({ ...graph.peek() }));

  effect(() => {
    const g = graph.get();
    const { width, height } = renderGraph(svgEl, g);
    if (g.tasks.length) controls.setSize(width, height);
  });

  // initial load
  fetch("/api/tasks").then((r) => r.json()).then(update).catch(() => {});

  return {
    el: svgEl,
    controls,
    onUpdate(fn: (g: Graph) => void) { listeners.push(fn); },
    reload() {
      fetch("/api/tasks").then((r) => r.json()).then(update).catch(() => {});
    },
  };
}
