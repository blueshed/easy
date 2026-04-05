export type StatusStyle = {
  fill: string;
  stroke: string;
  text: string;
  dot: string;
};

export type Theme = {
  gridDot: string;
  descText: string;
  emptyText: string;
  pending: StatusStyle;
  in_progress: StatusStyle;
  done: StatusStyle;
  edge: { pending: string; active: string; done: string };
  arrow: { pending: string; active: string; done: string };
};

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function theme(): Theme {
  return {
    gridDot: css("--grid-dot"),
    descText: css("--desc-text"),
    emptyText: css("--empty-text"),
    pending:     { fill: css("--node-pending-fill"), stroke: css("--node-pending-stroke"), text: css("--node-pending-text"), dot: css("--node-pending-dot") },
    in_progress: { fill: css("--node-active-fill"),  stroke: css("--node-active-stroke"),  text: css("--node-active-text"),  dot: css("--node-active-dot") },
    done:        { fill: css("--node-done-fill"),     stroke: css("--node-done-stroke"),     text: css("--node-done-text"),     dot: css("--node-done-dot") },
    edge:        { pending: css("--edge-pending"), active: css("--edge-active"), done: css("--edge-done") },
    arrow:       { pending: css("--arrow-pending"), active: css("--arrow-active"), done: css("--arrow-done") },
  };
}
