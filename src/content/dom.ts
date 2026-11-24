import { xPostUrl } from '../shared/urls';
import type { Post } from '../shared/types';
// X's redesigned client uses semantic articles and textareas instead of test IDs.
export const POST_SELECTOR = 'article';
export const REPOST_SELECTOR =
  '[data-testid="retweet"],[data-testid="unretweet"],[data-engagement-action="retweet"] button';
export const REPLY_SELECTOR = '[data-testid="reply"],[data-engagement-action="reply"] a';
export const EDITOR_SELECTOR =
  '[data-testid="tweetTextarea_0"][contenteditable="true"], [data-testid="tweetTextarea_0"] [contenteditable="true"], form textarea[aria-multiline="true"][writingsuggestions="false"]';
const POST_TEXT_SELECTOR = '[data-testid="tweetText"], [dir="auto"][lang]';
export function extractPost(article: Element): Post | undefined {
  const texts = Array.from(article.querySelectorAll<HTMLElement>(POST_TEXT_SELECTOR));
  const quotedRoot =
    article.querySelector('article') ||
    article.querySelector('[role="link"] [data-testid="tweetText"]')?.closest('[role="link"]');
  const permalink = Array.from(article.querySelectorAll('time'))
    .filter((time) => !quotedRoot?.contains(time) && time.closest('article') === article)
    .map((time) => time.closest('a')?.getAttribute('href'))
    .find((href) => href && /^\/\w+\/status\/\d+/.test(href));
  const fallback = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]'))
    .filter((a) => a.closest('article') === article && !quotedRoot?.contains(a))
    .map((a) => a.getAttribute('href') || '')
    .find((href) => /^(?:https:\/\/(?:x|twitter)\.com)?\/\w+\/status\/\d+\/?$/.test(href));
  const match = (permalink || fallback)?.match(
    /^(?:https:\/\/(?:x|twitter)\.com)?\/(\w+)\/status\/(\d+)/,
  );
  if (!match) return;
  const primary = texts.find((t) => !quotedRoot?.contains(t));
  const quoted = texts.find((t) => quotedRoot?.contains(t));
  const articleTitleNode = article.querySelector('[data-testid="twitter-article-title"]');
  const articleTitle =
    articleTitleNode && !articleTitleNode.closest('[role="link"]')
      ? articleTitleNode.textContent?.trim()
      : undefined;
  const body = article.querySelector<HTMLElement>(
    '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]',
  );
  let articleText = body?.innerText?.trim() || '';
  if (body && !articleText) {
    const copy = body.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll('script, style, button, [hidden], [aria-hidden="true"]')
      .forEach((node) => node.remove());
    copy.querySelectorAll('td, th').forEach((node) => node.append('\t'));
    copy
      .querySelectorAll('p, li, h1, h2, h3, h4, tr, [data-block="true"]')
      .forEach((node) => node.append('\n'));
    articleText = copy.textContent?.trim() || '';
  }
  const text = articleTitle
    ? [articleTitle, articleText].filter(Boolean).join('\n\n')
    : primary?.textContent?.trim() || '';
  // A quote-only post still has a useful source; preserve its quoted card separately.
  if (!text && !quoted?.textContent?.trim()) return;
  const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href]')).flatMap((a) => {
    for (const value of [a.getAttribute('data-expanded-url'), a.title, a.getAttribute('href')]) {
      if (!value || !/^https?:\/\//.test(value)) continue;
      try {
        const url = new URL(value);
        if (!['x.com', 'twitter.com', 'pic.x.com', 'pic.twitter.com'].includes(url.hostname))
          return [url.href];
      } catch {}
    }
    return [];
  });
  const quotedLink = quotedRoot?.querySelector('a[href*="/status/"]')?.getAttribute('href');
  let quotedUrl: string | undefined;
  if (quotedLink) {
    try {
      quotedUrl = xPostUrl(new URL(quotedLink, 'https://x.com').href);
    } catch {
      // Preserve quoted text even when X's card has no usable post permalink.
    }
  }
  return {
    ...(sourceExpandButton(article) || (articleTitle && !articleText) ? { truncated: true } : {}),
    ...(articleTitle ? { articleTitle } : {}),
    id: match[2],
    url: `https://x.com/${match[1]}/status/${match[2]}`,
    author: article.querySelector('[data-testid="User-Name"]')?.textContent?.trim() || match[1],
    text: text || '(Quoted post)',
    links: [...new Set(links)].slice(0, 30),
    ...(quoted
      ? {
          quoted: {
            text: quoted.textContent?.trim() || '',
            ...(quotedUrl ? { url: quotedUrl } : {}),
          },
        }
      : {}),
  };
}
function sourceExpandButton(article: Element): HTMLElement | undefined {
  return Array.from(
    article.querySelectorAll<HTMLElement>('[data-testid="tweet-text-show-more-link"]'),
  ).find((button) => button.closest('article') === article && !button.closest('[role="link"]'));
}
export function expandPost(root: ParentNode, id: string) {
  for (const article of root.querySelectorAll(POST_SELECTOR)) {
    if (extractPost(article)?.id === id) {
      sourceExpandButton(article)?.click();
      return;
    }
  }
}
export function conversationPosts(root: ParentNode, id: string): Post[] {
  const posts = Array.from(root.querySelectorAll(POST_SELECTOR))
    .filter((article) => !article.parentElement?.closest(POST_SELECTOR))
    .map(extractPost)
    .filter((x): x is Post => !!x);
  const index = posts.findIndex((p) => p.id === id);
  if (index < 0) return [];
  return posts.slice(Math.max(0, index - 8), index + 1);
}
export function findQuoteItem(menu: Element): HTMLElement | undefined {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).find((el) => {
    if (el.dataset.piX) return false;
    return (
      /\/compose\/(post|tweet)/.test(el.getAttribute('href') || '') ||
      /^(Quote|引用|引用ポスト|引用する|引用推文|引用帖子|Citer|Zitieren|Citar)$/i.test(
        el.textContent?.trim() || '',
      )
    );
  });
}
export function canAutoInsert(state: {
  generation: number;
  currentGeneration: number;
  baseline: string;
  currentText: string;
  revision: number;
  currentRevision: number;
  connected: boolean;
}) {
  return (
    state.connected &&
    state.generation === state.currentGeneration &&
    state.revision === state.currentRevision &&
    state.baseline === state.currentText
  );
}
export function editorText(editor: HTMLElement) {
  return editor instanceof HTMLTextAreaElement
    ? editor.value
    : (editor.innerText ?? editor.textContent ?? '');
}
export function insertDraft(editor: HTMLElement, draft: string): boolean {
  editor.focus();
  if (editor instanceof HTMLTextAreaElement) {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (!setValue || editor.disabled || editor.readOnly) return false;
    setValue.call(editor, draft);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return editor.value === draft;
  }
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
  // Route through DraftJS's paste handler so its state owns the inserted text.
  // execCommand alone can leave an unmanaged text node beside React's rendered copy.
  document.dispatchEvent(new Event('selectionchange'));
  if (typeof DataTransfer !== 'undefined' && typeof ClipboardEvent !== 'undefined') {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', draft);
    const paste = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData });
    if (!editor.dispatchEvent(paste)) return true;
  }
  // A managed editor that declined the paste must use the manual-copy fallback.
  if (editor.querySelector('[data-contents="true"]')) return false;
  return document.execCommand('insertText', false, draft);
}

