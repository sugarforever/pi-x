// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  extractPost,
  conversationPosts,
  findQuoteEditor,
  editorText,
  insertDraft,
} from '../src/content/dom';
import { installDraftLaunchers } from '../src/content/launchers';

const fixture = (name: string) => readFileSync(`tests/fixtures/x-redesign-${name}.html`, 'utf8');
const post = {
  id: '2125275496355348799',
  url: 'https://x.com/ChanduThota/status/2125275496355348799',
  author: 'ChanduThota',
  text: 'We are making Workspace MCP servers',
  links: [],
};

it('reads the redesigned post without test IDs or time elements', () => {
  document.body.innerHTML = fixture('post');
  expect(extractPost(document.querySelector('article')!)).toMatchObject({
    id: post.id,
    url: post.url,
  });
  expect(extractPost(document.querySelector('article')!)?.text).toContain('🧵1/3');
  expect(conversationPosts(document, post.id)).toHaveLength(1);
});

it('binds only the matching redesigned quote card to its textarea', () => {
  document.body.innerHTML = fixture('editor');
  expect(findQuoteEditor(document, post, false)?.editor).toBe(document.querySelector('textarea'));
  expect(
    findQuoteEditor(document, { ...post, id: '999', url: 'https://x.com/other/status/999' }, false),
  ).toBeUndefined();
});

it('reads and inserts textarea drafts through the native input event', () => {
  document.body.innerHTML = fixture('editor');
  const editor = document.querySelector('textarea')!;
  editor.value = 'My draft';
  expect(editorText(editor)).toBe('My draft');
  let received = '';
  editor.addEventListener('input', () => {
    received = editor.value;
  });
  expect(insertDraft(editor, 'Replacement')).toBe(true);
  expect(received).toBe('Replacement');
});

it('offers Write with AI in a redesigned plain composer but not a quote', () => {
  document.body.innerHTML = fixture('editor');
  installDraftLaunchers(document, () => {});
  expect(document.querySelector('[data-pi-x-draft-launcher]')).toBeNull();
  document.querySelector('article')!.remove();
  installDraftLaunchers(document, () => {});
  expect(document.querySelector('[data-pi-x-draft-launcher]')).not.toBeNull();
});

it('adds Pi Quote after a redesigned repost button opens the menu', async () => {
  document.body.innerHTML = fixture('post');
  vi.stubGlobal('chrome', {
    runtime: { onMessage: { addListener() {} }, sendMessage: async () => ({ ok: false }) },
  });
  const observers: MutationObserver[] = [];
  const NativeObserver = MutationObserver;
  vi.stubGlobal(
    'MutationObserver',
    class extends NativeObserver {
      constructor(callback: MutationCallback) {
        super(callback);
        observers.push(this);
      }
    },
  );
  await import('../src/content/index');
  document
    .querySelector('[data-engagement-action="retweet"] button')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  document.body.insertAdjacentHTML(
    'beforeend',
    '<div role="menu"><button role="menuitem">Repost</button><a role="menuitem" href="/compose/post?quote_tweet_id=2125275496355348799">Quote</a></div>',
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.querySelector('[data-pi-x="quote"]')?.textContent).toContain('Pi Quote');
  observers.forEach((observer) => observer.disconnect());
  vi.unstubAllGlobals();
});

it('does not offer a plain-compose launcher on a full-page quote', () => {
  document.body.innerHTML = fixture('editor');
  document.querySelector('[role="dialog"]')!.removeAttribute('role');
  installDraftLaunchers(document, () => {});
  expect(document.querySelector('[data-pi-x-draft-launcher]')).toBeNull();
});

it('keeps nested quote cards out of conversation entries', () => {
  document.body.innerHTML = fixture('post');
  const outer = document.querySelector('article')!;
  const quoted = outer.cloneNode(true) as Element;
  quoted
    .querySelectorAll('a[href]')
    .forEach((a) =>
      a.setAttribute(
        'href',
        (a.getAttribute('href') || '').replaceAll('2125275496355348799', '999'),
      ),
    );
  outer.append(quoted);
  const next = outer.cloneNode(true) as Element;
  next.querySelector('article')!.remove();
  next
    .querySelectorAll('a[href]')
    .forEach((a) =>
      a.setAttribute(
        'href',
        (a.getAttribute('href') || '').replaceAll('2125275496355348799', '888'),
      ),
    );
  document.body.append(next);
  expect(conversationPosts(document, '888').map((p) => p.id)).toEqual([
    '2125275496355348799',
    '888',
  ]);
});
