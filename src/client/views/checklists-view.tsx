import { signal, effect } from "@blueshed/railroad";
import { route, navigate } from "@blueshed/railroad/routes";
import { toast } from "../toast";
import { EmptyState } from "../empty-state";

interface ChecklistItem {
  name: string; description: string;
  total: number; api: number; ux: number; done: number;
}

interface CheckDetail {
  name: string; description: string;
  checks: {
    id: number; seq: number; actor: string; action: string;
    method: string | null; description: string;
    confirmed: number; depends_on: number[];
  }[];
}

const checklists = signal<ChecklistItem[]>([]);
const detail = signal<CheckDetail | null>(null);
const revision = signal(0);
const checkRoute = route<{ "*": string }>("/checklists/*");

// Fetch detail when route or data revision changes
effect(() => {
  revision.get();
  const match = checkRoute.get();
  if (!match) return; // not on checklists tab
  const name = match["*"];
  if (name) {
    detail.set(null);
    fetch(`/api/checklists/${encodeURIComponent(name)}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((d) => detail.set(d))
      .catch(() => {
        toast(`Checklist "${name}" not found`);
        const list = checklists.peek();
        if (list.length) navigate(`/checklists/${list[0].name}`);
      });
  } else {
    detail.set(null);
    const list = checklists.peek();
    if (list.length) navigate(`/checklists/${list[0].name}`);
  }
});

function render(container: HTMLDivElement) {
  container.innerHTML = "";
  const list = checklists.get();
  const sel = checkRoute.get()?.["*"] ?? "";
  const det = detail.get();

  if (!list.length) {
    container.appendChild(EmptyState("No checklists", "bun model save checklist '{\"name\":\"...\",\"checks\":[{\"actor\":\"...\",\"method\":\"...\"}]}'"));
    return;
  }

  const sidebar = <div class="list-sidebar" /> as HTMLDivElement;
  for (const cl of list) {
    const cls = "list-item" + (cl.name === sel ? " active" : "");
    const pct = cl.total > 0 ? Math.round((cl.done / cl.total) * 100) : 0;
    const item = <div class={cls} onclick={() => navigate(`/checklists/${cl.name}`)} /> as HTMLDivElement;
    item.appendChild(<span class="list-item-name">{cl.name}</span>);
    item.appendChild(<span class="list-item-tags"><span class="checklist-pct">{cl.done}/{cl.total} ({pct}%)</span></span>);
    sidebar.appendChild(item);
  }
  container.appendChild(sidebar);

  if (sel && det) {
    const pane = <div class="detail-pane" /> as HTMLDivElement;
    pane.appendChild(<h3 class="detail-title">{det.name}</h3>);

    if (det.description) {
      pane.appendChild(<p class="detail-desc">{det.description}</p>);
    }

    const cl = list.find((c) => c.name === sel);
    if (cl) {
      const pct = cl.total > 0 ? Math.round((cl.done / cl.total) * 100) : 0;
      pane.appendChild(
        <div class="checklist-progress">
          <div class="checklist-bar-wrap">
            <div class="checklist-bar" style={`width:${pct}%`} />
          </div>
          <span class="checklist-stats">api: {cl.api}/{cl.total} &nbsp; ux: {cl.ux}/{cl.total} &nbsp; done: {cl.done}/{cl.total}</span>
        </div>
      );
    }

    if (det.checks?.length) {
      const idToSeq: Record<number, number> = {};
      det.checks.forEach((ck) => { idToSeq[ck.id] = ck.seq; });

      const checks = <div class="checks-list" /> as HTMLDivElement;
      for (const ck of det.checks) {
        const apiOk = ck.confirmed & 1;
        const uxOk = ck.confirmed & 2;
        const fullyDone = ck.confirmed === 3;
        const cls = "check-item" + (fullyDone ? " confirmed" : "") + (ck.action === "denied" ? " denied" : "");

        const item = <div class={cls} /> as HTMLDivElement;
        const top = <div class="check-row-top" /> as HTMLDivElement;
        top.appendChild(
          <span class="check-bits">
            <span class={"check-bit" + (apiOk ? " ok" : "")}>A</span>
            <span class={"check-bit" + (uxOk ? " ok" : "")}>U</span>
          </span>
        );
        top.appendChild(<span class="check-seq">{ck.seq}</span>);
        top.appendChild(<span class="check-actor">{ck.actor}</span>);
        top.appendChild(<span class="check-action">{ck.action === "denied" ? "DENIED" : "CAN"}</span>);
        if (ck.method) {
          top.appendChild(<a href={`#/entities/${ck.method.split(".")[0]}`} class="check-method">{ck.method}</a>);
        }
        if (ck.depends_on.length) {
          top.appendChild(<span class="check-deps">after step {ck.depends_on.map((id) => idToSeq[id] || id).join(", ")}</span>);
        }
        item.appendChild(top);

        if (ck.description) {
          item.appendChild(<div class="check-row-desc">{ck.description}</div>);
        }
        checks.appendChild(item);
      }
      pane.appendChild(checks);
    }

    container.appendChild(pane);
  }
}

export function ChecklistsView() {
  const container = <div class="split-view" /> as HTMLDivElement;
  effect(() => render(container));
  return container;
}

export function reloadChecklists() {
  fetch("/api/checklists").then((r) => r.json()).catch(() => []).then((list) => {
    checklists.set(list);
    revision.set(revision.peek() + 1);
  });
}

reloadChecklists();
