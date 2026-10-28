import type { Job } from '../shared/types';
import type { PanelTurn } from '../shared/panel';
export function historySessions(jobs: Job[], now = Date.now()) {
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    if (job.tabId < 0 || now - job.createdAt > 24 * 60 * 60_000) continue;
    const id = job.sessionId || job.id;
    const group = groups.get(id) || [];
    group.push(job);
    groups.set(id, group);
  }
  return [...groups]
    .map(([id, group]) => {
      group.sort((a, b) => a.createdAt - b.createdAt);
      const first = group[0],
        last = group.at(-1)!;
      const turns: PanelTurn[] = [];
      for (const job of group) {
        const instruction = job.refinement?.instruction || job.brief;
        if (instruction)
          turns.push({ id: `${job.id}:user`, jobId: job.id, role: 'user', text: instruction });
        if (job.draft)
          turns.push({
            id: job.id,
            jobId: job.id,
            role: 'agent',
            text: job.draft,
            status: 'proposal',
          });
        else if (job.error)
          turns.push({
            id: job.id,
            jobId: job.id,
            role: 'agent',
            text: job.error,
            status: 'error',
          });
      }
      return {
        id,
        mode: first.mode || 'quote',
        post: first.post,
        title: (first.brief || first.post?.text || first.draft || 'Draft').slice(0, 100),
        updatedAt: last.createdAt,
        status: last.status,
        turns,
        toolCalls: group.flatMap((job) =>
          (job.toolCalls || []).map((trace) => ({
            ...trace,
            id: `${job.id}:${trace.id}`,
            jobId: job.id,
          })),
        ),
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
}
