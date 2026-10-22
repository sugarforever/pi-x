import type { Post } from '../shared/types';
export function extractPost(article: Element): Post | undefined {
  const time = article.querySelector('time');
  const permalink = time?.closest('a')?.getAttribute('href');
  const match = permalink?.match(/^\/(\w+)\/status\/(\d+)/);
  if (!match) return;
  const texts = Array.from(article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]'));
  const quotedRoot = article
    .querySelector('[role="link"] [data-testid="tweetText"]')
    ?.closest('[role="link"]');
  const primary = texts.find((t) => !quotedRoot?.contains(t));
  const quoted = texts.find((t) => quotedRoot?.contains(t));
  const text = primary?.textContent?.trim() || '';
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
  return {
    id: match[2],
    url: `https://x.com/${match[1]}/status/${match[2]}`,
    author: article.querySelector('[data-testid="User-Name"]')?.textContent?.trim() || match[1],
    text: text || '(Quoted post)',
    links: [...new Set(links)].slice(0, 30),
    ...(quoted
      ? {
          quoted: {
            text: quoted.textContent?.trim() || '',
            ...(quotedLink ? { url: new URL(quotedLink, 'https://x.com').href } : {}),
          },
        }
      : {}),
  };
}
export function conversationPosts(root: ParentNode, id: string): Post[] {
  const posts = Array.from(root.querySelectorAll('article[data-testid="tweet"]'))
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
  return editor.innerText ?? editor.textContent ?? '';
}
export function insertDraft(editor: HTMLElement, draft: string): boolean {
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);
  // Native editing updates React/DraftJS through the same input path as typing.
  return document.execCommand('insertText', false, draft);
}
