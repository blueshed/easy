import { signal, effect } from "@blueshed/railroad";
import { EmptyState } from "../empty-state";

type Memory = { id: number; tag: string; content: string; created_at: string; updated_at: string };

const memories = signal<Memory[]>([]);

function render(container: HTMLDivElement) {
  const mems = memories.get();
  container.innerHTML = "";

  if (!mems.length) {
    container.appendChild(EmptyState("No memories", "bun model save memory '{\"tag\":\"...\",\"content\":\"...\"}'"));
    return;
  }

  const grouped = new Map<string, Memory[]>();
  for (const m of mems) {
    if (!grouped.has(m.tag)) grouped.set(m.tag, []);
    grouped.get(m.tag)!.push(m);
  }

  for (const [tag, items] of grouped) {
    const section = <div class="memory-group" /> as HTMLDivElement;
    section.appendChild(<h3 class="memory-tag">{tag}</h3>);
    for (const m of items) {
      section.appendChild(
        <div class="memory-item">
          <span class="memory-id">#{m.id}</span>
          <span class="memory-content">{m.content}</span>
        </div>
      );
    }
    container.appendChild(section);
  }
}

export function MemoriesView() {
  const container = <div class="memories-view" /> as HTMLDivElement;
  effect(() => render(container));
  // initial load
  fetch("/api/memories").then((r) => r.json()).then((data) => memories.set(data)).catch(() => {});
  return container;
}

export function reloadMemories() {
  fetch("/api/memories").then((r) => r.json()).then((data) => memories.set(data)).catch(() => {});
}
