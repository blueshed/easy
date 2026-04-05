import feather, { type FeatherIcon, type FeatherIconNames } from "feather-icons";

const NS = "http://www.w3.org/2000/svg";
const parser = new DOMParser();

function get(name: string): FeatherIcon {
  const def = feather.icons[name as FeatherIconNames];
  if (!def) throw new Error(`unknown icon: ${name}`);
  return def;
}

/** Render a feather icon as an SVG element for HTML DOM. */
export function icon(name: string, size = 18, attrs: Record<string, string> = {}): SVGSVGElement {
  const doc = parser.parseFromString(get(name).toSvg({ width: size, height: size, ...attrs }), "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}

/** Define a feather icon as a <symbol> in an SVG's <defs>. Call once per icon per SVG. */
export function defIcon(svg: SVGSVGElement, name: string, id = `icon-${name}`): string {
  if (svg.querySelector(`#${id}`)) return id;
  const def = get(name);
  const symbol = document.createElementNS(NS, "symbol");
  symbol.id = id;
  for (const [k, v] of Object.entries(def.attrs)) symbol.setAttribute(k, String(v));
  const inner = parser.parseFromString(`<svg xmlns="${NS}">${def.contents}</svg>`, "image/svg+xml").documentElement;
  while (inner.firstChild) symbol.appendChild(inner.firstChild);
  let defs = svg.querySelector("defs");
  if (!defs) { defs = document.createElementNS(NS, "defs"); svg.prepend(defs); }
  defs.appendChild(symbol);
  return id;
}

/** Create a <use> referencing a previously defined icon symbol. */
export function useIcon(id: string, x: number, y: number, size = 12, attrs: Record<string, string> = {}): SVGUseElement {
  const use = document.createElementNS(NS, "use");
  use.setAttribute("href", `#${id}`);
  use.setAttribute("x", String(x));
  use.setAttribute("y", String(y));
  use.setAttribute("width", String(size));
  use.setAttribute("height", String(size));
  for (const [k, v] of Object.entries(attrs)) use.setAttribute(k, v);
  return use;
}
