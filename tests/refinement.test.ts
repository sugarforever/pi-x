import { it, expect } from 'vitest';
import { refinementJob } from '../src/background/refinement';
import type { Job } from '../src/shared/types';
const parent = {
  id: 'initial',
  composerId: 'composer',
  tabId: 5,
  documentId: 'doc',
  status: 'done',
  post: { id: '1' },
  prompt: { id: 'p' },
} as Job;
const sender = { tab: { id: 5 }, documentId: 'doc' };
const request = {
  composerId: 'composer',
  refinement: { instruction: 'Shorter', currentDraft: 'My text' },
};
it('uses the owned completed session and keeps the original prompt', () => {
  const result = refinementJob(parent, request, sender);
  expect(result.sessionId).toBe('initial');
  expect(result.refinement).toEqual(request.refinement);
  expect(result.prompt).toEqual(parent.prompt);
  expect(refinementJob({ ...parent, sessionId: 'root' }, request, sender).sessionId).toBe('root');
});
it('rejects cross-document, composer and unfinished parents and oversized inputs', () => {
  expect(() => refinementJob(parent, request, { tab: { id: 6 }, documentId: 'doc' })).toThrow();
  expect(() => refinementJob(parent, request, { tab: { id: 5 }, documentId: 'other' })).toThrow();
  expect(() => refinementJob(parent, { ...request, composerId: 'other' }, sender)).toThrow();
  expect(() => refinementJob({ ...parent, status: 'running' }, request, sender)).toThrow();
  for (const refinement of [
    { instruction: ' ', currentDraft: '' },
    { instruction: 'a'.repeat(4001), currentDraft: '' },
    { instruction: 'a', currentDraft: 'a'.repeat(40001) },
    null,
  ])
    expect(() => refinementJob(parent, { ...request, refinement }, sender)).toThrow();
});
