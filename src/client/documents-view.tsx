import { signal, effect } from "@blueshed/railroad";
import { route, navigate } from "@blueshed/railroad/routes";
import { DocumentDiagram, type ExpansionNode } from "./document-diagram";

interface DocListItem {
  name: string; entity: string; collection: boolean;
  public: boolean; fetch: string; description: string;
}

interface MethodData {
  name: string; args: string; return_type: string;
  publishes: string[];
  notifications: { channel: string; recipients: string }[];
  permissions: { path: string; description: string }[];
}

interface DocDetail {
  name: string; entity: string; collection: boolean;
  public: boolean; fetch: string; description: string;
  methods: MethodData[];
  changedBy: { entity: string; path: string | null; fks: string[] }[];
  stories: { actor: string; action: string }[];
  expansions: ExpansionNode[];
}

const documents = signal<DocListItem[]>([]);
const detail = signal<DocDetail | null>(null);
const revision = signal(0);
const docRoute = route<{ name: string }>("/documents/:name");

// Fetch detail when route or data revision changes
effect(() => {
  revision.get();
  const match = docRoute.get();
  if (match) {
    detail.set(null);
    fetch(`/api/documents/${encodeURIComponent(match.name)}`)
      .then((r) => r.json())
      .then((d) => detail.set(d))
      .catch(() => {});
  } else {
    detail.set(null);
  }
});

function render(container: HTMLDivElement) {
  container.innerHTML = "";
  const docs = documents.get();
  const sel = docRoute.get()?.name ?? "";
  const det = detail.get();

  const sidebar = <div class="list-sidebar" /> as HTMLDivElement;
  if (!docs.length) {
    sidebar.appendChild(<p class="list-empty">no documents</p>);
  }
  for (const d of docs) {
    const cls = "list-item" + (d.name === sel ? " active" : "");
    const item = <div class={cls} onclick={() => navigate(`/documents/${d.name}`)} /> as HTMLDivElement;
    item.appendChild(<span class="list-item-name">{d.name}</span>);
    const tags = <span class="list-item-tags" /> as HTMLSpanElement;
    tags.appendChild(<span class="meta-tag">{d.entity}</span>);
    if (d.collection) tags.appendChild(<span class="meta-tag collection">collection</span>);
    if (d.public) tags.appendChild(<span class="meta-tag public">public</span>);
    item.appendChild(tags);
    sidebar.appendChild(item);
  }
  container.appendChild(sidebar);

  if (det) {
    const pane = <div class="detail-pane" /> as HTMLDivElement;
    pane.appendChild(<h3 class="detail-title">{det.name}</h3>);

    const meta = <div class="detail-meta" /> as HTMLDivElement;
    meta.appendChild(<a href={`#/entities/${det.entity}`} class="meta-tag">{det.entity}</a>);
    if (det.collection) meta.appendChild(<span class="meta-tag collection">collection</span>);
    if (det.public) meta.appendChild(<span class="meta-tag public">public</span>);
    if (det.fetch !== "select") meta.appendChild(<span class="meta-tag">{det.fetch}</span>);
    pane.appendChild(meta);

    if (det.description) {
      pane.appendChild(<p class="detail-desc">{det.description}</p>);
    }

    const diagramEl = <div class="detail-diagram" /> as HTMLDivElement;
    diagramEl.appendChild(DocumentDiagram(det));
    pane.appendChild(diagramEl);

    if (det.changedBy?.length) {
      pane.appendChild(<h4 class="section-heading">Changed by</h4>);
      const changes = <div class="tag-list" /> as HTMLDivElement;
      for (const c of det.changedBy) {
        let label = c.entity;
        if (c.path) label += " \u2192 " + c.path;
        else label += " (root)";
        changes.appendChild(<a href={`#/entities/${c.entity}`} class="link-tag entity">{label}</a>);
      }
      pane.appendChild(changes);
    }

    if (det.methods?.length) {
      pane.appendChild(<h4 class="section-heading">Methods</h4>);
      for (const m of det.methods) {
        pane.appendChild(renderMethod(m));
      }
    }

    if (det.stories?.length) {
      pane.appendChild(<h4 class="section-heading">Stories</h4>);
      for (const s of det.stories) {
        pane.appendChild(
          <div class="story-card">
            <div class="story-text">
              As a <span class="story-actor">{s.actor}</span>, I can <span class="story-action">{s.action}</span>
            </div>
          </div>
        );
      }
    }

    container.appendChild(pane);
  }
}

function renderMethod(m: MethodData): HTMLElement {
  const card = <div class="method-card" /> as HTMLDivElement;
  card.appendChild(<div class="method-sig">{m.name}({m.args}) → {m.return_type}</div>);
  const tags = <div class="method-tags" /> as HTMLDivElement;
  for (const p of m.permissions) tags.appendChild(<span class="perm-tag">{p.path}</span>);
  for (const p of m.publishes) tags.appendChild(<span class="pub-tag">publishes: {p}</span>);
  card.appendChild(tags);
  return card;
}

export function DocumentsView() {
  const container = <div class="split-view" /> as HTMLDivElement;
  effect(() => render(container));
  return container;
}

export function reloadDocuments() {
  fetch("/api/documents").then((r) => r.json()).catch(() => []).then((docs) => {
    documents.set(docs);
    if (docRoute.peek()) {
      revision.set(revision.peek() + 1);
    } else if (docs.length && location.hash.startsWith("#/documents")) {
      navigate(`/documents/${docs[0].name}`);
    }
  });
}

reloadDocuments();
