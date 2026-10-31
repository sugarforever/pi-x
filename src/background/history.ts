import type { Job, PageChat } from '../shared/types';
import type { PanelTurn } from '../shared/panel';
export function historySessions(jobs: Job[], now = Date.now(), chats: PageChat[] = []) {
  const records = new Map(chats.map((chat) => [chat.id, chat]));
  const groups = new Map<string, Job[]>();
  for (const job of jobs) {
    if (job.mode !== 'chat' && (job.tabId < 0 || now - job.createdAt > 24 * 60 * 60_000)) continue;
    const id = job.sessionId || job.id;
    const group = groups.get(id) || [];
    group.push(job);
    groups.set(id, group);
  }
  for (const chat of chats) if (!groups.has(chat.id)) groups.set(chat.id, []);
  return [...groups]
    .map(([id, group]) => {
      const chat = records.get(id);
      if (!group.length && chat)
        return {
          id,
          mode: 'chat' as const,
          post: undefined,
          title: chat.title,
          updatedAt: chat.updatedAt,
          status: 'done' as const,
          turns: [] as PanelTurn[],
          toolCalls: [] as NonNullable<Job['toolCalls']>,
        };
      group.sort((a, b) => a.createdAt - b.createdAt);
      const first = group[0],
        last = group.at(-1)!;
      const turns: PanelTurn[] = [];
      for (const job of group) {
        const instruction = job.refinement?.instruction || job.brief;
        if (instruction)
          turns.push({
            id: `${job.id}:user`,
            jobId: job.id,
            role: 'user',
            text: instruction,
            ...(job.mode === 'chat' ? { context: job.pageContext } : {}),
          });
        if (job.draft)
          turns.push({
            id: job.id,
            jobId: job.id,
            role: 'agent',
            text: job.draft,
            status: job.mode === 'chat' ? undefined : 'proposal',
            ...(job.mode === 'chat' ? { context: job.pageContext } : {}),
            promptId: job.prompt.id,
            promptName: job.prompt.name,
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
        title: (
          chat?.title ||
          first.pageContext?.title ||
          first.brief ||
          first.post?.text ||
          first.draft ||
          'Chat'
        ).slice(0, 100),
        updatedAt: chat?.updatedAt || last.createdAt,
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
    .filter((s) => now - s.updatedAt <= 24 * 60 * 60_000)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
}
