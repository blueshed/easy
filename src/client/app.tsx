import { effect } from "@blueshed/railroad";
import { route, navigate } from "@blueshed/railroad/routes";
import { GraphView } from "./graph-view";
import { MemoriesView, reloadMemories } from "./memories-view";
import { StoriesView, reloadStories } from "./stories-view";
import { DocumentsView, reloadDocuments } from "./documents-view";
import { EntitiesView, reloadEntities } from "./entities-view";
import { ChecklistsView, reloadChecklists } from "./checklists-view";
import { ReferenceView, reloadReference } from "./reference-view";
import { Toolbar, type View, viewConfigs, devConfigs } from "./toolbar";
import { FlagsBar, updateFlags } from "./flags-bar";
import { showAbout } from "./about-dialog";
import type { ViewportControls } from "./viewport";

const { el: graph, controls: graphControls, onUpdate, reload: reloadGraph } = GraphView();

const viewControls = new Map<View, ViewportControls>();
viewControls.set("graph", graphControls);

let activeControls: ViewportControls = graphControls;

// WebSocket — reconnects automatically, reloads all data on change
function connect() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === "reload") {
        reloadAll();
      }
    } catch {}
  };
  ws.onclose = () => setTimeout(connect, 1000);
}

function reloadAll() {
  reloadGraph();
  reloadStories();
  reloadDocuments();
  reloadEntities();
  reloadChecklists();
  reloadMemories();
  reloadReference();
}

connect();

// route signals
const isStories = route("/");
const isDocuments = route("/documents/*");
const isEntities = route("/entities/*");
const isChecklists = route("/checklists/*");
const isReference = route("/reference");
const isGraph = route("/graph");
const isMemories = route("/memories");

const routeMap: [ReturnType<typeof route>, View][] = [
  [isStories, "stories"],
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
  about: showAbout,
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
