// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { inlineDrawing } from '../src/sidepanel/inline-drawing';
import type { Artifact, ArtifactVersion } from '../src/artifacts/types';
const artifact: Artifact = {
  id: 'd',
  kind: 'diagram',
  title: 'Latest title',
  versions: [],
  cursor: -1,
};
const version: ArtifactVersion = {
  id: 'v1',
  title: 'Original title',
  createdAt: 1,
  data: { dimension: 2, points: [{ id: 'A', label: 'A', at: [0, 0] }] },
};
it('keeps a valid drawing visible after an open failure and allows retry', async () => {
  let attempts = 0;
  const figure = inlineDrawing(artifact, version, false, async () => {
    attempts++;
    throw new Error('Conversation is unavailable.');
  });
  const button = figure.querySelector('button')!;
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(figure.querySelector('svg')).not.toBeNull();
  expect(figure.querySelector('[role="status"]')?.textContent).toBe('Conversation is unavailable.');
  expect(button.disabled).toBe(false);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(attempts).toBe(2);
});
it('contains a malformed saved drawing without breaking the rest of the conversation', () => {
  const figure = inlineDrawing(
    artifact,
    { ...version, data: { dimension: 2, points: [{ id: 'A', midpoint: ['missing', 'other'] }] } },
    false,
    async () => {},
  );
  expect(figure.querySelector('svg')).toBeNull();
  expect(figure.querySelector('[role="status"]')?.textContent).toContain(
    'Drawing preview is unavailable',
  );
  expect(figure.querySelector('button')!.disabled).toBe(false);
});
