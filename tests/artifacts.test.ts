import { afterEach, expect, it, vi } from 'vitest';
import {
  createArtifact,
  reviseArtifact,
  selectArtifact,
  removeArtifact,
  ArtifactStore,
} from '../src/background/artifacts';
import { currentArtifactVersion } from '../src/artifacts/types';
const empty = { items: [], operations: [] };
afterEach(() => vi.unstubAllGlobals());
it('keeps multiple stable artifact identities and independent immutable revisions', () => {
  const first = createArtifact(
    empty,
    { kind: 'document', title: 'Solution notes', data: { markdown: '# Given\nA triangle' } },
    'create-1',
    'notes',
  );
  const second = createArtifact(
    first,
    { kind: 'code', title: 'Example', data: { code: 'print(1)', language: 'python' } },
    'create-2',
    'code',
  );
  const third = reviseArtifact(
    second,
    'notes',
    'create-1',
    { markdown: '# Given\nA right triangle' },
    'edit-1',
  );
  expect(third.items.map((a) => a.id)).toEqual(['notes', 'code']);
  expect(third.items[0].versions).toHaveLength(2);
  expect(first.items[0].versions[0].data).toEqual({ markdown: '# Given\nA triangle' });
  expect(currentArtifactVersion(third.items[1])?.data).toEqual({
    code: 'print(1)',
    language: 'python',
  });
  expect(() => reviseArtifact(third, 'notes', 'create-1', { markdown: 'stale' }, 'bad')).toThrow(
    /changed|stale/i,
  );
  expect(currentArtifactVersion(selectArtifact(third, 'notes', 'create-1').items[0])?.id).toBe(
    'create-1',
  );
});
it('rejects invalid content atomically and does not replay old or deleted operations', () => {
  const created = createArtifact(
    empty,
    { kind: 'document', title: 'Notes', data: { markdown: 'A' } },
    'create',
    'notes',
  );
  const unchanged = reviseArtifact(created, 'notes', 'create', { markdown: 'A' }, 'noop');
  const edited = reviseArtifact(unchanged, 'notes', 'create', { markdown: 'B' }, 'edit');
  expect(reviseArtifact(edited, 'notes', 'create', { markdown: 'A' }, 'noop')).toEqual(edited);
  const removed = removeArtifact(edited, 'notes');
  expect(
    createArtifact(
      removed,
      { kind: 'document', title: 'Notes', data: { markdown: 'A' } },
      'create',
      'notes',
    ),
  ).toEqual(removed);
  expect(() =>
    createArtifact(
      empty,
      { kind: 'code', title: 'Code', data: { code: 'x', language: 'javascript<script>' } },
      'bad',
      'code',
    ),
  ).toThrow();
  expect(() =>
    createArtifact(
      empty,
      {
        kind: 'diagram',
        title: 'Bad geometry',
        data: { dimension: 2, points: [{ id: 'A', at: [NaN, 0] }] },
      },
      'bad',
      'drawing',
    ),
  ).toThrow();
});
it('migrates existing drawing versions and label positions into the shared collection', async () => {
  const legacy = {
    cursor: 0,
    versions: [
      {
        id: 'old',
        spec: { dimension: 2, points: [{ id: 'A', at: [0, 0] }] },
        createdAt: 1,
        labels: { A: [20, 10] },
      },
    ],
    operations: ['old'],
  };
  const data: Record<string, any> = { 'diagram:chat': legacy };
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
        set: async (v: any) => Object.assign(data, structuredClone(v)),
        remove: async (key: string) => {
          delete data[key];
        },
      },
    },
  });
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, fn: any) => fn() } });
  const store = new ArtifactStore();
  const collection = await store.get('chat');
  expect(collection.items[0]).toMatchObject({ id: 'diagram', kind: 'diagram', cursor: 0 });
  expect(collection.items[0].versions[0].view?.labels.A).toEqual([20, 10]);
  await store.create(
    'chat',
    { kind: 'document', title: 'Notes', data: { markdown: 'Hello' } },
    'new',
    'notes',
  );
  expect(data['diagram:chat']).toBeUndefined();
  expect((await store.get('chat')).items).toHaveLength(2);
  const observed = collection.items[0].versions[0];
  await store.revise(
    'chat',
    'diagram',
    observed.id,
    { dimension: 2, points: [{ id: 'A', at: [1, 0] }] },
    'intervening',
  );
  await expect(
    store.draw('chat', observed.data, 'stale-drawing', 'diagram', observed.id),
  ).rejects.toThrow(/changed|stale/i);
  expect(currentArtifactVersion((await store.get('chat')).items[0])?.id).toBe('intervening');
  await store.deleteConversation('chat');
  expect((await store.get('chat')).items).toEqual([]);
});
