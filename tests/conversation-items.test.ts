import { expect, it } from 'vitest';
import { conversationItems } from '../src/sidepanel/conversation-items';
it('places each tool group after its request and before its answer, including a running round', () => {
  const items = conversationItems(
    [
      { id: 'a1', role: 'agent', text: 'Initial', jobId: 'j1' },
      { id: 'u2', role: 'user', text: 'Research', jobId: 'j2' },
      { id: 'a2', role: 'agent', text: 'Result', jobId: 'j2' },
      { id: 'u3', role: 'user', text: 'Check again', jobId: 'j3' },
    ],
    ['j1', 'j2', 'j3'].map((jobId) => ({
      id: `${jobId}:call`,
      jobId,
      name: 'web_search',
      arguments: '{}',
      status: 'done' as const,
      startedAt: 0,
    })),
  );
  expect(items.map((item) => (item.kind === 'turn' ? item.turn.id : item.jobId))).toEqual([
    'j1',
    'a1',
    'u2',
    'j2',
    'a2',
    'u3',
    'j3',
  ]);
});
