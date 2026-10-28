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
});
async function setup() {
  vi.useFakeTimers();
  document.documentElement.innerHTML = readFileSync('src/sidepanel/sidepanel.html', 'utf8');
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
  const messages: any[] = [];
  vi.stubGlobal('chrome', {
    windows: { getCurrent: async () => ({ id: 42 }) },
    storage: { onChanged: { addListener: vi.fn() } },
    runtime: {
      sendMessage: async (m: any) => {
        messages.push(m);
        if (m.type === 'panel:get')
          return { ok: true, value: { tabId: 7, state: structuredClone(state) } };
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
        if (m.type === 'panel:history')
          return {
            ok: true,
            value: [
              {
                id: 's',
                mode: 'quote',
                title: 'Saved conversation',
                updatedAt: Date.now(),
                turns: [{ id: 'saved', role: 'agent', text: 'Saved draft', status: 'proposal' }],
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
  return { state, messages };
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
