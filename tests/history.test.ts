import { expect, it } from 'vitest';
import { historySessions } from '../src/background/history';
import type { Job } from '../src/shared/types';
it('groups revisions with their own tool traces and omits previews and expired sessions', () => {
  const job = {
    id: 'a',
    tabId: 1,
    createdAt: 1000,
    mode: 'compose',
    brief: 'Idea',
    draft: 'First',
    status: 'done',
  } as Job;
  const next = {
    ...job,
    id: 'b',
    sessionId: 'a',
    createdAt: 2000,
    brief: undefined,
    refinement: { instruction: 'Shorter', currentDraft: 'First' },
    draft: 'Second',
    toolCalls: [
      { id: 'tool', name: 'web_search', arguments: '{}', status: 'done', startedAt: 2000 },
    ],
  } as Job;
  const result = historySessions(
    [next, job, { ...job, id: 'preview', tabId: -1 }, { ...job, id: 'old', createdAt: -100000000 }],
    3000,
  );
  expect(result).toHaveLength(1);
  expect(result[0].turns.map((t) => t.text)).toEqual(['Idea', 'First', 'Shorter', 'Second']);
  expect(result[0].toolCalls[0].jobId).toBe('b');
});
