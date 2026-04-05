import { effect } from "@blueshed/railroad";
import { route, navigate } from "@blueshed/railroad/routes";
import { GraphView } from "./views/graph-view";
import { MemoriesView, reloadMemories } from "./views/memories-view";
import { StoriesView, reloadStories } from "./views/stories-view";
import { UseCasesView, reloadUseCases } from "./views/usecases-view";
import { DocumentsView, reloadDocuments } from "./views/documents-view";
import { EntitiesView, reloadEntities } from "./views/entities-view";
import { ChecklistsView, reloadChecklists } from "./views/checklists-view";
import { ReferenceView, reloadReference } from "./views/reference-view";
import { Toolbar, type View } from "./toolbar";
import { FlagsBar, updateFlags } from "./views/flags-bar";
import type { ViewportControls } from "./viewport";

const { el: graph, empty: graphEmpty, controls: graphControls, onUpdate, reload: reloadGraph } = GraphView();

const viewControls = new Map<View, ViewportControls>();
viewControls.set("graph", graphControls);

let activeControls: ViewportControls = graphControls;

// Schema → reload mapping: which views to refresh for each schema change
const schemaReloaders: Record<string, (() => void)[]> = {
  entity:       [reloadEntities, reloadDocuments, reloadStories],
  field:        [reloadEntities],
  relation:     [reloadEntities],
  method:       [reloadEntities, reloadDocuments],
  publish:      [reloadEntities, reloadDocuments],
  notification: [reloadDocuments],
  permission:   [reloadEntities, reloadDocuments],
  story:        [reloadStories, reloadUseCases],
  document:     [reloadDocuments],
  expansion:    [reloadDocuments],
  checklist:    [reloadChecklists],
  check:        [reloadChecklists],
  metadata:     [reloadStories],
  task:         [reloadGraph],
  memory:       [reloadMemories],
  flag:         [reloadGraph],
};

function reloadAll() {
  reloadGraph();
  reloadStories();
  reloadUseCases();
  reloadDocuments();
  reloadEntities();
  reloadChecklists();
  reloadMemories();
  reloadReference();
}

function handleChange(schema: string) {
  if (schema === "*") { reloadAll(); return; }
  const fns = schemaReloaders[schema];
  if (fns) for (const fn of fns) fn();
  else reloadAll();
}

// WebSocket — reconnects automatically, dispatches changes by schema
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "change") handleChange(msg.schema);
    } catch {}
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

connect();

// route signals
const isStories = route("/");
const isUseCases = route("/usecases");
const isDocuments = route("/documents/*");
const isEntities = route("/entities/*");
const isChecklists = route("/checklists/*");
const isReference = route("/reference");
const isGraph = route("/graph");
const isMemories = route("/memories");

const routeMap: [ReturnType<typeof route>, View][] = [
  [isStories, "stories"],
  [isUseCases, "usecases"],
  [isDocuments, "documents"],
  [isEntities, "entities"],
  [isChecklists, "checklists"],
  [isReference, "reference"],
  [isGraph, "graph"],
  [isMemories, "memories"],
];

const views = new Map<View, HTMLElement>();

const storiesContainer = <div class="content-container" /> as HTMLDivElement;
storiesContainer.appendChild(StoriesView());
views.set("stories", storiesContainer);

const { el: usecasesSvg, empty: usecasesEmpty, controls: usecasesControls } = UseCasesView();
viewControls.set("usecases", usecasesControls);
const usecasesContainer = <div class="graph-container" /> as HTMLDivElement;
usecasesContainer.appendChild(usecasesSvg);
usecasesContainer.appendChild(usecasesEmpty);
views.set("usecases", usecasesContainer);

const documentsContainer = <div class="content-container" /> as HTMLDivElement;
documentsContainer.appendChild(DocumentsView());
views.set("documents", documentsContainer);

const entitiesContainer = <div class="content-container" /> as HTMLDivElement;
entitiesContainer.appendChild(EntitiesView());
views.set("entities", entitiesContainer);

const checklistsContainer = <div class="content-container" /> as HTMLDivElement;
checklistsContainer.appendChild(ChecklistsView());
views.set("checklists", checklistsContainer);

const referenceContainer = <div class="content-container" /> as HTMLDivElement;
referenceContainer.appendChild(ReferenceView());
views.set("reference", referenceContainer);

const graphContainer = <div class="graph-container" /> as HTMLDivElement;
graphContainer.appendChild(graph);
graphContainer.appendChild(graphEmpty);
graphContainer.appendChild(<FlagsBar />);
views.set("graph", graphContainer);

const memoriesContainer = <div class="memories-container" /> as HTMLDivElement;
memoriesContainer.appendChild(MemoriesView());
views.set("memories", memoriesContainer);

function setView(v: View) {
  navigate(v === "stories" ? "/" : `/${v}`);
}

const toolbar = Toolbar({
  setView,
  zoomIn: () => activeControls.zoomIn(),
  zoomOut: () => activeControls.zoomOut(),
  fitToView: () => activeControls.fitToView(),
});

effect(() => {
  for (const [sig, name] of routeMap) {
    const match = sig.get();
    views.get(name)?.classList.toggle("hidden", match === null);
    if (match !== null) {
      activeControls = viewControls.get(name) ?? graphControls;
      toolbar.setActive(name);
    }
  }
});

const app = document.getElementById("app")!;
app.appendChild(toolbar.el);
for (const el of views.values()) app.appendChild(el);

onUpdate((g) => updateFlags(g.flags ?? []));

if (!location.hash) navigate("/");
