// @vitest-environment jsdom
import { it, expect } from 'vitest';
import {
  extractPost,
  conversationPosts,
  findQuoteItem,
  canAutoInsert,
  hasQuotedPost,
} from '../src/content/dom';
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
it('requires the original quote attachment before generating into a composer', async () => {
  const { hasQuotedPost } = await import('../src/content/dom');
  const post = {
    id: '123',
    url: 'https://x.com/author/status/123',
    author: 'Author @author',
    text: 'Original source',
    links: [],
  };
  document.body.innerHTML =
    '<div role="dialog"><div data-testid="tweetTextarea_0" contenteditable="true"></div></div>';
  const dialog = document.querySelector('[role=dialog]')!;
  expect(hasQuotedPost(dialog, post)).toBe(false);
  dialog.insertAdjacentHTML(
    'beforeend',
    '<div data-testid="attachments"><div data-testid="User-Name">Author @author</div><div data-testid="tweetText">Different post</div></div>',
  );
  expect(hasQuotedPost(dialog, post)).toBe(false);
  dialog.querySelector('[data-testid=tweetText]')!.textContent = 'Original source';
  expect(hasQuotedPost(dialog, post)).toBe(true);
  dialog.querySelector('[data-testid=User-Name]')!.textContent = 'Someone @other';
  expect(hasQuotedPost(dialog, post)).toBe(false);
});
it('lets the managed editor handle paste without also inserting unmanaged duplicate text', async () => {
  const { vi } = await import('vitest');
  const { insertDraft } = await import('../src/content/dom');
  class Transfer {
    values = new Map<string, string>();
    setData(type: string, value: string) {
      this.values.set(type, value);
    }
    getData(type: string) {
      return this.values.get(type) || '';
    }
  }
  class Paste extends Event {
    clipboardData: Transfer;
    constructor(type: string, init: any) {
      super(type, init);
      this.clipboardData = init.clipboardData;
    }
  }
  vi.stubGlobal('DataTransfer', Transfer);
  vi.stubGlobal('ClipboardEvent', Paste);
  document.body.innerHTML = '<div contenteditable="true"><div data-contents="true"></div></div>';
  const editor = document.querySelector<HTMLElement>('[contenteditable]')!;
  editor.addEventListener('paste', (event) => {
    event.preventDefault();
    editor.textContent = (event as unknown as Paste).clipboardData.getData('text/plain');
  });
  const prior = Object.getOwnPropertyDescriptor(document, 'execCommand');
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: (_cmd: string, _ui: boolean, text: string) => {
      editor.textContent = text + text;
      return true;
    },
  });
  try {
    expect(insertDraft(editor, 'One draft')).toBe(true);
    expect(editor.textContent).toBe('One draft');
  } finally {
    vi.unstubAllGlobals();
    if (prior) Object.defineProperty(document, 'execCommand', prior);
    else Reflect.deleteProperty(document, 'execCommand');
  }
});
it('marks collapsed source posts and expands only the requested post', async () => {
  const { expandPost } = await import('../src/content/dom');
  document.body.innerHTML = article('123', 'Collapsed text…') + article('456', 'Other text…');
  for (const root of document.querySelectorAll('article')) {
    const more = document.createElement('button');
    more.dataset.testid = 'tweet-text-show-more-link';
    more.onclick = () => {
      root.querySelector('[data-testid="tweetText"]')!.textContent =
        'Full source including the final paragraph.';
      more.remove();
    };
    root.append(more);
  }
  expect(extractPost(document.querySelector('article')!)?.truncated).toBe(true);
  expandPost(document, '123');
  expect(extractPost(document.querySelector('article')!)?.text).toContain('final paragraph');
  expect(extractPost(document.querySelectorAll('article')[1])?.truncated).toBe(true);
});
it('uses the outer post permalink when quoted timestamps appear first', () => {
  document.body.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name">lauren @poteto</div><div data-testid="tweetText">Full original source</div><div role="link"><time>7h</time><a href="/mattyp/status/999"><time>Quoted time</time></a><div data-testid="tweetText">Embedded quoted post</div></div><a href="/poteto/status/2115133011352240581"><time>5:26 PM</time></a><button data-testid="retweet">Repost</button></article>`;
  expect(extractPost(document.querySelector('article')!)).toMatchObject({
    id: '2115133011352240581',
    url: 'https://x.com/poteto/status/2115133011352240581',
    text: 'Full original source',
  });
});
it('reads an X Article title, paragraphs and table without ordinary tweetText', () => {
  document.body.innerHTML = `<article data-testid="tweet"><div data-testid="User-Name">mem0 @mem0ai</div><article data-testid="twitterArticleReadView"><div data-testid="twitter-article-title">How to choose a memory model</div><div data-testid="twitterArticleRichTextView"><p>Introduction</p><table><tr><th>Model</th><th>Cost</th></tr><tr><td>Example</td><td>$3.55</td></tr></table><p>Final conclusion.</p></div></article><a href="/mem0ai/status/2115094349466022038"><time>Today</time></a></article>`;
  const post = extractPost(document.querySelector('article')!);
  expect(post?.articleTitle).toBe('How to choose a memory model');
  expect(post?.text).toContain('$3.55');
  expect(post?.text).toContain('Final conclusion.');
  expect(post?.text).toMatch(/Introduction\n/);
});
it('recognizes an article quote card by its author and title without tweetText', () => {
  const post = {
    id: '1',
    url: 'https://x.com/mem0ai/status/1',
    author: 'mem0',
    text: 'How to choose a memory model\nFull article.',
    links: [],
    articleTitle: 'How to choose a memory model',
  };
  document.body.innerHTML =
    '<div role="dialog"><div data-testid="attachments"><div data-testid="User-Name">mem0 @mem0ai</div><div data-testid="article-cover-image"></div>How to choose a memory model</div></div>';
  expect(hasQuotedPost(document.querySelector('[role="dialog"]')!, post)).toBe(true);
  expect(
    hasQuotedPost(document.querySelector('[role="dialog"]')!, {
      ...post,
      articleTitle: 'Another article',
    }),
  ).toBe(false);
});