// Never turn a plain composer (or a different quote) into an Pi Quote job.
export function hasQuotedPost(dialog: Element, post: Post): boolean {
  // Redesigned quote cards retain their own canonical permalink.
  const textarea = dialog.querySelector(
    'form textarea[aria-multiline="true"][writingsuggestions="false"]',
  );
  if (textarea) {
    const form = textarea.closest('form')!;
    return Array.from(form.querySelectorAll('article')).some(
      (card) => extractPost(card)?.id === post.id,
    );
  }
  // X uses both an attachments wrapper around the whole quote and a clickable
  // quote card with a separate attachments wrapper containing only media.
  // Never search the entire main region: it can also contain the source thread.
  const candidates = Array.from(
    dialog.querySelectorAll('[data-testid="attachments"], [role="link"]'),
  ).filter(
    (node) =>
      !node.closest('[contenteditable="true"]') &&
      !node.closest('article[data-testid="tweet"]') &&
      !node.parentElement?.closest('[role="link"]'),
  );
  const handle = new URL(post.url).pathname.split('/')[1].toLowerCase();
  const normalize = (text: string) =>
    text.replace(/[\s\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').replace(/(?:…|\.\.\.)$/, '');
  const expected = normalize(post.text === '(Quoted post)' ? post.quoted?.text || '' : post.text);
  return candidates.some((attachment) => {
    const names = attachment.querySelector('[data-testid="User-Name"]')?.textContent || '';
    if (!names.match(/@[A-Za-z0-9_]+/g)?.some((name) => name.toLowerCase() === `@${handle}`))
      return false;
    if (post.articleTitle && attachment.querySelector('[data-testid="article-cover-image"]'))
      return normalize(attachment.textContent || '').includes(normalize(post.articleTitle));
    const actual = normalize(
      attachment.querySelector('[data-testid="tweetText"]')?.textContent || '',
    );
    return !!expected && !!actual && (actual.startsWith(expected) || expected.startsWith(actual));
  });
}

// Opening Chrome's side panel can make X replace a modal with a full-page editor.
export function findQuoteEditor(
  root: ParentNode,
  post: Post,
  fullPage: boolean,
  existing: ReadonlySet<Element> = new Set(),
): { dialog: HTMLElement; editor: HTMLElement } | undefined {
  for (const editor of root.querySelectorAll<HTMLElement>(EDITOR_SELECTOR)) {
    const dialog =
      editor.closest<HTMLElement>('[role="dialog"]') ||
      (fullPage ? editor.closest<HTMLElement>('main') : null);
    if (!dialog || existing.has(dialog) || editor.dataset.piXBound) continue;
    if (hasQuotedPost(dialog, post)) return { dialog, editor };
  }
}
