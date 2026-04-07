/** True when PLANTUML_URL is set — diagrams served from /diagram/ endpoints */
let _plantuml = false;
try { _plantuml = !!process.env.PLANTUML_URL; } catch {}
export const USE_PLANTUML = _plantuml;
