import { signal, effect } from "@blueshed/railroad";
import { route, navigate } from "@blueshed/railroad/routes";
import { SchemaView } from "./schema-view";
import { EntityDiagram } from "./entity-diagram";

interface EntityListItem { name: string }

interface MethodData {
  name: string; args: string; return_type: string;
  publishes: string[];
  notifications: { channel: string; recipients: string }[];
  permissions: { path: string; description: string }[];
}

interface EntityDetail {
  name: string;
  fields: { name: string; type: string }[];
  methods: MethodData[];
  relations: { entity: string; label: string; cardinality: string; direction: string }[];
  documents: { name: string; role: string }[];
  changes: { doc: string; path: string | null; collection: boolean; fks: string[] }[];
}

const entities = signal<EntityListItem[]>([]);
const detail = signal<EntityDetail | null>(null);
const revision = signal(0);
const entityRoute = route<{ name: string }>("/entities/:name");

// Fetch detail when route or data revision changes
effect(() => {
  revision.get();
  const match = entityRoute.get();
  if (match) {
    detail.set(null);
    fetch(`/api/entities/${encodeURIComponent(match.name)}`)
      .then((r) => r.json())
      .then((d) => detail.set(d))
      .catch(() => {});
  } else {
    detail.set(null);
  }
});

function render(container: HTMLDivElement) {
  container.innerHTML = "";
  const list = entities.get();
  const sel = entityRoute.get()?.name ?? "";
  const det = detail.get();

  const sidebar = <div class="list-sidebar" /> as HTMLDivElement;
  if (!list.length) {
    sidebar.appendChild(<p class="list-empty">no entities</p>);
  } else {
    sidebar.appendChild(
      <div class={"list-item overview-item" + (!sel ? " active" : "")} onclick={() => navigate("/entities")}>
        <span class="list-item-name">All Entities</span>
      </div>
    );
  }
  for (const e of list) {
    const cls = "list-item" + (e.name === sel ? " active" : "");
    sidebar.appendChild(
      <div class={cls} onclick={() => navigate(`/entities/${e.name}`)}>
        <span class="list-item-name">{e.name}</span>
      </div>
    );
  }
  container.appendChild(sidebar);

  if (!sel) {
    const pane = <div class="detail-pane schema-overview" /> as HTMLDivElement;
    const { el: svgEl } = SchemaView("/api/domain-schema");
    pane.appendChild(svgEl);
    container.appendChild(pane);
  } else if (det) {
    const pane = <div class="detail-pane" /> as HTMLDivElement;
    pane.appendChild(<h3 class="detail-title">{det.name}</h3>);

    const diagramEl = <div class="detail-diagram" /> as HTMLDivElement;
    diagramEl.appendChild(EntityDiagram(det));
    pane.appendChild(diagramEl);

    if (det.fields?.length) {
      pane.appendChild(<h4 class="section-heading">Fields</h4>);
      const table = <table class="fields-table" /> as HTMLTableElement;
      for (const f of det.fields) {
        table.appendChild(<tr><td class="field-name">{f.name}</td><td class="field-type">{f.type}</td></tr>);
      }
      pane.appendChild(table);
    }

    if (det.documents?.length) {
      pane.appendChild(<h4 class="section-heading">Documents</h4>);
      const tags = <div class="tag-list" /> as HTMLDivElement;
      for (const d of det.documents) {
        tags.appendChild(<a href={`#/documents/${d.name}`} class="link-tag document">{d.name} <span class="role-tag">({d.role})</span></a>);
      }
      pane.appendChild(tags);
    }

    if (det.changes?.length) {
      pane.appendChild(<h4 class="section-heading">Changes</h4>);
      const tags = <div class="tag-list" /> as HTMLDivElement;
      for (const c of det.changes) {
        let label = `${c.doc}(${c.fks[0]})`;
        if (c.path) label += " \u2192 " + c.path;
        tags.appendChild(<a href={`#/documents/${c.doc}`} class="link-tag document">{label}</a>);
      }
      pane.appendChild(tags);
    }

    if (det.methods?.length) {
      pane.appendChild(<h4 class="section-heading">Methods</h4>);
      for (const m of det.methods) {
        const card = <div class="method-card" /> as HTMLDivElement;
        card.appendChild(<div class="method-sig">{m.name}({m.args}) → {m.return_type}</div>);
        const mtags = <div class="method-tags" /> as HTMLDivElement;
        for (const p of m.permissions) mtags.appendChild(<span class="perm-tag">{p.path}</span>);
        for (const p of m.publishes) mtags.appendChild(<span class="pub-tag">publishes: {p}</span>);
        card.appendChild(mtags);
        pane.appendChild(card);
      }
    }

    container.appendChild(pane);
  }
}

export function EntitiesView() {
  const container = <div class="split-view" /> as HTMLDivElement;
  effect(() => render(container));
  return container;
}

export function reloadEntities() {
  fetch("/api/entities").then((r) => r.json()).catch(() => []).then((list) => {
    entities.set(list);
    revision.set(revision.peek() + 1);
  });
}

reloadEntities();
