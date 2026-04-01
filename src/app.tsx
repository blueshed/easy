import { signal, computed, effect, batch, Signal } from "@blueshed/railroad";
import { routes } from "@blueshed/railroad";
import { when, list } from "@blueshed/railroad";

// --- Types ---

interface StoryData {
  id: number;
  actor: string;
  action: string;
  description: string;
  links: { type: string; name: string }[];
}

interface DocListItem {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
  fetch: string;
  description: string;
}

interface DocDetail {
  name: string;
  entity: string;
  collection: boolean;
  public: boolean;
  fetch: string;
  description: string;
  methods: MethodData[];
  changedBy: { entity: string; path: string | null; fks: string[] }[];
  stories: { actor: string; action: string }[];
}

interface EntityListItem {
  name: string;
}

interface EntityDetail {
  name: string;
  fields: { name: string; type: string }[];
  methods: MethodData[];
  relations: { entity: string; label: string; cardinality: string; direction: string }[];
  documents: { name: string; role: string }[];
  changes: { doc: string; path: string | null; collection: boolean; fks: string[] }[];
}

interface MethodData {
  name: string;
  args: string;
  return_type: string;
  publishes: string[];
  notifications: { channel: string; recipients: string }[];
  permissions: { path: string; description: string }[];
}

interface ChecklistItem {
  name: string;
  description: string;
  total: number;
  api: number;
  ux: number;
  done: number;
}

interface ChecklistDetail {
  name: string;
  description: string;
  checks: {
    id: number;
    seq: number;
    actor: string;
    action: string;
    method: string | null;
    description: string;
    confirmed: number;
    depends_on: number[];
  }[];
}

// --- State ---

const currentHash = signal(location.hash.slice(1) || "/stories");
window.addEventListener("hashchange", () => {
  currentHash.set(location.hash.slice(1) || "/stories");
});

const stories = signal<StoryData[]>([]);
const documents = signal<DocListItem[]>([]);
const entities = signal<EntityListItem[]>([]);
const checklists = signal<ChecklistItem[]>([]);
const metadata = signal<Record<string, string>>({});
const docDetails = signal<Record<string, DocDetail>>({});
const entityDetails = signal<Record<string, EntityDetail>>({});
const checklistDetails = signal<Record<string, ChecklistDetail>>({});

// --- Data loading ---

async function loadAll() {
  const [storiesData, docsData, entitiesData, checklistsData, metaData] =
    await Promise.all([
      fetch("/api/stories").then((r) => r.json()).catch(() => []),
      fetch("/api/documents").then((r) => r.json()).catch(() => []),
      fetch("/api/entities").then((r) => r.json()).catch(() => []),
      fetch("/api/checklists").then((r) => r.json()).catch(() => []),
      fetch("/api/metadata").then((r) => r.json()).catch(() => ({})),
    ]);

  batch(() => {
    stories.set(storiesData);
    documents.set(docsData);
    entities.set(entitiesData);
    checklists.set(checklistsData);
    metadata.set(metaData);
  });

  // Load details in parallel
  const docDetailPromises = docsData.map((d: DocListItem) =>
    fetch("/api/documents/" + encodeURIComponent(d.name))
      .then((r) => r.json())
      .then((detail: DocDetail) => {
        docDetails.mutate((m) => { m[d.name] = detail; });
      })
      .catch(() => {})
  );

  const entityDetailPromises = entitiesData.map((e: EntityListItem) =>
    fetch("/api/entities/" + encodeURIComponent(e.name))
      .then((r) => r.json())
      .then((detail: EntityDetail) => {
        entityDetails.mutate((m) => { m[e.name] = detail; });
      })
      .catch(() => {})
  );

  const checklistDetailPromises = checklistsData.map((cl: ChecklistItem) =>
    fetch("/api/checklists/" + encodeURIComponent(cl.name))
      .then((r) => r.json())
      .then((detail: ChecklistDetail) => {
        checklistDetails.mutate((m) => { m[cl.name] = detail; });
      })
      .catch(() => {})
  );

  await Promise.all([
    ...docDetailPromises,
    ...entityDetailPromises,
    ...checklistDetailPromises,
  ]);
}

// --- SSE live reload ---

function connectSSE() {
  const evtSource = new EventSource("/api/events");
  evtSource.onmessage = (event) => {
    if (event.data === "reload") {
      loadAll().then(() => {
        reloadVersion.update((v) => v + 1);
      });
    }
  };
}

