import { signal, effect } from "@blueshed/railroad";
import { el, SVG_NS } from "../graph/svg";
import { viewport, type ViewportControls } from "../viewport";
import { EmptyState } from "../empty-state";

interface Story {
  id: number;
  actor: string;
  action: string;
  description: string;
  links: { type: string; name: string }[];
}

const stories = signal<Story[]>([]);

const FONT = "ui-monospace, SFMono-Regular, monospace";
const ACTOR_W = 60;
const UC_W = 220;
const UC_H = 32;
const DOC_PAD = 12;
const DOC_HEADER = 28;
const GAP_Y = 8;
const PAD = 40;
const SIDE_GAP = 80;

const ACTOR_COLORS = [
  { stroke: "#3b82f6", fill: "#dbeafe", text: "#1d4ed8" },
  { stroke: "#f59e0b", fill: "#fef3c7", text: "#92400e" },
  { stroke: "#10b981", fill: "#d1fae5", text: "#065f46" },
  { stroke: "#ef4444", fill: "#fee2e2", text: "#991b1b" },
  { stroke: "#8b5cf6", fill: "#ede9fe", text: "#5b21b6" },
  { stroke: "#ec4899", fill: "#fce7f3", text: "#9d174d" },
  { stroke: "#06b6d4", fill: "#cffafe", text: "#155e75" },
];

function css(n: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(n).trim();
}

