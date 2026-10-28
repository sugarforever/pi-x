// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { Composer } from '../src/content/composer';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});
async function setup(publicOverrides: Record<string, unknown> = {}, mode?: 'reply') {
  vi.useFakeTimers();
  const sent: any[] = [];
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (m: any) => {
        sent.push(m);
        if (m.type === 'settings:public')
          return {
            ok: true,
            value: {
              configured: true,
              prompts: [{ id: 'p', name: 'Prompt' }],
              defaultPromptId: 'p',
              ...publicOverrides,
            },
          };
        if (m.type === 'job:start') return { ok: true, value: { id: 'initial' } };
        if (m.type === 'job:refine') return { ok: true, value: { id: 'revision' } };
        if (m.type === 'job:get')
          return {
            ok: true,
            value: {
              status: 'done',
              draft: m.id === 'initial' ? 'Initial draft' : 'Revised draft',
            },
          };
        return { ok: true, value: null };
      },
    },
  });
  document.body.innerHTML =
    '<div role="dialog"><div contenteditable="true"></div><div data-testid="attachments">Original card</div></div>';
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  const editor = dialog.querySelector<HTMLElement>('[contenteditable]')!;
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (_c: string, _u: boolean, t: string) => {
      editor.textContent = t;
      return true;
    },
  });
  const c = new Composer(
    dialog,
    editor,
    {
      id: '1',
      url: 'https://x.com/a/status/1',
      author: 'a',
      text: 'Source',
      links: [],
    },
    undefined,
    mode,
  );
  await vi.advanceTimersByTimeAsync(10);
  return { c, editor, dialog, sent };
}
it('places Open pi-x beside the audience selector and restores it there', async () => {
  const { c, editor, dialog } = await setup();
  const row = document.createElement('div');
  const audience = document.createElement('button');
  audience.setAttribute('aria-label', 'Choose audience');
  audience.textContent = 'Everyone';
  row.append(audience);
  dialog.insertBefore(row, editor);
  c.ensureLauncher();
  const host = dialog.querySelector<HTMLElement>('[data-pi-x-composer]')!;
  expect(host.parentElement).toBe(row);
  expect(host.dataset.piXInline).toBe('true');
  host.remove();
  c.ensureLauncher();
  expect(host.parentElement).toBe(row);
  c.dispose();
});
it('keeps X clean and requires explicit apply for every generated draft', async () => {
  const { c, dialog, editor } = await setup();
  expect(dialog.querySelector('textarea,select')).toBeNull();
  expect(dialog.querySelector('[data-pi-x-refinement]')).toBeNull();
  expect(editor.textContent).toBe('');
  const state = c.snapshot();
  expect(state.turns.at(-1)?.text).toBe('Initial draft');
  await c.command({ action: 'apply', turnId: state.turns.at(-1)!.id });
  expect(editor.textContent).toBe('Initial draft');
  c.dispose();
});
it('can reapply an applied revision after clearing, preserving edit and undo protection', async () => {
  const { c, editor } = await setup();
  const turnId = c.snapshot().turns.at(-1)!.id;
  await c.command({ action: 'apply', turnId });
  await c.command({ action: 'apply', turnId });
  editor.textContent = '\n';
  await c.command({ action: 'apply', turnId });
  expect(editor.textContent).toBe('Initial draft');
  await c.command({ action: 'undo' });
  expect(editor.textContent).toBe('\n');
  await c.command({ action: 'apply', turnId });
  editor.textContent = 'Manual changes';
  expect(await c.command({ action: 'apply', turnId })).toMatchObject({ conflict: true });
  expect(editor.textContent).toBe('Manual changes');
  c.dispose();
});
it('refines current text, guards apply and undo, and rejects stale proposals', async () => {
  const { c, editor, sent } = await setup();
  editor.textContent = 'My edits';
  await c.command({ action: 'refine', instruction: 'Shorter' });
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.find((m) => m.type === 'job:refine').refinement.currentDraft).toBe('My edits');
  const turn = c.snapshot().turns.at(-1)!;
  editor.textContent = 'New edits';
  expect(await c.command({ action: 'apply', turnId: turn.id })).toMatchObject({
    conflict: true,
    currentDraft: 'New edits',
  });
  expect(editor.textContent).toBe('New edits');
  await c.command({ action: 'apply', turnId: turn.id, expectedCurrent: 'New edits' });
  expect(editor.textContent).toBe('Revised draft');
  editor.textContent = 'Newer edits';
  expect(await c.command({ action: 'undo' })).toMatchObject({ conflict: true });
  await c.command({ action: 'undo', expectedCurrent: 'Newer edits' });
  expect(editor.textContent).toBe('New edits');
  await c.command({ action: 'regenerate', promptId: 'p' });
  await vi.advanceTimersByTimeAsync(10);
  await expect(c.command({ action: 'apply', turnId: turn.id })).rejects.toThrow();
  c.dispose();
  await expect(c.command({ action: 'refine', instruction: 'Hi' })).rejects.toThrow();
});
it('ignores late responses after cancellation and reconnects without a duplicate job', async () => {
  const { c, editor, sent } = await setup();
  let finish!: (x: any) => void;
  const original = chrome.runtime.sendMessage;
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (m: any) =>
        m.type === 'job:get'
          ? new Promise((r) => {
              finish = r;
            })
          : original(m),
    },
  });
  void c.command({ action: 'refine', instruction: 'Shorter' });
  await vi.advanceTimersByTimeAsync(10);
  await c.command({ action: 'cancel' });
  finish({ ok: true, value: { status: 'done', draft: 'Late reply' } });
  await vi.advanceTimersByTimeAsync(10);
  expect(c.snapshot().turns.some((t) => t.text === 'Late reply')).toBe(false);
  expect(editor.textContent).toBe('');
  expect(sent.filter((m) => m.type === 'job:refine')).toHaveLength(1);
  c.dispose();
});
it('starts an original tweet from a chat brief without generating or posting on open', async () => {
  const { dialog, editor, sent, c } = await setup();
  c.dispose();
  sent.length = 0;
  const original = new Composer(dialog, editor);
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.some((m) => m.type === 'job:start')).toBe(false);
  expect(original.snapshot().mode).toBe('compose');
  expect(original.snapshot().ready).toBe(true);
  editor.textContent = 'My first rough notes';
  await original.command({
    action: 'refine',
    instruction: 'Write about what I learned building an extension',
  });
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.find((m) => m.type === 'job:start')).toMatchObject({
    mode: 'compose',
    initialDraft: 'My first rough notes',
    brief: 'Write about what I learned building an extension',
    promptId: 'compose-original',
  });
  expect(editor.textContent).toBe('My first rough notes');
  await original.command({ action: 'refine', instruction: 'Shorter and warmer' });
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.find((m) => m.type === 'job:refine').refinement.currentDraft).toBe('Initial draft');
  await original.command({ action: 'apply', turnId: original.snapshot().turns.at(-1)!.id });
  expect(editor.textContent).toBe('Revised draft');
  original.dispose();
});