// --- Helpers ---

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function linkHref(type: string, name: string): string | null {
  if (type === "entity") return "#/entity/" + name;
  if (type === "document") return "#/doc/" + name;
  if (type === "method") return "#/entity/" + name.split(".")[0];
  return null;
}

// --- SVG Loading ---

const reloadVersion = signal(0);

function SvgDiagram({ url }: { url: string }): Node {
  const container = <div class="diagram-inline" /> as HTMLElement;

  function loadSvg() {
    fetch(url + "?t=" + Date.now())
      .then((r) => r.text())
      .then((svg) => { container.innerHTML = svg; });
  }

  loadSvg();
  effect(() => {
    const v = reloadVersion.get();
    if (v > 0) loadSvg();
  });
  return container;
}

function ZoomableDiagram({ url }: { url: string }): Node {
  const zoom = signal(1);
  const inner = <div class="zoom-inner" /> as HTMLElement;

  fetch(url + "?t=" + Date.now())
    .then((r) => r.text())
    .then((svg) => { inner.innerHTML = svg; });

  effect(() => {
    const z = zoom.get();
    inner.style.transform = "scale(" + z + ")";
    inner.style.width = (100 / z) + "%";
  });

  function setZoom(z: number) {
    zoom.set(Math.max(0.1, Math.min(3, z)));
  }

  return (
    <div class="section section-full" style="display:flex">
      <div class="section-header">
        <h2 class="section-title">Entities</h2>
        <div class="zoom-controls">
          <button class="zoom-btn" onclick={() => setZoom(zoom.peek() - 0.25)}>&minus;</button>
          <span class="zoom-level">{() => Math.round(zoom.get() * 100) + "%"}</span>
          <button class="zoom-btn" onclick={() => setZoom(zoom.peek() + 0.25)}>+</button>
          <button class="zoom-btn" onclick={() => setZoom(1)}>F</button>
        </div>
      </div>
      <div class="diagram-inline">
        {inner}
      </div>
    </div>
  );
}

// --- Components ---

function LinkTag({ type, name }: { type: string; name: string }): Node {
  const href = linkHref(type, name);
  if (href) {
    return <a href={href} class={"link-tag " + type}>{type}: {name}</a>;
  }
  return <span class={"link-tag " + type}>{type}: {name}</span>;
}

function MethodCard({ method }: { method: MethodData }): Node {
  return (
    <div class="method-card">
      <div class="method-sig">
        {method.name}({method.args}) → {method.return_type}
      </div>
      <div class="method-tags">
        {method.permissions.map((p) => (
          <span class="perm-tag">{p.path}</span>
        ))}
        {method.publishes.map((p) => (
          <span class="pub-tag">publishes: {p}</span>
        ))}
      </div>
    </div>
  );
}

