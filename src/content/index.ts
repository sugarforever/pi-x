import { extractPost, findQuoteItem, conversationPosts, hasQuotedPost, expandPost } from './dom';
import { installDraftLaunchers, removeDraftLauncher } from './launchers';
import { Composer } from './composer';
import type { Post } from '../shared/types';
let selected: Post | undefined;
let modeIntent: { mode: 'quote' | 'reply'; url: string; menu?: boolean } | undefined;
let pending:
  { mode?: 'quote' | 'reply'; post: Post; expires: number; existing: Set<Element> } | undefined;
const composers = new Map<string, Composer>();
let composeIntent = false;
let restoredDraft: string | undefined;
let activeComposerId: string | undefined;
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
  if (modeIntent) {
    const intent = modeIntent;
    const article = [...document.querySelectorAll('article[data-testid="tweet"]')].find(
      (a) => extractPost(a)?.url === intent.url,
    );
    const post = article ? extractPost(article) : undefined;
    if (post && article) {
      if (intent.mode === 'reply') {
        const native = article.querySelector<HTMLElement>('[data-testid="reply"]');
        if (native) {
          pending = {
            mode: 'reply',
            post,
            expires: Date.now() + 10000,
            existing: new Set(document.querySelectorAll('[role="dialog"]')),
          };
          modeIntent = undefined;
          native.click();
        }
      } else if (!intent.menu) {
        const native = article.querySelector<HTMLElement>(
          '[data-testid="retweet"],[data-testid="unretweet"]',
        );
        if (native) {
          selected = post;
          intent.menu = true;
          native.click();
        }
      } else {
        const menu = document.querySelector('[role="menu"]');
        const native = menu ? findQuoteItem(menu) : undefined;
        if (native) {
          pending = {
            post,
            expires: Date.now() + 10000,
            existing: new Set(document.querySelectorAll('[role="dialog"]')),
          };
          modeIntent = undefined;
          native.click();
        }
      }
    }
  }
  for (const [id, c] of composers)
    if (!c.connected) {
      c.dispose();
      composers.delete(id);
    } else c.ensureLauncher();
  if (!pending)
    installDraftLaunchers(document, (root, editor) => {
      // Open while still in the click gesture. Activation authorizes this existing tab.
      void chrome.runtime.sendMessage({ type: 'panel:open' }).catch(() => {});
      void chrome.runtime
        .sendMessage({ type: 'composer:activate' })
        .then((reply) => {
          if (!reply?.ok || !editor.isConnected) return;
          if (editor.dataset.piXBound) {
            activeComposerId = editor.dataset.piXBound;
            return;
          }
          removeDraftLauncher(editor);
          const c = new Composer(root, editor, undefined, () => {
            activeComposerId = c.id;
          });
          composers.set(c.id, c);
          activeComposerId = c.id;
        })
        .catch(() => {});
    });
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    if (menu.querySelector('[data-pi-x="quote"]') || !selected) continue;
    const quote = findQuoteItem(menu);
    if (!quote) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.piX = 'quote';
    button.setAttribute('role', 'menuitem');
    button.textContent = '✦　Pi Quote';
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
      // X may replace the Quote link after this extension adds its menu item.
      // A click on the old detached anchor bypasses X’s router and reloads /compose/post.
      const nativeQuote = findQuoteItem(menu);
      if (!selected || !menu.isConnected || !nativeQuote?.isConnected) return;
      const post = structuredClone(selected);
      pending = {
        post,
        expires: Date.now() + 8000,
        existing: new Set(document.querySelectorAll('[role="dialog"]')),
      };
      void chrome.runtime.sendMessage({ type: 'panel:open' }).catch(() => {});
      nativeQuote.click();
      setTimeout(update, 0);
    };
    quote.after(button);
  }
  if (composeIntent && ![...composers.values()].some((c) => c.connected)) {
    const editor =
      document.querySelector<HTMLElement>(
        '[role="dialog"] [data-testid="tweetTextarea_0"][contenteditable="true"], [role="dialog"] [data-testid="tweetTextarea_0"] [contenteditable="true"]',
      ) ||
      document.querySelector<HTMLElement>(
        'main [data-testid="tweetTextarea_0"][contenteditable="true"]',
      );
    const root =
      editor?.closest<HTMLElement>('[role="dialog"]') || editor?.closest<HTMLElement>('main');
    if (
      editor &&
      root &&
      !root.querySelector('[data-testid="attachments"],[data-testid="replyingTo"]')
    ) {
      removeDraftLauncher(editor);
      const c = new Composer(
        root,
        editor,
        undefined,
        () => {
          activeComposerId = c.id;
        },
        'compose',
        restoredDraft,
      );
      restoredDraft = undefined;
      composers.set(c.id, c);
      activeComposerId = c.id;
      composeIntent = false;
    }
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
    const composerDialog = editor.closest<HTMLElement>('[role="dialog"]') || dialog;
    if (pending.mode !== 'reply' && !hasQuotedPost(composerDialog, pending.post)) continue;
    removeDraftLauncher(editor);
    const c = new Composer(
      composerDialog,
      editor,
      pending.post,
      () => {
        activeComposerId = c.id;
      },
      pending.mode,
    );
    composers.set(c.id, c);
    activeComposerId = c.id;
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
  if (message?.type === 'panel:state') {
    const active = activeComposerId ? composers.get(activeComposerId) : undefined;
    const c = active?.connected
      ? active
      : [...composers.values()].reverse().find((c) => c.connected);
    reply(c?.snapshot() || null);
    return;
  }
  if (message?.type === 'panel:command') {
    const c = composers.get(message.composerId);
    if (!c) {
      reply({ ok: false, error: 'This quote dialog is no longer active.' });
      return;
    }
    void c.command(message.command).then(
      (value) => reply({ ok: true, value }),
      (e) =>
        reply({ ok: false, error: e instanceof Error ? e.message : 'Could not update draft.' }),
    );
    return true;
  }
  if (message?.type === 'composer:alive') {
    reply({ alive: !!composers.get(message.composerId)?.connected });
    return;
  }
  if (message?.type === 'context:read') {
    const match = typeof message.url === 'string' ? message.url.match(/\/status\/(\d+)/) : null;
    if (match) expandPost(document, match[1]);
    reply({ ok: true, posts: match ? conversationPosts(document, match[1]) : [] });
  }
});
update();

void chrome.runtime
  .sendMessage({ type: 'composer:claim' })
  .then((reply) => {
    if (reply?.ok && reply.value?.intent && ['quote', 'reply'].includes(reply.value.intent.mode)) {
      modeIntent = reply.value.intent;
      update();
    }
    if (reply?.ok && reply.value?.intent?.mode === 'compose') {
      restoredDraft = reply.value.intent.draft;
      composeIntent = true;
      update();
    }
    if (reply?.ok && reply.value?.compose && !reply.value?.intent) {
      composeIntent = true;
      update();
    }
  })
  .catch(() => {});
