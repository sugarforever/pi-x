// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { PanelState } from '../src/shared/panel';
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
  document.body.replaceChildren();
  history.replaceState(null, '', location.pathname);
});
async function setup(overrides: Partial<PanelState> = {}, historicalChat = false) {
  vi.useFakeTimers();
  document.documentElement.innerHTML = readFileSync('src/sidepanel/sidepanel.html', 'utf8');
  const dialog = document.getElementById('diagram-expanded') as HTMLDialogElement;
  dialog.showModal = () => {
    dialog.open = true;
  };
  dialog.close = () => {
    dialog.open = false;
  };
  const state: PanelState = {
    composerId: 'c',
    mode: 'quote',
    modelId: 'a',
    post: {
      id: '1',
      url: 'https://x.com/a/status/1',
      author: '@a',
      text: 'Source text',
      links: [],
    },
    currentDraft: '',
    prompts: [{ id: 'p', name: 'My intent' }],
    promptId: 'p',
    busy: false,
    ready: true,
    status: 'Ready',
    turns: [{ id: 'j', jobId: 'j', role: 'agent', text: 'Draft text', status: 'applied' }],
    canUndo: false,
  };
  Object.assign(state, overrides);
  let tabId = 7;
  const messages: any[] = [];
  vi.stubGlobal('chrome', {
    tabs: {
      create: async (options: any) => {
        messages.push({ type: 'tab:create', ...options });
        return { id: 9 };
      },
    },
    windows: {
      getCurrent: async () => ({ id: 42 }),
      create: async (options: any) => {
        messages.push({ ...options, type: 'window:create', windowType: options.type });
        return { id: 99 };
      },
      update: async (id: number, options: any) => {
        messages.push({ type: 'window:update', id, ...options });
        return { id };
      },
    },
    storage: { onChanged: { addListener: vi.fn() } },
    runtime: {
      getURL: (path: string) => `chrome-extension://test/${path}`,
      sendMessage: async (m: any) => {
        messages.push(m);
        if (m.type === 'panel:get')
          return { ok: true, value: { tabId, state: structuredClone(state) } };
        if (m.type === 'settings:public')
          return {
            ok: true,
            value: {
              model: 'alpha',
              models: [
                { id: 'a', model: 'alpha' },
                { id: 'b', model: 'beta' },
              ],
              defaultModelId: 'a',
            },
          };
        if (m.type === 'panel:artifact-history')
          return { ok: true, value: structuredClone(state.artifacts) };
        if (m.type === 'panel:history')
          return {
            ok: true,
            value: [
              {
                id: 's',
                mode: historicalChat ? 'chat' : 'quote',
                title: 'Saved conversation',
                updatedAt: Date.now(),
                turns: [
                  {
                    id: 'saved',
                    jobId: 'j',
                    role: 'agent',
                    text: 'Saved draft',
                    status: 'proposal',
                  },
                ],
                toolCalls: [],
              },
            ],
          };
        if (m.type === 'panel:command' && m.command.action === 'model')
          state.modelId = m.command.modelId;
        return { ok: true, value: {} };
      },
    },
  });
  await import('../src/sidepanel/index');
  await vi.advanceTimersByTimeAsync(1);
  return {
    state,
    messages,
    setTabId: (id: number) => {
      tabId = id;
    },
  };
}
it('renders the source, current mode and reusable insertion state', async () => {
  const { messages } = await setup();
  expect(document.getElementById('source-author')?.textContent).toBe('@a');
  expect(document.getElementById('source-snippet')?.textContent).toBe('Source text');
  expect(document.querySelector('.mode.active')?.textContent).toBe('Quote');
  const insert = document.querySelector<HTMLButtonElement>('[aria-label="Apply again to draft"]')!;
  expect(insert.textContent).toBe('✓ Inserted');
  expect(insert.disabled).toBe(false);
  insert.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages.some((m) => m.type === 'panel:command' && m.command.action === 'apply')).toBe(
    true,
  );
});
it('routes model changes and Reply to the active writing window', async () => {
  const { messages } = await setup();
  const model = document.getElementById('model-choice') as HTMLSelectElement;
  model.value = 'b';
  model.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(1);
  expect(messages.some((m) => m.type === 'panel:command' && m.command.modelId === 'b')).toBe(true);
  (document.getElementById('reply-mode') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual({
    type: 'panel:mode',
    windowId: 42,
    mode: 'reply',
    url: 'https://x.com/a/status/1',
  });
});
it('opens a historical conversation and reuses a selected version in a new draft', async () => {
  const { messages } = await setup();
  (document.getElementById('history-toggle') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  (document.querySelector('.history-item') as HTMLButtonElement).click();
  const use = document.querySelector<HTMLButtonElement>('[aria-label="Use draft"]')!;
  expect(use).not.toBeNull();
  use.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual({ type: 'panel:new', windowId: 42, restoreJobId: 'saved' });
});
it('labels the expanded source Hide and restores Show when collapsed', async () => {
  await setup();
  const source = document.getElementById('source-details') as HTMLDetailsElement;
  const label = source.querySelector('.source-show')!;
  expect(label.textContent).toBe('Show');
  source.open = true;
  source.dispatchEvent(new Event('toggle'));
  expect(label.textContent).toBe('Hide');
  source.open = false;
  source.dispatchEvent(new Event('toggle'));
  expect(label.textContent).toBe('Show');
});
it('keeps source context in the composer and shows citations as domain chips', async () => {
  const { state } = await setup();
  state.turns[0].text = 'Draft https://example.com/report';
  await vi.advanceTimersByTimeAsync(1500);
  expect(document.querySelector('#chat-form #source-details')).not.toBeNull();
  expect(document.querySelector('.source-chip')?.textContent).toContain('example.com');
  expect(document.querySelector('.source-chip')?.getAttribute('href')).toBe(
    'https://example.com/report',
  );
});
it('collapses earlier revisions while keeping the latest draft visible', async () => {
  const { state } = await setup();
  state.turns.push({ id: 'next', role: 'agent', text: 'Latest draft', status: 'proposal' });
  await vi.advanceTimersByTimeAsync(1500);
  const earlier = document.querySelector<HTMLDetailsElement>('.earlier-revision');
  expect(earlier).not.toBeNull();
  expect(earlier?.open).toBe(false);
  expect(earlier?.querySelector('summary')?.textContent).toContain('v1');
  expect(document.querySelector('#conversation > .revision')?.textContent).toContain(
    'Latest draft',
  );
});
it('closes the mode picker with Escape or an outside click', async () => {
  await setup();
  const menu = document.getElementById('mode-menu') as HTMLDetailsElement;
  menu.open = true;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(menu.open).toBe(false);
  menu.open = true;
  document.getElementById('request')!.click();
  expect(menu.open).toBe(false);
});
it('keeps malformed URLs readable without breaking the conversation', async () => {
  const { state } = await setup();
  state.turns[0].text = 'An incomplete link: https://';
  await vi.advanceTimersByTimeAsync(1500);
  expect(document.querySelector('.turn-text')?.textContent).toContain('https://');
});

it('generates with the selected intent and no message from the bottom composer', async () => {
  const { state, messages } = await setup();
  state.prompts.push({ id: 'voice', name: 'In my voice' });
  await vi.advanceTimersByTimeAsync(600);
  const prompt = document.getElementById('prompt') as HTMLSelectElement;
  prompt.value = 'voice';
  prompt.dispatchEvent(new Event('change'));
  const send = document.getElementById('send') as HTMLButtonElement;
  expect(send.disabled).toBe(false);
  expect(document.getElementById('intent-status')?.textContent).toContain('In my voice');
  send.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: 'panel:command',
      command: { action: 'regenerate', promptId: 'voice' },
    }),
  );
});

