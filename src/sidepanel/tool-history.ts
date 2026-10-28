import type { ToolTrace } from '../shared/types';
export function renderToolHistory(traces: ToolTrace[], expanded: Set<string>, groupId = 'all') {
  const details = (id: string, label: string) => {
    const node = document.createElement('details');
    node.open = expanded.has(id);
    const summary = document.createElement('summary');
    summary.textContent = label;
    node.append(summary);
    node.addEventListener('toggle', () => {
      if (node.open) expanded.add(id);
      else expanded.delete(id);
    });
    return node;
  };
  const running = traces.filter((trace) => trace.status === 'running').length;
  const root = details(
    groupId,
    `Tools · ${traces.length}${running ? ` · ${running} running` : ''}`,
  );
  root.className = 'tool-history';
  root.dataset.jobId = groupId;
  for (const trace of traces) {
    const elapsed = trace.finishedAt
      ? ` · ${((trace.finishedAt - trace.startedAt) / 1000).toFixed(1)}s`
      : '';
    const entry = details(trace.id, `${trace.name} · ${trace.status}${elapsed}`);
    entry.className = 'tool-entry';
    entry.dataset.status = trace.status;
    for (const [label, value] of [
      ['Parameters', trace.arguments],
      ['Result', trace.output],
    ]) {
      if (value === undefined) continue;
      const title = document.createElement('div');
      title.className = 'tool-label';
      title.textContent = label!;
      const pre = document.createElement('pre');
      pre.textContent = value!;
      entry.append(title, pre);
    }
    root.append(entry);
  }
  return root;
}
