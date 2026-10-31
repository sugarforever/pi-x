// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { PinnedArtifactPreview } from '../src/sidepanel/pinned-artifact';
import { createArtifact, reviseArtifact } from '../src/background/artifacts';
import { emptyArtifacts } from '../src/artifacts/types';
afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('style[data-pip-test]').forEach((n) => n.remove());
});
it('uses a pinned window, reuses it, updates revisions, and closes on conversation change', async () => {
  const style = document.createElement('style');
  style.dataset.pipTest = '';
  style.textContent = '.artifact-pip { display: flex; }';
  document.head.append(style);
  const doc = document.implementation.createHTMLDocument('');
  const listeners = new Map<string, () => void>();
  const popup = {
    document: doc,
    closed: false,
    focus: vi.fn(),
    close: vi.fn(),
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
  };
  const requestWindow = vi.fn(async () => popup);
  const api = { requestWindow };
  const actions = vi.fn();
  const visibility = vi.fn();
  const preview = new PinnedArtifactPreview(actions, api as any, visibility);
  preview.close();
  expect(visibility).not.toHaveBeenCalled();
  const collection = createArtifact(
    emptyArtifacts(),
    { kind: 'document', title: 'Notes', data: { markdown: '# First' } },
    'v1',
    'notes',
  );
  expect(await preview.open('chat', collection, false)).toBe(true);
  expect(requestWindow).toHaveBeenCalledOnce();
  expect(visibility.mock.calls).toEqual([[true]]);
  expect(doc.querySelector('h1')?.textContent).toBe('First');
  expect(doc.head.querySelector('style')?.textContent).toContain('display: flex');
  const revised = reviseArtifact(collection, 'notes', 'v1', { markdown: '# Revised' }, 'v2');
  preview.update('chat', revised, false);
  expect(doc.querySelector('h1')?.textContent).toBe('Revised');
  await preview.open('chat', revised, false);
  expect(requestWindow).toHaveBeenCalledOnce();
  expect(visibility.mock.calls).toEqual([[true]]);
  expect(popup.focus).toHaveBeenCalledOnce();
  preview.update('other', undefined, false);
  expect(popup.close).toHaveBeenCalledOnce();
  expect(visibility.mock.calls).toEqual([[true], [false]]);
  expect(await preview.open('chat', collection, false)).toBe(true);
  expect(requestWindow).toHaveBeenCalledTimes(2);
  listeners.get('pagehide')!();
  preview.close();
  expect(visibility.mock.calls).toEqual([[true], [false], [true], [false]]);
  await preview.open('chat', collection, false);
  expect(requestWindow).toHaveBeenCalledTimes(3);
});
it('reports unsupported browsers without opening an ordinary window', async () => {
  const visibility = vi.fn();
  const preview = new PinnedArtifactPreview(() => {}, undefined, visibility);
  expect(await preview.open('chat', emptyArtifacts(), false)).toBe(false);
  expect(visibility).not.toHaveBeenCalled();
});
it('discards a window if the conversation changes while opening it', async () => {
  let resolve!: (w: any) => void;
  const popup = { close: vi.fn() };
  const preview = new PinnedArtifactPreview(() => {}, {
    requestWindow: () => new Promise((r) => (resolve = r)),
  } as any);
  const opening = preview.open('chat', emptyArtifacts(), false);
  preview.update('other', undefined, false);
  resolve(popup);
  await opening;
  expect(popup.close).toHaveBeenCalledOnce();
});

it('times out a nonresponsive PiP request and closes a late window', async () => {
  vi.useFakeTimers();
  try {
    let resolve!: (value: any) => void;
    const preview = new PinnedArtifactPreview(() => {}, {
      requestWindow: () => new Promise((r) => (resolve = r)),
    } as any);
    const opening = preview.open('chat', emptyArtifacts(), false);
    const failure = expect(opening).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1500);
    await failure;
    const late = { close: vi.fn() };
    resolve(late);
    await Promise.resolve();
    await Promise.resolve();
    expect(late.close).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