it('uses the bottom generation button to stop a running request', async () => {
  const { state, messages } = await setup();
  state.busy = true;
  await vi.advanceTimersByTimeAsync(600);
  const send = document.getElementById('send') as HTMLButtonElement;
  expect(send.disabled).toBe(false);
  send.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(expect.objectContaining({ command: { action: 'cancel' } }));
});

it('renders page discussion with inspectable metadata, all answers expanded, and no draft actions', async () => {
  const { messages, state } = await setup({
    mode: 'chat',
    prompts: [],
    promptId: 'page-chat',
    post: undefined,
    pageContext: {
      id: 'snapshot',
      tabId: 7,
      capturedAt: 1,
      title: 'AMC problem',
      url: 'https://math.example.org/amc',
      text: 'Question and published solution',
      author: 'Math Circle',
      selection: 'Problem 1',
      limitations: ['Diagram is not included.'],
      truncated: false,
    },
    pageChanged: true,
    activePageTitle: 'Another page',
    turns: [
      { id: 'a', role: 'agent', text: 'First hint' },
      { id: 'b', role: 'agent', text: 'Second explanation' },
    ],
  });
  state.turns[0].context = state.pageContext;
  await vi.advanceTimersByTimeAsync(600);
  expect(document.querySelector('.message-context')).toBeNull();
  expect(state.turns[0].context?.title).toBe('AMC problem');
  expect(document.getElementById('mode-label')?.textContent).toBe('Page chat');
  expect(document.getElementById('page-context')?.textContent).toContain('AMC problem');
  expect(document.getElementById('page-context')?.textContent).toContain('Math Circle');
  expect(document.getElementById('page-context')?.textContent).toContain('Problem 1');
  expect(document.getElementById('page-context')?.textContent).toContain(
    'Diagram is not included.',
  );
  expect(document.getElementById('page-notice')?.textContent).toMatch(/Another page/);
  expect(document.querySelector('.earlier-revision')).toBeNull();
  expect(document.querySelector('[aria-label="Apply to draft"]')).toBeNull();
  expect((document.getElementById('prompt') as HTMLSelectElement).hidden).toBe(true);
  const send = document.getElementById('send') as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  const request = document.getElementById('request') as HTMLTextAreaElement;
  request.value = 'Why symmetry?';
  request.dispatchEvent(new Event('input'));
  expect(send.getAttribute('aria-label')).toBe('Send message');
  expect(send.textContent?.trim()).toBe('');
  expect(send.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  send.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: 'panel:command',
      command: { action: 'refine', instruction: 'Why symmetry?' },
    }),
  );
  document.getElementById('refresh-page')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual({ type: 'panel:chat', windowId: 42, id: 'c', action: 'refresh' });
});

