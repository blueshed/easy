export function EmptyState(title: string, command: string): HTMLElement {
  return (
    <div class="empty-state">
      <p class="empty-title">{title}</p>
      <code class="empty-hint">{command}</code>
    </div>
  ) as HTMLElement;
}
