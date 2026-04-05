import { signal, effect } from "@blueshed/railroad";
import { icon } from "../icon";
import type { Flag } from "../graph-api";

const flags = signal<Flag[]>([]);

export function updateFlags(newFlags: Flag[]) {
  flags.set(newFlags);
}

export function FlagsBar() {
  const container = <div class="flags-bar" /> as HTMLDivElement;

  effect(() => {
    container.innerHTML = "";
    for (const f of flags.get()) {
      const iconName = f.status === "pass" ? "check-circle" : f.status === "fail" ? "x-circle" : "circle";
      const el = <span class={`flag ${f.status}`} /> as HTMLSpanElement;
      el.appendChild(icon(iconName, 14, { "stroke-width": "1.75" }));
      el.appendChild(<span>{f.name}</span> as HTMLSpanElement);
      container.appendChild(el);
    }
  });

  return container;
}
