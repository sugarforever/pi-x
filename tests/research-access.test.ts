import { it, expect } from 'vitest';
import { sessionTools } from '../src/background/research-access';
it('makes every tool available in every session without prompt or settings opt-ins', () => {
  expect(sessionTools()).toEqual(['articles', 'context', 'voice', 'search']);
  const tools = sessionTools();
  tools.pop();
  expect(sessionTools()).toHaveLength(4);
});

it('respects explicit intent tools and the global context preference', () => {
  expect(sessionTools(['voice', 'context'], false)).toEqual(['voice']);
  expect(sessionTools([], true)).toEqual([]);
});
