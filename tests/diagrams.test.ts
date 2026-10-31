import { afterEach, expect, it, vi } from 'vitest';
import { commitDiagram, selectDiagram, moveLabel, DiagramStore } from '../src/background/diagrams';
const triangle = {
  dimension: 2,
  points: [
    { id: 'A', at: [0, 0] },
    { id: 'B', at: [6, 0] },
    { id: 'C', at: [0, 8] },
  ],
  segments: [
    { a: 'A', b: 'B' },
    { a: 'A', b: 'C' },
    { a: 'B', b: 'C' },
  ],
  constraints: [{ kind: 'distance', a: 'A', b: 'B', value: 6 }],
};
afterEach(() => vi.unstubAllGlobals());
it('validates edits atomically and retries committed tool operations without adding duplicate versions', () => {
  const first = commitDiagram(undefined, triangle, 'call1');
  expect(first.cursor).toBe(0);
  expect(() =>
    commitDiagram(
      first,
      { ...triangle, constraints: [{ kind: 'distance', a: 'A', b: 'B', value: 7 }] },
      'bad',
    ),
  ).toThrow(/constraint/i);
  expect(first.versions).toHaveLength(1);
  const second = commitDiagram(
    first,
    {
      ...triangle,
      points: [...triangle.points, { id: 'M', midpoint: ['B', 'C'] }],
      segments: [...triangle.segments, { a: 'A', b: 'M', dashed: true }],
    },
    'call2',
  );
  expect(second.versions).toHaveLength(2);
  expect(commitDiagram(second, triangle, 'call1')).toEqual(second);
  expect(selectDiagram(second, 0).versions[0].spec).toEqual(triangle);
  expect(() => selectDiagram(second, 99)).toThrow();
});
it('keeps recoverable versions after undo and validates label movement separately from geometry', () => {
  const doc = commitDiagram(undefined, triangle, 'one');
  const moved = moveLabel(doc, 'A', [22, -16]);
  expect(moved.versions[0].labels.A).toEqual([22, -16]);
  expect(doc.versions[0].labels.A).toBeUndefined();
  expect(() => moveLabel(doc, 'missing', [1, 2])).toThrow();
  expect(() => moveLabel(doc, 'A', [Infinity, 0])).toThrow();
  expect(selectDiagram(doc, -1).cursor).toBe(-1);
  expect(selectDiagram(doc, 0).cursor).toBe(0);
});
it('bounds history while retaining stable version identities', () => {
  let doc = commitDiagram(undefined, triangle, '0');
  for (let i = 1; i < 30; i++)
    doc = commitDiagram(doc, { ...triangle, title: `Study ${i}` }, String(i));
  expect(doc.versions).toHaveLength(24);
  expect(doc.versions.at(-1)?.id).toBe('29');
  expect(doc.versions[0].id).toBe('6');
  expect(doc.cursor).toBe(23);
});
it('persists diagrams independently of page records and deletes them with their conversation', async () => {
  const data: Record<string, any> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: structuredClone(data[key]) }),
        set: async (value: any) => Object.assign(data, structuredClone(value)),
        remove: async (key: string) => {
          delete data[key];
        },
      },
    },
  });
  vi.stubGlobal('navigator', { locks: { request: async (_key: string, fn: any) => fn() } });
  const store = new DiagramStore();
  await store.draw('chat', triangle, 'draw');
  expect((await store.get('chat'))?.versions[0].spec).toEqual(triangle);
  await store.select('chat', -1);
  expect((await store.get('chat'))?.cursor).toBe(-1);
  await store.select('chat', 0);
  await store.label('chat', 'A', [20, 5]);
  expect((await store.get('chat'))?.versions[0].labels.A).toEqual([20, 5]);
  await store.delete('chat');
  expect(await store.get('chat')).toBeUndefined();
});
it('remembers no-op and trimmed drawing operations independently of the visible version history', () => {
  let doc = commitDiagram(undefined, triangle, 'original');
  doc = commitDiagram(doc, triangle, 'noop');
  const empty = selectDiagram(doc, -1);
  expect(commitDiagram(empty, triangle, 'noop').cursor).toBe(-1);
  for (let i = 0; i < 30; i++)
    doc = commitDiagram(doc, { ...triangle, title: `Version ${i}` }, `next-${i}`);
  const latest = doc.versions.at(-1)?.id;
  expect(commitDiagram(doc, triangle, 'original').versions.at(-1)?.id).toBe(latest);
});
