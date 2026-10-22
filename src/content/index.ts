import { extractPost, findQuoteItem, conversationPosts } from './dom';
import { Composer } from './composer';
import type { Post } from '../shared/types';
let selected: Post | undefined;
let pending: { post: Post; expires: number; existing: Set<Element> } | undefined;
const composers = new Map<string, Composer>();
function capture(event: Event) {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest('[data-testid="retweet"],[data-testid="unretweet"]');
  if (!button) return;
  const article = button.closest('article[data-testid="tweet"]');
  selected = article ? extractPost(article) : undefined;
}
document.addEventListener('pointerdown', capture, true);
document.addEventListener('click', capture, true);
function update() {
  for (const [id, c] of composers)
    if (!c.dialog.isConnected) {
      c.dispose();
      composers.delete(id);
    }
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (menu.querySelector('[data-pi-x="quote"]') || !selected) continue;
    const quote = findQuoteItem(menu);
    if (!quote) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.piX = 'quote';
    button.setAttribute('role', 'menuitem');
    button.textContent = '✦　AI Quote';
    button.style.cssText =
      'display:block;width:100%;text-align:left;border:0;background:transparent;color:inherit;padding:16px;font:700 15px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;cursor:pointer;';
    button.onmouseenter = () => {
      button.style.backgroundColor = 'rgba(128,128,128,.12)';
    };
    button.onmouseleave = () => {
      button.style.backgroundColor = 'transparent';
    };
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!selected) return;
      const post = structuredClone(selected);
      pending = {
        post,
        expires: Date.now() + 8000,
        existing: new Set(document.querySelectorAll('[role="dialog"]')),
      };
      quote.click();
      setTimeout(update, 0);
    };
    quote.after(button);
  }
  if (!pending) return;
  if (Date.now() > pending.expires) {
    pending = undefined;
    return;
  }
  for (const dialog of document.querySelectorAll<HTMLElement>('[role="dialog"]')) {
    if (pending.existing.has(dialog)) continue;
    const editor = dialog.querySelector<HTMLElement>(
      '[data-testid="tweetTextarea_0"][contenteditable="true"], [data-testid="tweetTextarea_0"] [contenteditable="true"]',
    );
    if (!editor) continue;
    const c = new Composer(dialog, editor, pending.post);
    composers.set(c.id, c);
    pending = undefined;
    break;
  }
}
let scheduled = false;
new MutationObserver(() => {
  if (!scheduled) {
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      update();
    });
  }
}).observe(document.documentElement, { childList: true, subtree: true });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'composer:alive') {
    reply({ alive: !!composers.get(message.composerId)?.dialog.isConnected });
    return;
  }
  if (message?.type === 'context:read') {
    const match = typeof message.url === 'string' ? message.url.match(/\/status\/(\d+)/) : null;
    reply({ ok: true, posts: match ? conversationPosts(document, match[1]) : [] });
  }
});
update();
