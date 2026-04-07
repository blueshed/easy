/** Fetch a PlantUML-rendered SVG and return the parsed SVGSVGElement. */
export async function fetchSvg(url: string): Promise<SVGSVGElement> {
  const res = await fetch(url);
  const text = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "image/svg+xml");
  return doc.documentElement as unknown as SVGSVGElement;
}

/** Extract natural width/height from an SVG's viewBox or width/height attributes. */
export function svgSize(svg: SVGSVGElement): { w: number; h: number } {
  const vb = svg.getAttribute("viewBox");
  if (vb) {
    const parts = vb.split(/[\s,]+/).map(Number);
    if (parts.length === 4) return { w: parts[2], h: parts[3] };
  }
  const w = parseFloat(svg.getAttribute("width") ?? "500");
  const h = parseFloat(svg.getAttribute("height") ?? "300");
  return { w, h };
}

/**
 * Prepare a PlantUML SVG for embedding inside a viewport-controlled SVG.
 * Wraps all content in a <g> and returns the natural size.
 * The caller should append the <g> to their own SVG and call controls.setSize().
 */
export function prepareSvgContent(svg: SVGSVGElement): { g: SVGGElement; w: number; h: number } {
  const { w, h } = svgSize(svg);
  const NS = "http://www.w3.org/2000/svg";
  const g = document.createElementNS(NS, "g") as SVGGElement;
  while (svg.firstChild) g.appendChild(svg.firstChild);
  return { g, w, h };
}

/** Clean up a PlantUML SVG for direct embedding in a container div. */
export function cleanSvg(svg: SVGSVGElement): SVGSVGElement {
  svg.removeAttribute("width");
  svg.removeAttribute("height");
  svg.removeAttribute("style");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.width = "100%";
  svg.style.maxHeight = "60vh";
  return svg;
}
