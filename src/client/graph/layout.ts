import type { Task, Dep } from "../graph-api";

export const NODE_W = 200;
export const NODE_H = 56;
export const GAP_X = 80;
export const GAP_Y = 32;
export const PAD = 40;

export type Pos = { x: number; y: number };

export function layout(tasks: Task[], deps: Dep[]): Map<number, Pos> {
  const positions = new Map<number, Pos>();
  if (!tasks.length) return positions;

  const depMap = new Map<number, number[]>();
  for (const d of deps) {
    if (!depMap.has(d.task_id)) depMap.set(d.task_id, []);
    depMap.get(d.task_id)!.push(d.depends_on);
  }

  const layers = new Map<number, number>();
  function depth(id: number, visited: Set<number>): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const parents = depMap.get(id) || [];
    const d = parents.length ? Math.max(...parents.map((p) => depth(p, visited))) + 1 : 0;
    layers.set(id, d);
    return d;
  }
  for (const t of tasks) depth(t.id, new Set());

  const byLayer = new Map<number, Task[]>();
  for (const t of tasks) {
    const l = layers.get(t.id) || 0;
    if (!byLayer.has(l)) byLayer.set(l, []);
    byLayer.get(l)!.push(t);
  }

  const maxPerLayer = Math.max(...[...byLayer.values()].map((g) => g.length));
  const totalHeight = maxPerLayer * (NODE_H + GAP_Y) - GAP_Y;

  const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
  for (const l of sortedLayers) {
    const group = byLayer.get(l)!;
    const groupHeight = group.length * (NODE_H + GAP_Y) - GAP_Y;
    const offsetY = (totalHeight - groupHeight) / 2;
    for (let i = 0; i < group.length; i++) {
      positions.set(group[i]!.id, {
        x: PAD + l * (NODE_W + GAP_X),
        y: PAD + offsetY + i * (NODE_H + GAP_Y),
      });
    }
  }

  return positions;
}
