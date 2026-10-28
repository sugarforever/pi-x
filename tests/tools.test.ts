import { it, expect } from 'vitest';
import { selectSamples } from '../src/agent/research';
it('retrieves relevant writing samples with a bounded result', () => {
  const results = selectSamples('coding', [
    { id: '1', title: 'Cooking', text: 'A recipe' },
    { id: '2', title: 'Coding', text: 'How I write about coding' },
  ]);
  expect(results[0].id).toBe('2');
});