it('starts a page chat explicitly from the mode menu and removes context without deleting the conversation', async () => {
  const { messages } = await setup({ mode: 'chat', turns: [] });
  document.getElementById('chat-mode')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual({ type: 'panel:chat', windowId: 42, action: 'new' });
  document.getElementById('remove-page')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual({ type: 'panel:chat', windowId: 42, id: 'c', action: 'remove' });
});

it('authorizes visual capture explicitly for a page-chat message', async () => {
  const { messages } = await setup({ mode: 'chat', turns: [] });
  const checkbox = document.getElementById('allow-screenshot') as HTMLInputElement;
  checkbox.checked = true;
  const request = document.getElementById('request') as HTMLTextAreaElement;
  request.value = 'Explain the triangle diagram';
  request.dispatchEvent(new Event('input'));
  (document.getElementById('send') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      command: {
        action: 'refine',
        instruction: 'Explain the triangle diagram',
        allowScreenshot: true,
      },
    }),
  );
});
it('keeps chat first and supports detached and docked artifact previews', async () => {
  const { commitDiagram } = await import('../src/background/diagrams');
  const diagram = commitDiagram(
    undefined,
    {
      dimension: 2,
      title: 'Triangle ABC',
      points: [
        { id: 'A', at: [0, 0] },
        { id: 'B', at: [4, 0] },
        { id: 'C', at: [0, 3] },
      ],
      segments: [
        { a: 'A', b: 'B' },
        { a: 'B', b: 'C' },
        { a: 'C', b: 'A' },
      ],
    },
    'first',
  );
  const { messages } = await setup({ mode: 'chat', turns: [], diagram });
  const host = document.getElementById('diagram-panel')!;
  expect(host.hidden).toBe(true);
  expect(document.getElementById('artifact-chip')!.hidden).toBe(false);
  document.getElementById('preview-artifact')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({ type: 'preview:open', mode: 'window' }),
  );
  document.getElementById('dock-artifact')!.click();
  expect(host.hidden).toBe(false);
  expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('Triangle ABC');
  document.getElementById('preview-artifact')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages.filter((m) => m.type === 'preview:open')).toHaveLength(2);
  expect(host.hidden).toBe(true);
  document.getElementById('dock-artifact')!.click();
  expect(host.hidden).toBe(false);
  const expanded = document.getElementById('diagram-expanded') as HTMLDialogElement;
  expanded.showModal = () => {
    expanded.open = true;
  };
  expanded.close = () => {
    expanded.open = false;
  };
  (host.querySelector('[aria-label="Expand diagram"]') as HTMLButtonElement).click();
  expect(expanded.open).toBe(true);
  expect(expanded.querySelector('svg')).not.toBeNull();
  (host.querySelector('[aria-label="Undo diagram"]') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      command: { action: 'artifact', operation: 'version', artifactId: 'diagram', versionId: null },
    }),
  );
});

