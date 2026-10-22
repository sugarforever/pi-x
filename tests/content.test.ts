// @vitest-environment jsdom
import { it, expect } from 'vitest';
import { extractPost, conversationPosts, findQuoteItem, canAutoInsert } from '../src/content/dom';
const article = (id: string, text: string, quote = '') =>
  `<article data-testid="tweet"><div data-testid="User-Name">Author @author</div><a href="/author/status/${id}"><time>Today</time></a><div data-testid="tweetText">${text}</div>${quote}<button data-testid="retweet">Repost</button></article>`;
it('binds the source to the outer post and keeps quoted text separate', () => {
  document.body.innerHTML = article(
    '123',
    'Original text <a href="https://t.co/a" title="https://example.com/article">link</a>',
    '<div role="link"><div data-testid="tweetText">Quoted text</div><a href="/other/status/456"><time>Yesterday</time></a></div>',
  );
  const post = extractPost(document.querySelector('article')!);
  expect(post?.id).toBe('123');
  expect(post?.text).toBe('Original text link');
  expect(post?.quoted?.text).toBe('Quoted text');
  expect(post?.links).toContain('https://example.com/article');
});
it('excludes replies after the selected post from ancestor context', () => {
  document.body.innerHTML =
    article('111', 'Parent') + article('222', 'Selected') + article('333', 'Reply');
  expect(conversationPosts(document, '222').map((x) => x.id)).toEqual(['111', '222']);
});
it('does not mistake a repost action for the native quote action', () => {
  document.body.innerHTML =
    '<div role="menu"><div role="menuitem">Repost</div><a role="menuitem" href="/compose/post">Quote</a></div>';
  expect(findQuoteItem(document.querySelector('[role=menu]')!)?.textContent).toBe('Quote');
});
it('prevents automatic insertion after edits, cancellation, or a newer generation', () => {
  expect(
    canAutoInsert({
      generation: 2,
      currentGeneration: 2,
      baseline: '',
      currentText: '',
      revision: 0,
      currentRevision: 0,
      connected: true,
    }),
  ).toBe(true);
  expect(
    canAutoInsert({
      generation: 1,
      currentGeneration: 2,
      baseline: '',
      currentText: '',
      revision: 0,
      currentRevision: 0,
      connected: true,
    }),
  ).toBe(false);
  expect(
    canAutoInsert({
      generation: 2,
      currentGeneration: 2,
      baseline: '',
      currentText: 'My words',
      revision: 0,
      currentRevision: 1,
      connected: true,
    }),
  ).toBe(false);
  expect(
    canAutoInsert({
      generation: 2,
      currentGeneration: 2,
      baseline: '',
      currentText: '',
      revision: 0,
      currentRevision: 2,
      connected: true,
    }),
  ).toBe(false);
});
