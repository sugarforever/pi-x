import { it, expect } from 'vitest';
import { JobManager, ownsJob } from '../src/background/jobs';
import type { Job } from '../src/shared/types';
const job = (): Job => ({
  id: 'j1',
  tabId: 7,
  documentId: 'doc1',
  composerId: 'c1',
  post: { id: '123', url: 'https://x.com/a/status/123', text: 'Hello', author: 'a', links: [] },
  prompt: { id: 'p', name: 'P', instructions: 'Translate', tools: [] },
  status: 'running',
  progress: 'Writing',
  createdAt: Date.now(),
});
it('does not publish a late result after cancellation', async () => {
  const records = new Map<string, Job>();
  let finish!: (s: string) => void;
  const manager = new JobManager(
    {
      get: async (id) => records.get(id),
      put: async (j) => {
        records.set(j.id, structuredClone(j));
      },
    },
    async () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const j = job();
  await manager.save(j);
  const work = manager.run(j);
  await new Promise((r) => setTimeout(r, 0));
  await manager.cancel(j.id);
  finish('Late draft');
  await work;
  expect(records.get(j.id)?.status).toBe('cancelled');
  expect(records.get(j.id)?.draft).toBeUndefined();
});
it('isolates drafts by source document as well as tab', () => {
  expect(ownsJob(job(), { tab: { id: 7 }, documentId: 'doc1' })).toBe(true);
  expect(ownsJob(job(), { tab: { id: 7 }, documentId: 'doc2' })).toBe(false);
  expect(ownsJob(job(), { tab: { id: 8 }, documentId: 'doc1' })).toBe(false);
});
it('deduplicates concurrent resume requests', async () => {
  const records = new Map<string, Job>();
  let calls = 0;
  const manager = new JobManager(
    {
      get: async (id) => records.get(id),
      put: async (j) => {
        records.set(j.id, structuredClone(j));
      },
    },
    async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return 'Draft';
    },
  );
  const j = job();
  await manager.save(j);
  await Promise.all([manager.run(j), manager.run(j)]);
  expect(calls).toBe(1);
  expect(records.get(j.id)?.draft).toBe('Draft');
});
it('serializes a stale progress write against cancellation with cloned storage values', async () => {
  const records = new Map<string, Job>();
  let publish!: (text: string) => Promise<void>;
  let finish!: (s: string) => void;
  let release!: () => void;
  let blocked = false;
  const manager = new JobManager(
    {
      get: async (id) => {
        const j = records.get(id);
        return j ? structuredClone(j) : undefined;
      },
      put: async (j) => {
        if (j.progress === 'late' && !blocked) {
          blocked = true;
          await new Promise<void>((r) => {
            release = r;
          });
        }
        records.set(j.id, structuredClone(j));
      },
    },
    async (_j, _signal, progress) => {
      publish = progress;
      return new Promise((r) => {
        finish = r;
      });
    },
  );
  const j = job();
  await manager.save(j);
  const run = manager.run(j);
  await new Promise((r) => setTimeout(r, 0));
  const progress = publish('late');
  await new Promise((r) => setTimeout(r, 0));
  const cancel = manager.cancel(j.id);
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all([progress, cancel]);
  finish('Should not appear');
  await run;
  expect(records.get(j.id)?.status).toBe('cancelled');
});
