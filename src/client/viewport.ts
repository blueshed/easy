export type ViewportControls = {
  zoomIn(): void;
  zoomOut(): void;
  fitToView(): void;
  setSize(w: number, h: number): void;
};

export function viewport(svgEl: SVGSVGElement): ViewportControls {
  let naturalW = 500, naturalH = 300;
  let zoom = 1, panX = 0, panY = 0;

  function applyView() {
    const w = naturalW / zoom;
    const h = naturalH / zoom;
    svgEl.setAttribute("viewBox", `${panX} ${panY} ${w} ${h}`);
  }

  // drag-to-pan
  let dragging = false, dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  svgEl.addEventListener("pointerdown", (e) => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    panStartX = panX;
    panStartY = panY;
    svgEl.style.cursor = "grabbing";
    svgEl.setPointerCapture(e.pointerId);
  });

  svgEl.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = svgEl.getBoundingClientRect();
    const scaleX = (naturalW / zoom) / rect.width;
    const scaleY = (naturalH / zoom) / rect.height;
    panX = panStartX - (e.clientX - dragStartX) * scaleX;
    panY = panStartY - (e.clientY - dragStartY) * scaleY;
    applyView();
  });

  svgEl.addEventListener("pointerup", () => {
    dragging = false;
    svgEl.style.cursor = "";
  });

  return {
    zoomIn()  { zoom = Math.min(zoom * 1.25, 5); applyView(); },
    zoomOut() { zoom = Math.max(zoom / 1.25, 0.2); applyView(); },
    fitToView() { zoom = 1; panX = 0; panY = 0; svgEl.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`); },
    setSize(w: number, h: number) {
      const isInitial = naturalW === 500 && naturalH === 300;
      naturalW = w; naturalH = h;
      if (isInitial) { svgEl.setAttribute("viewBox", `0 0 ${w} ${h}`); }
      else { applyView(); }
    },
  };
}