it('rejects actions when an SPA keeps the root but detaches its editor', async () => {
  const { c, editor, dialog } = await setup();
  editor.remove();
  expect(dialog.isConnected).toBe(true);
  expect(c.connected).toBe(false);
  await expect(c.command({ action: 'refine', instruction: 'Shorter' })).rejects.toThrow(/closed/);
  c.dispose();
});

it('honors the chosen writing prompt on the first original message', async () => {
  const { c, dialog, editor, sent } = await setup();
  c.dispose();
  sent.length = 0;
  const original = new Composer(dialog, editor);
  await vi.advanceTimersByTimeAsync(10);
  await original.command({ action: 'refine', instruction: 'My idea', promptId: 'p' });
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.find((m) => m.type === 'job:start').promptId).toBe('p');
  original.dispose();
});

it('restores the assistant action if X removes its launcher while keeping the editor', async () => {
  const { c, dialog } = await setup();
  dialog.querySelector('[data-pi-x-composer]')!.remove();
  c.ensureLauncher();
  expect(dialog.querySelector('[data-pi-x-composer]')).toBeTruthy();
  c.dispose();
});

it('waits for a user request when automatic drafting is disabled', async () => {
  const { c, sent } = await setup({
    behavior: { autoDraft: false, readContext: true, language: 'English' },
  });
  expect(sent.some((m) => m.type === 'job:start')).toBe(false);
  expect(c.snapshot().ready).toBe(true);
  await c.command({ action: 'refine', instruction: 'Respond thoughtfully' });
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.find((m) => m.type === 'job:start')).toMatchObject({
    post: { id: '1' },
    brief: 'Respond thoughtfully',
  });
  c.dispose();
});
it('uses the reply intent for native replies and sends the selected model', async () => {
  const { c, sent } = await setup(
    {
      models: [
        { id: 'a', model: 'alpha' },
        { id: 'b', model: 'beta' },
      ],
      defaultModelId: 'a',
    },
    'reply',
  );
  expect(sent.find((m) => m.type === 'job:start')).toMatchObject({
    mode: 'reply',
    promptId: 'compose-reply',
    modelId: 'a',
  });
  await c.command({ action: 'model', modelId: 'b' });
  await c.command({ action: 'refine', instruction: 'Shorter' });
  await vi.advanceTimersByTimeAsync(10);
  expect(sent.find((m) => m.type === 'job:refine').modelId).toBe('b');
  c.dispose();
});
