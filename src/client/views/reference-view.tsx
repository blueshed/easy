import { signal, effect } from "@blueshed/railroad";

const content = signal("");

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function inlineMd(t: string): string {
  return esc(t)
    .replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

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

function render(container: HTMLDivElement) {
  const md = content.get();
  if (!md) {
    container.innerHTML = '<p class="list-empty">loading reference...</p>';
    return;
  }
  container.innerHTML = renderMarkdown(md);
}

export function ReferenceView() {
  const container = <div class="reference-view" /> as HTMLDivElement;
  effect(() => render(container));
  return container;
}

export function reloadReference() {
  fetch("/api/reference").then((r) => r.text()).then((md) => content.set(md)).catch(() => {});
}

// initial load
reloadReference();
