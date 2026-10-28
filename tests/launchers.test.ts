// @vitest-environment jsdom
import { it, expect, vi, afterEach } from 'vitest';
import { installDraftLaunchers } from '../src/content/launchers';
afterEach(() => document.body.replaceChildren());
it('adds one action to the feed composer and starts on that editor without changing its text', () => {
  document.body.innerHTML =
    '<main><section><div data-testid="tweetTextarea_0" contenteditable="true">My notes</div><button data-testid="tweetButtonInline">Post</button></section><article data-testid="tweet">Feed post</article></main>';
  const start = vi.fn();
  installDraftLaunchers(document, start);
  installDraftLaunchers(document, start);
  const host = document.querySelector('[data-pi-x-draft-launcher]')!;
  expect(document.querySelectorAll('[data-pi-x-draft-launcher]')).toHaveLength(1);
  host.shadowRoot!.querySelector('button')!.click();
  expect(start).toHaveBeenCalledWith(
    document.querySelector('section'),
    document.querySelector('[contenteditable]'),
  );
  expect(document.querySelector('[contenteditable]')!.textContent).toBe('My notes');
});
it('does not attach draft actions to replies, quote dialogs, or post articles', () => {
  document.body.innerHTML =
    '<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"></div><div data-testid="attachments"><div data-testid="tweetText">Quoted</div></div></div><div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"></div><div data-testid="replyingTo">Replying</div></div><article><div data-testid="tweetTextarea_0" contenteditable="true"></div></article>';
  installDraftLaunchers(document, vi.fn());
  expect(document.querySelector('[data-pi-x-draft-launcher]')).toBeNull();
});
