export const SVG_NS = "http://www.w3.org/2000/svg";

export function el(tag: string, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string)[]): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) {
    if (typeof c === "string") e.textContent = c;
    else e.appendChild(c);
  }
  return e;
}