it('opens the current diagram in a browser-width tab without attaching a different page', async () => {
  const { messages } = await setup({ mode: 'chat' });
  document.getElementById('open-diagram-tab')!.click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual({
    type: 'preview:open',
    chatId: 'c',
    mode: 'tab',
  });
});
it('keeps the latest response in view when a new diagram reduces conversation height', async () => {
  const { commitDiagram } = await import('../src/background/diagrams');
  const { state } = await setup({
    mode: 'chat',
    turns: [{ id: 'first', role: 'agent', text: 'First response' }],
  });
  const log = document.getElementById('conversation')!;
  Object.defineProperty(log, 'scrollHeight', { get: () => 500 });
  Object.defineProperty(log, 'clientHeight', {
    get: () => (document.getElementById('diagram-panel')!.hidden ? 500 : 100),
  });
  log.scrollTop = 0;
  state.diagram = commitDiagram(
    undefined,
    { dimension: 2, points: [{ id: 'A', at: [0, 0] }] },
    'drawing',
  );
  await vi.advanceTimersByTimeAsync(600);
  expect(log.scrollTop).toBe(500);
});

it('opens the final artifact revision produced by a conversation round', async () => {
  const { createArtifact, reviseArtifact } = await import('../src/background/artifacts');
  const { emptyArtifacts } = await import('../src/artifacts/types');
  let artifacts = createArtifact(
    emptyArtifacts(),
    { kind: 'document', title: 'Notes', data: { markdown: 'First' } },
    'v1',
    'notes',
    'j',
  );
  artifacts = reviseArtifact(artifacts, 'notes', 'v1', { markdown: 'Final' }, 'v2', undefined, 'j');
  const { messages } = await setup({ mode: 'chat', artifacts });
  document.getElementById('dock-artifact')!.click();
  (document.querySelector('[aria-label="Open artifact Notes"]') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: 'panel:command',
      command: { action: 'artifact', operation: 'version', artifactId: 'notes', versionId: 'v2' },
    }),
  );
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: 'preview:open',
      chatId: 'c',
      mode: 'window',
    }),
  );
});

