import { signal, effect } from "@blueshed/railroad";
import { EmptyState } from "../empty-state";

interface Story {
  id: number;
  actor: string;
  action: string;
  description: string;
  links: { type: string; name: string }[];
}

const stories = signal<Story[]>([]);
const metadata = signal<Record<string, string>>({});

function linkHref(type: string, name: string): string | null {
  if (type === "entity") return "#/entities/" + name;
  if (type === "document") return "#/documents/" + name;
  if (type === "method") return "#/entities/" + name.split(".")[0];
  return null;
}

function render(container: HTMLDivElement) {
  container.innerHTML = "";
  const list = stories.get();
  const meta = metadata.get();

  // Metadata first — acts as intro
  const metaKeys = Object.keys(meta);
  if (metaKeys.length) {
    const grid = <div class="metadata-grid" /> as HTMLDivElement;
    for (const [key, value] of Object.entries(meta)) {
      grid.appendChild(
        <div class="metadata-item">
          <dt class="metadata-key">{key}</dt>
          <dd class="metadata-value">{value}</dd>
        </div>
      );
    }
    container.appendChild(grid);
  }

  if (!list.length) {
    container.appendChild(EmptyState("No stories", "bun model save story '{\"actor\":\"...\",\"action\":\"...\"}'"));
    return;
  }

  for (const s of list) {
    const card = <div class="story-card" /> as HTMLDivElement;
    card.appendChild(
      <div class="story-text">
        <span class="story-id">#{s.id}</span>
        {" As a "}
        <span class="story-actor">{s.actor}</span>
        {", I can "}
        <span class="story-action">{s.action}</span>
      </div>
    );
    if (s.description) {
      card.appendChild(<div class="story-desc">{s.description}</div>);
    }
    const links = s.links.filter((l) => l.type !== "notification");
    if (links.length) {
      const linksEl = <div class="story-links" /> as HTMLDivElement;
      for (const l of links) {
        const href = linkHref(l.type, l.name);
        if (href) {
          linksEl.appendChild(<a href={href} class={`link-tag ${l.type}`}>{l.type}: {l.name}</a>);
        } else {
          linksEl.appendChild(<span class={`link-tag ${l.type}`}>{l.type}: {l.name}</span>);
        }
      }
      card.appendChild(linksEl);
    }
    container.appendChild(card);
  }
}

export function StoriesView() {
  const container = <div class="stories-view" /> as HTMLDivElement;
  effect(() => render(container));
  return container;
}

export function reloadStories() {
  Promise.all([
    fetch("/api/stories").then((r) => r.json()).catch(() => []),
    fetch("/api/metadata").then((r) => r.json()).catch(() => ({})),
  ]).then(([s, m]) => { stories.set(s); metadata.set(m); });
}

// initial load
reloadStories();
