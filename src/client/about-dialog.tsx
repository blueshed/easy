import { signal } from "@blueshed/railroad";
import { icon } from "./icon";

type Stats = { total: number; done: number; inProgress: number; pending: number; memories: number };

const stats = signal<Stats | null>(null);

async function loadStats() {
  const [taskData, memData] = await Promise.all([
    fetch("/api/tasks").then((r) => r.json()).catch(() => ({ tasks: [] })),
    fetch("/api/memories").then((r) => r.json()).catch(() => []),
  ]);
  const tasks = taskData.tasks ?? [];
  stats.set({
    total: tasks.length,
    done: tasks.filter((t: any) => t.status === "done").length,
    inProgress: tasks.filter((t: any) => t.status === "in_progress").length,
    pending: tasks.filter((t: any) => t.status === "pending").length,
    memories: memData.length,
  });
}

let dialogEl: HTMLDialogElement | null = null;

export function showAbout() {
  if (!dialogEl) {
    dialogEl = <dialog class="about-dialog">
      <div class="about-header">
        {icon("zap", 24, { "stroke-width": "1.5" })}
        <div>
          <h2>easy</h2>
          <p class="about-version">model + dev tools</p>
        </div>
      </div>
      <dl class="about-stats">
        <dt>tasks</dt><dd id="about-total">&mdash;</dd>
        <dt>done</dt><dd id="about-done">&mdash;</dd>
        <dt>in progress</dt><dd id="about-active">&mdash;</dd>
        <dt>pending</dt><dd id="about-pending">&mdash;</dd>
        <dt>memories</dt><dd id="about-memories">&mdash;</dd>
      </dl>
      <button class="about-close" onclick={() => dialogEl!.close()}>cool</button>
    </dialog> as HTMLDialogElement;
    document.body.appendChild(dialogEl);
  }

  loadStats().then(() => {
    const s = stats.peek();
    if (s) {
      document.getElementById("about-total")!.textContent = String(s.total);
      document.getElementById("about-done")!.textContent = String(s.done);
      document.getElementById("about-active")!.textContent = String(s.inProgress);
      document.getElementById("about-pending")!.textContent = String(s.pending);
      document.getElementById("about-memories")!.textContent = String(s.memories);
    }
  });

  dialogEl.showModal();
}
