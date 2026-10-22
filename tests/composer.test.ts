// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { Composer } from '../src/content/composer';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.replaceChildren();
});
it('reconnects after a transient worker interruption without starting another job', async () => {
  vi.useFakeTimers();
  let polls = 0,
    starts = 0;
  vi.stubGlobal('chrome', {
    runtime: {
      sendMessage: async (message: any) => {
        if (message.type === 'settings:public')
          return {
            ok: true,
            value: {
              configured: true,
              prompts: [{ id: 'p', name: 'Prompt' }],
              defaultPromptId: 'p',
            },
          };
        if (message.type === 'job:start') {
          starts++;
          return { ok: true, value: { id: 'j' } };
        }
        if (message.type === 'job:get') {
          polls++;
          if (polls === 1) throw new Error('Worker stopped');
          return {
            ok: true,
            value: { status: 'done', progress: 'Draft ready', draft: 'Recovered draft' },
          };
        }
        return { ok: true, value: null };
      },
    },
  });
  document.body.innerHTML =
    '<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"></div></div>';
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  const editor = dialog.querySelector<HTMLElement>('[contenteditable]')!;
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (_command: string, _ui: boolean, text: string) => {
      editor.textContent = text;
      return true;
    },
  });
  const composer = new Composer(dialog, editor, {
    id: '1',
    url: 'https://x.com/a/status/1',
    author: 'a',
    text: 'Hello',
    links: [],
  });
  await vi.advanceTimersByTimeAsync(5000);
  expect(editor.textContent).toBe('Recovered draft');
  expect(starts).toBe(1);
  expect(polls).toBe(2);
  composer.dispose();
});