it('keeps every page-context control inside collapsed details', async () => {
  await setup({ mode: 'chat' });
  const details = document.getElementById('page-details') as HTMLDetailsElement;
  expect(details.open).toBe(false);
  expect(
    document.getElementById('chat-form')!.contains(document.getElementById('page-context')),
  ).toBe(false);
  expect(document.querySelector('.toolbar')!.contains(details)).toBe(true);
  expect(details.querySelector('summary')?.getAttribute('aria-label')).toBe('Chat options');
  for (const id of [
    'page-notice',
    'refresh-page',
    'remove-page',
    'delete-chat',
    'allow-screenshot',
  ])
    expect(details.contains(document.getElementById(id))).toBe(true);
});

it('opens an artifact-only tab without changing the side panel conversation', async () => {
  history.replaceState(null, '', '#artifact=c&preview=tab');
  const { messages, setTabId } = await setup({ mode: 'chat' });
  expect(messages.some((m) => m.type === 'panel:chat')).toBe(false);
  expect(document.body.classList.contains('artifact-window')).toBe(true);
  expect((document.getElementById('diagram-expanded') as HTMLDialogElement).open).toBe(true);
  expect(document.getElementById('close-diagram')?.textContent).toBe('Close preview');
  setTabId(18);
  await vi.advanceTimersByTimeAsync(600);
  expect((document.getElementById('diagram-expanded') as HTMLDialogElement).open).toBe(true);
});

it('renders assistant Markdown but preserves raw user text and copy content', async () => {
  const source = '## Method\n\n**Use** the theorem.\n\n```python\nprint(1)\n```';
  await setup({
    mode: 'chat',
    turns: [
      { id: 'u', role: 'user', text: '**my literal input**' },
      { id: 'a', role: 'agent', text: source },
    ],
  });
  expect(document.querySelector('.turn.user strong')).toBeNull();
  expect(document.querySelector('.turn.user .turn-text')?.textContent).toBe('**my literal input**');
  expect(document.querySelector('.turn.agent h2')?.textContent).toBe('Method');
  expect(document.querySelector('.turn.agent strong')?.textContent).toBe('Use');
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  (document.querySelector('.turn.agent .revision-actions button') as HTMLButtonElement).click();
  expect(writeText).toHaveBeenCalledWith(source);
});

