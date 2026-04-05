import { icon } from "./icon";

export type View = "stories" | "usecases" | "documents" | "entities" | "checklists" | "reference" | "graph" | "memories";

export const viewConfigs: { name: View; icon: string; title: string; hasViewport: boolean }[] = [
  { name: "stories", icon: "book", title: "Stories", hasViewport: false },
  { name: "usecases", icon: "users", title: "Use Cases", hasViewport: true },
  { name: "documents", icon: "file-text", title: "Documents", hasViewport: false },
  { name: "entities", icon: "box", title: "Entities", hasViewport: false },
  { name: "checklists", icon: "check-square", title: "Checklists", hasViewport: false },
];

export const devConfigs: { name: View; icon: string; title: string; hasViewport: boolean }[] = [
  { name: "graph", icon: "git-branch", title: "Tasks", hasViewport: true },
  { name: "memories", icon: "book-open", title: "Memories", hasViewport: false },
];

export const bottomConfigs: { name: View; icon: string; title: string; hasViewport: boolean }[] = [
  { name: "reference", icon: "help-circle", title: "Reference", hasViewport: false },
];

type Actions = {
  setView: (v: View) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  fitToView: () => void;
};

export function Toolbar(actions: Actions) {
  function btn(iconName: string, title: string, onclick: () => void, cls = "") {
    const b = <button title={title} onclick={onclick} class={cls} /> as HTMLButtonElement;
    b.appendChild(icon(iconName, 20, { "stroke-width": "1.75" }));
    return b;
  }

  const zoomInBtn = btn("zoom-in", "Zoom in", actions.zoomIn);
  const zoomOutBtn = btn("zoom-out", "Zoom out", actions.zoomOut);
  const fitBtn = btn("maximize", "Fit to view", actions.fitToView);
  const toolSep = <div class="separator" /> as HTMLDivElement;
  const viewportTools = [toolSep, zoomInBtn, zoomOutBtn, fitBtn];
  for (const el of viewportTools) el.classList.add("hidden");

  const viewBtns = new Map<View, HTMLButtonElement>();

  function makeBtn(v: { name: View; icon: string; title: string; hasViewport: boolean }) {
    const b = btn(v.icon, v.title, () => {
      actions.setView(v.name);
    }, "view-btn");
    viewBtns.set(v.name, b);
    return b;
  }

  const domainBtns = viewConfigs.map((v) => makeBtn(v));
  const devBtns = devConfigs.map((v) => makeBtn(v));
  const bottomBtns = bottomConfigs.map((v) => makeBtn(v));

  const allConfigs = [...viewConfigs, ...devConfigs, ...bottomConfigs];

  function setActive(name: View) {
    for (const [n, b] of viewBtns) b.classList.toggle("active", n === name);
    const cfg = allConfigs.find((c) => c.name === name);
    for (const el of viewportTools) el.classList.toggle("hidden", !cfg?.hasViewport);
  }

  return {
    el: (
      <div class="toolbar">
        {...domainBtns}
        <div class="separator" />
        {...devBtns}
        {toolSep}
        {zoomInBtn}
        {zoomOutBtn}
        {fitBtn}
        <div class="spacer" />
        {...bottomBtns}
      </div>
    ),
    setActive,
  };
}
