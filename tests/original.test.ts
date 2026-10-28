import { it, expect } from 'vitest';
import { originalInput } from '../src/background/original';
import { defaultSettings } from '../src/shared/settings';
import { refinementJob } from '../src/background/refinement';
import type { Job } from '../src/shared/types';
it('uses a writing preset rather than a quote translation for original briefs', () => {
  const r = originalInput('  My idea  ', 'compose-original', defaultSettings().prompts);
  expect(r.brief).toBe('My idea');
  expect(r.prompt.instructions).toContain('original tweet');
  for (const input of [undefined, '', ' ', 'x'.repeat(4001)])
    expect(() => originalInput(input, 'compose-original', [])).toThrow();
  expect(() => originalInput('My idea', 'missing', [])).toThrow();
});
it('retains original mode and brief through refinement without inventing a source post', () => {
  const parent = {
    id: 'j',
    tabId: 5,
    documentId: 'd',
    composerId: 'c',
    mode: 'compose',
    brief: 'My idea',
    status: 'done',
    prompt: originalInput('My idea', 'compose-original', []).prompt,
  } as Job;
  const r = refinementJob(
    parent,
    { composerId: 'c', refinement: { instruction: 'Shorter', currentDraft: 'Draft' } },
    { tab: { id: 5 }, documentId: 'd' },
  );
  expect(r).toMatchObject({ mode: 'compose', brief: 'My idea', sessionId: 'j' });
  expect(r.post).toBeUndefined();
});