it.each(['window', 'tab'])(
  'only minimizes a standalone %s preview owner while pinned',
  async (mode) => {
    history.replaceState(null, '', `#artifact=c&preview=${mode}`);
    const doc = document.implementation.createHTMLDocument('');
    const popup = { document: doc, closed: false, close: vi.fn(), addEventListener: vi.fn() };
    vi.stubGlobal('documentPictureInPicture', { requestWindow: async () => popup });
    const { messages } = await setup({ mode: 'chat' });
    document.getElementById('pin-preview')!.click();
    await vi.advanceTimersByTimeAsync(1);
    const updates = () => messages.filter((m) => m.type === 'window:update');
    if (mode === 'window')
      expect(updates()).toContainEqual({ type: 'window:update', id: 42, state: 'minimized' });
    else expect(updates()).toEqual([]);
    (doc.querySelector('header button') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(1);
    if (mode === 'window')
      expect(updates().at(-1)).toEqual({ type: 'window:update', id: 42, state: 'normal' });
    else expect(updates()).toEqual([]);
  },
);

it('shows each rounds final drawings inline without opening a window or editing controls', async () => {
  const { createArtifact, reviseArtifact } = await import('../src/background/artifacts');
  const { emptyArtifacts } = await import('../src/artifacts/types');
  const scene = (title: string) => ({
    dimension: 2,
    title,
    points: [
      { id: 'A', label: 'A', at: [0, 0] },
      { id: 'B', at: [6, 0] },
    ],
    segments: [{ a: 'A', b: 'B' }],
  });
  let artifacts = createArtifact(
    emptyArtifacts(),
    { kind: 'diagram', title: 'Original', data: scene('Original') },
    'v1',
    'drawing',
    'old',
  );
  artifacts = reviseArtifact(
    artifacts,
    'drawing',
    'v1',
    scene('Intermediate'),
    'v2',
    'Intermediate',
    'j',
  );
  artifacts = reviseArtifact(artifacts, 'drawing', 'v2', scene('Final'), 'v3', 'Final', 'j');
  artifacts = createArtifact(
    artifacts,
    { kind: 'diagram', title: 'Second', data: scene('Second') },
    'other',
    'second',
    'j',
  );
  const { messages, state } = await setup({
    mode: 'chat',
    artifacts,
    turns: [
      { id: 'old', jobId: 'old', role: 'agent', text: 'First drawing' },
      { id: 'j', jobId: 'j', role: 'agent', text: 'Revised drawings' },
    ],
  });
  expect(document.querySelectorAll('.inline-drawing svg')).toHaveLength(3);
  expect(document.querySelector('.turn[data-job-id="old"] svg')?.getAttribute('aria-label')).toBe(
    'Original',
  );
  expect(document.querySelectorAll('.turn[data-job-id="j"] svg')).toHaveLength(2);
  expect(document.querySelector('svg[aria-label="Intermediate"]')).toBeNull();
  expect(
    document.querySelector(
      '.inline-drawing [tabindex], .inline-drawing [role="button"], .inline-drawing select',
    ),
  ).toBeNull();
  expect(messages.some((m) => m.type === 'preview:open')).toBe(false);
  (
    document.querySelector('.turn[data-job-id="old"] .inline-drawing button') as HTMLButtonElement
  ).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: 'preview:open',
      chatId: 'c',
      mode: 'window',
      artifactId: 'drawing',
      versionId: 'v1',
    }),
  );
  state.busy = true;
  await vi.advanceTimersByTimeAsync(600);
  expect(document.querySelectorAll('.inline-drawing svg')).toHaveLength(3);
  expect((document.querySelector('.inline-drawing button') as HTMLButtonElement).disabled).toBe(
    true,
  );
  state.busy = false;
  state.turns[1].status = 'error';
  await vi.advanceTimersByTimeAsync(600);
  expect(document.querySelectorAll('.turn.error .inline-drawing svg')).toHaveLength(2);
  state.artifacts!.items[0].versions = state.artifacts!.items[0].versions.slice(1);
  await vi.advanceTimersByTimeAsync(600);
  const old = document.querySelector('.turn[data-job-id="old"]')!;
  expect(old.querySelector('svg')).toBeNull();
  expect(old.textContent).toContain('Drawing version is no longer available');
});

it('loads drawings for a historical chat and opens that chat rather than the active one', async () => {
  const { createArtifact } = await import('../src/background/artifacts');
  const artifacts = createArtifact(
    { items: [], operations: [] },
    {
      kind: 'diagram',
      title: 'Saved drawing',
      data: { dimension: 2, points: [{ id: 'A', at: [0, 0] }] },
    },
    'v1',
    'd',
    'j',
  );
  const withDocument = createArtifact(
    artifacts,
    { kind: 'document', title: 'Saved notes', data: { markdown: 'Notes' } },
    'doc-v1',
    'notes',
    'j',
  );
  const { messages } = await setup({ mode: 'chat', artifacts: withDocument }, true);
  document.getElementById('history-toggle')!.click();
  await vi.advanceTimersByTimeAsync(1);
  (document.querySelector('.history-item') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(document.querySelectorAll('#history-content .inline-drawing svg')).toHaveLength(1);
  expect(document.querySelector('#history-content .artifact-card')).toBeNull();
  (document.querySelector('#history-content .inline-drawing button') as HTMLButtonElement).click();
  await vi.advanceTimersByTimeAsync(1);
  expect(messages).toContainEqual(
    expect.objectContaining({
      type: 'preview:open',
      chatId: 's',
      artifactId: 'd',
      versionId: 'v1',
    }),
  );
});