function StoriesPage(): Node {
  return (
    <div>
      <h2 class="section-title">Stories</h2>
      {when(
        () => stories.get().length === 0,
        () => <div class="empty">No stories yet. Add one with: bun model save story '&#123;"actor":"...","action":"..."&#125;'</div>,
        () => (
          <div>
            {list(stories, (s: StoryData) => s.id, (story: Signal<StoryData>) => {
              const s = story.get();
              return (
                <div class="story">
                  <div class="story-text">
                    <span class="story-id">{() => story.get().id + "#"}</span>
                    {" As a "}
                    <span class="story-actor">{() => story.get().actor}</span>
                    {", I can "}
                    <span class="story-action">{() => story.get().action}</span>
                  </div>
                  {when(
                    () => !!story.get().description,
                    () => <div class="story-desc">{() => story.get().description}</div>,
                  )}
                  {when(
                    () => story.get().links.filter((l) => l.type !== "notification").length > 0,
                    () => (
                      <div class="story-links">
                        {story.get().links
                          .filter((l) => l.type !== "notification")
                          .map((l) => <LinkTag type={l.type} name={l.name} />)}
                      </div>
                    ),
                  )}
                </div>
              );
            })}
            <div class="legend">
              <span class="link-tag entity">entity</span>
              <span class="link-tag document">document</span>
              <span class="link-tag method">method</span>
            </div>
          </div>
        ),
      )}
      {when(
        () => Object.keys(metadata.get()).length > 0,
        () => (
          <div id="metadata-section">
            <h3 class="detail-heading">Metadata</h3>
            <div class="metadata-grid">
              {Object.entries(metadata.get()).map(([key, value]) => (
                <div class="metadata-item">
                  <dt class="metadata-key">{key}</dt>
                  <dd class="metadata-value">{value}</dd>
                </div>
              ))}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function UseCasesPage(): Node {
  return (
    <div>
      <h2 class="section-title">Use Cases</h2>
      <SvgDiagram url="/diagram/usecases.svg" />
    </div>
  );
}

function EntitiesPage(): Node {
  return <ZoomableDiagram url="/diagram/entities.svg" />;
}

function ReferencePage(): Node {
  const content = <div class="md-content" /> as HTMLElement;
  fetch("/api/reference")
    .then((r) => r.text())
    .then((md) => { content.innerHTML = renderMarkdown(md); });
  return (
    <div>
      {content}
    </div>
  );
}

function DocPage(_: Record<string, string>, params$: Signal<Record<string, string>>): Node {
  const name = computed(() => params$.get().name ?? "");
  const detail = computed(() => docDetails.get()[name.get()]);
  const doc = computed(() => documents.get().find((d) => d.name === name.get()));

  const diagramEl = <div class="diagram-inline" /> as HTMLElement;
  effect(() => {
    const n = name.get();
    if (!n) return;
    fetch("/diagram/doc/" + encodeURIComponent(n) + ".svg?t=" + Date.now())
      .then((r) => r.text())
      .then((svg) => { diagramEl.innerHTML = svg; });
  });

  return (
    <div>
      <h2 class="section-title">{() => name.get()}</h2>
      {when(
        doc,
        () => {
          const d = doc.get()!;
          return (
            <div class="doc-meta">
              <a href={"#/entity/" + d.entity} class="meta-tag">{d.entity}</a>
              {d.collection ? <span class="meta-tag collection">collection</span> : null}
              {d.public ? <span class="meta-tag public">public</span> : null}
              {d.fetch && d.fetch !== "select" ? <span class={"meta-tag " + d.fetch}>{d.fetch}</span> : null}
            </div>
          );
        },
      )}
      {when(
        () => doc.get()?.description,
        () => <p class="doc-description">{() => doc.get()?.description ?? ""}</p>,
      )}
      {diagramEl}
      {when(
        () => (detail.get()?.changedBy?.length ?? 0) > 0,
        () => (
          <div>
            <h3 class="detail-heading">Changed by</h3>
            <div class="entity-docs">
              {detail.get()!.changedBy.map((c) => {
                let label = c.entity;
                if (c.path) {
                  label += " → " + c.path;
                } else {
                  label += " (root)";
                }
                return (
                  <a href={"#/entity/" + c.entity} class="change-tag">
                    {label}
                    {c.path && c.fks.length > 1
                      ? <span class="role-tag"> [{c.fks.slice(1).join(", ")}]</span>
                      : null}
                    {!c.path ? <span class="role-tag"> (root)</span> : null}
                  </a>
                );
              })}
            </div>
          </div>
        ),
      )}
      {when(
        () => (detail.get()?.methods?.length ?? 0) > 0,
        () => (
          <div>
            <h3 class="detail-heading">Methods</h3>
            <div class="methods-list">
              {detail.get()!.methods.map((m) => <MethodCard method={m} />)}
            </div>
          </div>
        ),
      )}
      {when(
        () => (detail.get()?.stories?.length ?? 0) > 0,
        () => (
          <div>
            <h3 class="detail-heading">Stories</h3>
            {detail.get()!.stories.map((s) => (
              <div class="story">
                <div class="story-text">
                  As a <span class="story-actor">{s.actor}</span>, I can{" "}
                  <span class="story-action">{s.action}</span>
                </div>
              </div>
            ))}
          </div>
        ),
      )}
    </div>
  );
}

function EntityPage(_: Record<string, string>, params$: Signal<Record<string, string>>): Node {
  const name = computed(() => params$.get().name ?? "");
  const detail = computed(() => entityDetails.get()[name.get()]);

  const diagramEl = <div class="diagram-inline" /> as HTMLElement;
  effect(() => {
    const n = name.get();
    if (!n) return;
    fetch("/diagram/entity/" + encodeURIComponent(n) + ".svg?t=" + Date.now())
      .then((r) => r.text())
      .then((svg) => { diagramEl.innerHTML = svg; });
  });

  return (
    <div>
      <h2 class="section-title">{() => name.get()}</h2>
      {diagramEl}
      {when(
        () => (detail.get()?.documents?.length ?? 0) > 0,
        () => (
          <div>
            <h3 class="detail-heading">Documents</h3>
            <div class="entity-docs">
              {detail.get()!.documents.map((d) => (
                <a href={"#/doc/" + d.name} class="link-tag document">
                  {d.name} <span class="role-tag">({d.role})</span>
                </a>
              ))}
            </div>
          </div>
        ),
      )}
      {when(
        () => (detail.get()?.changes?.length ?? 0) > 0,
        () => (
          <div>
            <h3 class="detail-heading">Changes</h3>
            <div class="entity-docs">
              {detail.get()!.changes.map((c) => {
                let label = c.doc + "(" + c.fks[0] + ")";
                if (c.path) {
                  label += " → " + c.path;
                }
                return (
                  <a href={"#/doc/" + c.doc} class="change-tag">
                    {label}
                    {c.path && c.fks.length > 1
                      ? <span class="role-tag"> [{c.fks.slice(1).join(", ")}]</span>
                      : null}
                    {c.collection
                      ? <span class="role-tag"> (collection)</span>
                      : null}
                  </a>
                );
              })}
            </div>
          </div>
        ),
      )}
      {when(
        () => (detail.get()?.methods?.length ?? 0) > 0,
        () => (
          <div>
            <h3 class="detail-heading">Methods</h3>
            <div class="methods-list">
              {detail.get()!.methods.map((m) => <MethodCard method={m} />)}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function ChecklistPage(_: Record<string, string>, params$: Signal<Record<string, string>>): Node {
  const name = computed(() => params$.get().name ?? "");
  const cl = computed(() => checklists.get().find((c) => c.name === name.get()));
  const detail = computed(() => checklistDetails.get()[name.get()]);

  return (
    <div>
      <h2 class="section-title">{() => name.get()}</h2>
      {when(
        () => cl.get()?.description,
        () => <p class="checklist-desc">{() => cl.get()?.description ?? ""}</p>,
      )}
      {when(
        cl,
        () => {
          const c = cl.get()!;
          const pct = c.total > 0 ? Math.round((c.done / c.total) * 100) : 0;
          return (
            <div>
              <div class="checklist-bar-wrap">
                <div class="checklist-bar" style={"width:" + pct + "%"} />
              </div>
              <span class="checklist-pct">
                api: {c.api}/{c.total} &nbsp; ux: {c.ux}/{c.total} &nbsp; done: {c.done}/{c.total}
              </span>
            </div>
          );
        },
      )}
      {when(
        () => detail.get()?.checks,
        () => {
          const checks = detail.get()!.checks;
          const idToSeq: Record<number, number> = {};
          checks.forEach((c) => { idToSeq[c.id] = c.seq; });
          return (
            <div class="checks-list">
              {checks.map((c) => {
                const apiOk = c.confirmed & 1;
                const uxOk = c.confirmed & 2;
                const fullyDone = c.confirmed === 3;
                const classes = "check-item" +
                  (fullyDone ? " confirmed" : "") +
                  (c.action === "denied" ? " denied" : "");
                return (
                  <div class={classes}>
                    <div class="check-row-top">
                      <span class="check-bits">
                        <span class={"check-bit" + (apiOk ? " ok" : "")}>A</span>
                        <span class={"check-bit" + (uxOk ? " ok" : "")}>U</span>
                      </span>
                      <span class="check-seq">{c.seq}</span>
                      <span class={"check-actor actor-" + c.actor.replace(/[^a-zA-Z]/g, "")}>
                        {c.actor}
                      </span>
                      <span class="check-action">
                        {c.action === "denied" ? "DENIED" : "CAN"}
                      </span>
                      {c.method
                        ? <a href={"#/entity/" + c.method.split(".")[0]} class="check-method">{c.method}</a>
                        : null}
                      {c.depends_on.length > 0
                        ? <span class="check-deps">after step {c.depends_on.map((id) => idToSeq[id] || id).join(", ")}</span>
                        : null}
                    </div>
                    {c.description
                      ? <div class="check-row-desc">{c.description}</div>
                      : null}
                  </div>
                );
              })}
            </div>
          );
        },
      )}
    </div>
  );
}

function navClass(path: string): Signal<string> {
  return computed(() => "nav-link" + (currentHash.get() === path ? " active" : ""));
}

function NavLink({ href, children }: { href: string; children?: any }): Node {
  const el = <a href={"#" + href} class={navClass(href)}>{children}</a> as HTMLElement;
  return el;
}

function Sidebar(): Node {
  return (
    <nav class="sidenav">
      <h1>Easy</h1>
      <div class="nav-section">Diagrams</div>
      <NavLink href="/stories">Stories</NavLink>
      <NavLink href="/usecases">Use Cases</NavLink>
      <NavLink href="/entities">Entities</NavLink>
      <NavLink href="/reference">Reference</NavLink>
      <div class="nav-section">Documents</div>
      {list(documents, (d: DocListItem) => d.name, (doc: Signal<DocListItem>) => {
        const path = computed(() => "/doc/" + doc.get().name);
        return (
          <a
            href={computed(() => "#" + path.get())}
            class={computed(() => "nav-link" + (currentHash.get() === path.get() ? " active" : ""))}
          >
            {() => doc.get().name}
          </a>
        );
      })}
      <div class="nav-section">Checklists</div>
      {list(checklists, (c: ChecklistItem) => c.name, (cl: Signal<ChecklistItem>) => {
        const path = computed(() => "/checklist/" + encodeURIComponent(cl.get().name));
        return (
          <a
            href={computed(() => "#" + path.get())}
            class={computed(() => "nav-link" + (currentHash.get() === path.get() ? " active" : ""))}
          >
            {() => cl.get().name}
            <span class="checklist-progress">
              {() => cl.get().done + "/" + cl.get().total}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

// --- Markdown renderer ---

function renderMarkdown(md: string): string {
  let html = "";
  const lines = md.split("\n");
  let i = 0;
  let inCode = false;
  let codeLines: string[] = [];
  let inList = false;

  while (i < lines.length) {
    const line = lines[i]!;
    if (inCode) {
      if (line.match(/^```/)) {
        html += '<pre class="md-pre"><code>' + esc(codeLines.join("\n")) + "</code></pre>";
        codeLines = [];
        inCode = false;
      } else {
        codeLines.push(line);
      }
      i++;
      continue;
    }
    if (line.match(/^```/)) {
      if (inList) { html += "</ul>"; inList = false; }
      inCode = true;
      codeLines = [];
      i++;
      continue;
    }
    if (line.match(/^\s*$/)) {
      if (inList) { html += "</ul>"; inList = false; }
      i++;
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      if (inList) { html += "</ul>"; inList = false; }
      const level = m[1]!.length;
      html += "<h" + level + ' class="md-h">' + inlineMd(m[2]!) + "</h" + level + ">";
      i++;
      continue;
    }
    if ((m = line.match(/^[-*]\s+(.*)/))) {
      if (!inList) { html += '<ul class="md-ul">'; inList = true; }
      html += "<li>" + inlineMd(m[1]!) + "</li>";
      i++;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    if (line.indexOf("|") !== -1 && i + 1 < lines.length && lines[i + 1]!.match(/^\|[-\s|]+\|$/)) {
      const headerCells = line.split("|").filter((c) => c.trim() !== "");
      html += '<table class="md-table"><thead><tr>';
      headerCells.forEach((c) => { html += "<th>" + inlineMd(c.trim()) + "</th>"; });
      html += "</tr></thead><tbody>";
      i += 2;
      while (i < lines.length && lines[i]!.indexOf("|") !== -1) {
        const cells = lines[i]!.split("|").filter((c) => c.trim() !== "");
        html += "<tr>";
        cells.forEach((c) => { html += "<td>" + inlineMd(c.trim()) + "</td>"; });
        html += "</tr>";
        i++;
      }
      html += "</tbody></table>";
      continue;
    }
    html += '<p class="md-p">' + inlineMd(line) + "</p>";
    i++;
  }
  if (inList) html += "</ul>";
  return html;
}

function inlineMd(t: string): string {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

// --- Mount ---

function App(): Node {
  const main = <main class="main" /> as HTMLElement;

  routes(main, {
    "/stories": () => <StoriesPage />,
    "/usecases": () => <UseCasesPage />,
    "/entities": () => <EntitiesPage />,
    "/reference": () => <ReferencePage />,
    "/doc/:name": (p, p$) => DocPage(p, p$),
    "/entity/:name": (p, p$) => EntityPage(p, p$),
    "/checklist/:name": (p, p$) => ChecklistPage(p, p$),
    "*": () => <StoriesPage />,
  });

  return (
    <div>
      <Sidebar />
      {main}
    </div>
  );
}

// Bootstrap
const app = document.getElementById("app")!;
app.appendChild(<App />);
loadAll();
connectSSE();
