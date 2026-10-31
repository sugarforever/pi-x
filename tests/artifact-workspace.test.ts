// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { ArtifactWorkspace } from '../src/sidepanel/artifact-workspace';
import { createArtifact, reviseArtifact, selectArtifact } from '../src/background/artifacts';
it('previews multiple artifact kinds, preserves revision identity, and switches safely between preview and source', () => {
  let state = createArtifact(
    { items: [], operations: [] },
    {
      kind: 'document',
      title: 'Notes',
      data: { markdown: '# Triangle\n**Given** <script>bad()</script>' },
    },
    'one',
    'notes',
  );
  state = reviseArtifact(state, 'notes', 'one', { markdown: '# Triangle\nRevised notes' }, 'two');
  state = createArtifact(
    state,
    {
      kind: 'code',
      title: 'Example',
      data: { language: 'javascript', code: '<script>bad()</script>' },
    },
    'code',
    'example',
  );
  const host = document.createElement('section'),
    commands: any[] = [];
  const workspace = new ArtifactWorkspace(host, (c) => {
    commands.push(c);
  });
  workspace.update(selectArtifact(state, 'notes'), false);
  expect(host.querySelector('h1')?.textContent).toBe('Triangle');
  expect(host.querySelectorAll('script')).toHaveLength(0);
  (host.querySelector('[aria-label="Artifact source"]') as HTMLButtonElement).click();
  expect(host.querySelector('pre')?.textContent).toContain('# Triangle');
  (host.querySelector('[aria-label="Undo artifact"]') as HTMLButtonElement).click();
  expect(commands.at(-1)).toEqual({
    action: 'artifact',
    operation: 'version',
    artifactId: 'notes',
    versionId: 'one',
  });
  workspace.update(selectArtifact(state, 'example'), false);
  expect(host.querySelector('code')?.textContent).toBe('<script>bad()</script>');
  expect(host.querySelectorAll('script')).toHaveLength(0);
  const picker = host.querySelector('[aria-label="Artifact"]') as HTMLSelectElement;
  picker.value = 'notes';
  picker.dispatchEvent(new Event('change'));
  expect(commands.at(-1)).toEqual({ action: 'artifact', operation: 'select', artifactId: 'notes' });
});
it('renders Markdown links without accepting script URLs or fetching remote images', () => {
  const state = createArtifact(
    { items: [], operations: [] },
    {
      kind: 'document',
      title: 'Safe notes',
      data: {
        markdown:
          '[unsafe](javascript:alert)\n![remote](https://example.com/image.png)\n[Source](https://example.org/paper)',
      },
    },
    'one',
    'notes',
  );
  const host = document.createElement('section');
  new ArtifactWorkspace(host, () => {}).update(state, false);
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('a[href^="javascript:"]')).toBeNull();
  expect(host.querySelector('a[href="https://example.org/paper"]')).not.toBeNull();
});