function renderDiagram(svgEl: SVGSVGElement, data: Story[]): { width: number; height: number } {
  while (svgEl.children.length > 1) svgEl.removeChild(svgEl.lastChild!);

  if (!data.length) return { width: 0, height: 0 };

  const th = {
    docFill: css("--surface"),
    docStroke: css("--border"),
    docText: css("--text-muted"),
  };

  // Assign colours to actors
  const actors = [...new Set(data.map(s => s.actor))];
  const actorColor = new Map<string, typeof ACTOR_COLORS[0]>();
  actors.forEach((a, i) => actorColor.set(a, ACTOR_COLORS[i % ACTOR_COLORS.length]));

  // Split actors: even indices left, odd indices right
  const leftActors = actors.filter((_, i) => i % 2 === 0);
  const rightActors = actors.filter((_, i) => i % 2 === 1);

  // Group stories by linked document, then by entity
  const docGroups = new Map<string, Story[]>();
  const placed = new Set<number>();
  for (const s of data) {
    const docLinks = s.links.filter(l => l.type === "document");
    if (docLinks.length) {
      for (const l of docLinks) {
        if (!docGroups.has(l.name)) docGroups.set(l.name, []);
        if (!placed.has(s.id)) {
          docGroups.get(l.name)!.push(s);
          placed.add(s.id);
        }
      }
    }
  }
  for (const s of data) {
    if (placed.has(s.id)) continue;
    const entityLink = s.links.find(l => l.type === "entity");
    const methodLink = s.links.find(l => l.type === "method");
    const group = entityLink?.name ?? methodLink?.name.split(".")[0] ?? "Other";
    if (!docGroups.has(group)) docGroups.set(group, []);
    docGroups.get(group)!.push(s);
    placed.add(s.id);
  }
  for (const s of data) {
    if (placed.has(s.id)) continue;
    if (!docGroups.has("Other")) docGroups.set("Other", []);
    docGroups.get("Other")!.push(s);
  }

  // Track which group names are documents vs entities
  const docNames = new Set<string>();
  for (const s of data) {
    for (const l of s.links) {
      if (l.type === "document") docNames.add(l.name);
    }
  }

  // Centre column for use case groups
  const centreX = PAD + ACTOR_W + SIDE_GAP;

  // Layout groups vertically in centre
  let groupY = PAD;
  const ucPositions = new Map<number, { x: number; y: number }>();

  for (const [groupName, groupStories] of docGroups) {
    const filteredStories = groupStories.filter(s => ucPositions.size === 0 || !ucPositions.has(s.id));
    if (!filteredStories.length && !groupStories.length) continue;
    const count = groupStories.filter(s => !ucPositions.has(s.id)).length;
    if (count === 0) { groupY += DOC_HEADER + DOC_PAD + GAP_Y * 3; continue; }

    const groupH = DOC_HEADER + count * (UC_H + GAP_Y) + DOC_PAD;

    // Group rectangle — clickable, navigates to document or entity
    const isDoc = docNames.has(groupName);
    const groupG = el("g", { cursor: "pointer" });
    groupG.appendChild(el("rect", {
      x: centreX - DOC_PAD, y: groupY, width: UC_W + DOC_PAD * 2, height: DOC_HEADER, rx: 8,
      fill: "transparent",
    }));
    (groupG as any).addEventListener("click", () => {
      location.hash = isDoc ? `/documents/${groupName}` : `/entities/${groupName}`;
    });
    svgEl.appendChild(el("rect", {
      x: centreX - DOC_PAD, y: groupY, width: UC_W + DOC_PAD * 2, height: groupH, rx: 8,
      fill: th.docFill, stroke: th.docStroke, "stroke-width": 0.5,
    }));
    const headerText = el("text", {
      x: centreX + UC_W / 2, y: groupY + 18, fill: isDoc ? css("--accent") : th.docText,
      "font-family": FONT, "font-size": 10, "font-weight": 500, "text-anchor": "middle",
      "text-decoration": "underline",
    }, groupName);
    groupG.appendChild(headerText);
    svgEl.appendChild(groupG);

    let cy = groupY + DOC_HEADER;
    for (const s of groupStories) {
      if (ucPositions.has(s.id)) continue;
      ucPositions.set(s.id, { x: centreX, y: cy });
      cy += UC_H + GAP_Y;
    }
    groupY += groupH + GAP_Y * 3;
  }

  const totalH = groupY;

  // Position actors on left and right, vertically centred
  const actorPositions = new Map<string, { x: number; y: number; side: "left" | "right" }>();

  function placeActors(list: string[], x: number, side: "left" | "right") {
    const spacing = list.length > 1 ? Math.min(120, (totalH - PAD * 2) / (list.length - 1)) : 0;
    const startY = PAD + (totalH - PAD * 2 - spacing * (list.length - 1)) / 2;
    for (let i = 0; i < list.length; i++) {
      actorPositions.set(list[i], { x, y: startY + i * spacing, side });
    }
  }

  placeActors(leftActors, PAD + ACTOR_W / 2, "left");
  placeActors(rightActors, centreX + UC_W + DOC_PAD + SIDE_GAP + ACTOR_W / 2, "right");

  // Draw edges
  for (const s of data) {
    const aPos = actorPositions.get(s.actor);
    const uPos = ucPositions.get(s.id);
    if (!aPos || !uPos) continue;

    const col = actorColor.get(s.actor)!;
    const ucMidY = uPos.y + UC_H / 2;
    const isLeft = aPos.side === "left";
    const x1 = isLeft ? aPos.x + ACTOR_W / 2 + 4 : aPos.x - ACTOR_W / 2 - 4;
    const x2 = isLeft ? uPos.x : uPos.x + UC_W;
    const y1 = aPos.y + 30;
    const dx = (x2 - x1) * 0.35;

    svgEl.appendChild(el("path", {
      d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${ucMidY} ${x2},${ucMidY}`,
      fill: "none", stroke: col.stroke, "stroke-width": 0.7, "stroke-opacity": 0.5,
    }));
  }

  // Draw actors
  for (const [name, pos] of actorPositions) {
    const col = actorColor.get(name)!;
    const g = el("g", { transform: `translate(${pos.x},${pos.y})` });
    g.appendChild(el("circle", { cx: 0, cy: 10, r: 8, fill: "none", stroke: col.stroke, "stroke-width": 1.5 }));
    g.appendChild(el("line", { x1: 0, y1: 18, x2: 0, y2: 38, stroke: col.stroke, "stroke-width": 1.5 }));
    g.appendChild(el("line", { x1: -12, y1: 26, x2: 12, y2: 26, stroke: col.stroke, "stroke-width": 1.5 }));
    g.appendChild(el("line", { x1: 0, y1: 38, x2: -10, y2: 52, stroke: col.stroke, "stroke-width": 1.5 }));
    g.appendChild(el("line", { x1: 0, y1: 38, x2: 10, y2: 52, stroke: col.stroke, "stroke-width": 1.5 }));
    g.appendChild(el("text", {
      x: 0, y: 66, fill: col.text,
      "font-family": FONT, "font-size": 10, "font-weight": 600, "text-anchor": "middle",
    }, name));
    svgEl.appendChild(g);
  }

  // Draw use case ellipses
  for (const s of data) {
    const pos = ucPositions.get(s.id);
    if (!pos) continue;
    const col = actorColor.get(s.actor)!;
    const cx = pos.x + UC_W / 2;
    const cy = pos.y + UC_H / 2;

    svgEl.appendChild(el("ellipse", {
      cx, cy, rx: UC_W / 2, ry: UC_H / 2,
      fill: col.fill, stroke: col.stroke, "stroke-width": 0.5, "stroke-opacity": 0.6,
    }));

    const maxChars = Math.floor((UC_W - 24) / 6);
    const label = s.action.length > maxChars ? s.action.slice(0, maxChars - 1) + "\u2026" : s.action;
    svgEl.appendChild(el("text", {
      x: cx, y: cy + 4, fill: col.text,
      "font-family": FONT, "font-size": 10, "text-anchor": "middle",
    }, label));
  }

  const maxX = centreX + UC_W + DOC_PAD + SIDE_GAP + ACTOR_W + PAD;
  const maxY = totalH + PAD;
  return { width: maxX, height: maxY };
}

export function UseCasesView(): { el: SVGSVGElement; empty: HTMLElement; controls: ViewportControls } {
  const svgEl = document.createElementNS(SVG_NS, "svg") as SVGSVGElement;
  svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svgEl.setAttribute("font-family", FONT);
  svgEl.style.width = "100%";
  svgEl.style.height = "100%";
  svgEl.style.display = "block";

  svgEl.appendChild(el("defs"));

  const empty = EmptyState("No stories", "bun model save story '{\"actor\":\"...\",\"action\":\"...\"}'");

  const controls = viewport(svgEl);

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => stories.set([...stories.peek()]));

  effect(() => {
    const data = stories.get();
    const { width, height } = renderDiagram(svgEl, data);
    const hasData = data.length > 0;
    svgEl.style.display = hasData ? "block" : "none";
    empty.style.display = hasData ? "none" : "";
    if (hasData) controls.setSize(width, height);
  });

  return { el: svgEl, empty, controls };
}

export function reloadUseCases() {
  fetch("/api/stories").then(r => r.json()).catch(() => []).then(s => stories.set(s));
}

reloadUseCases();
