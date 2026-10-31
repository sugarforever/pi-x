// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { extractPage, readBrowserPage } from '../src/background/browser-page';
afterEach(() => vi.unstubAllGlobals());
it('extracts article text and source metadata without navigation or scripts', () => {
  document.documentElement.innerHTML =
    '<head><title>Source</title></head><body><nav>Menu</nav><article><h1>Headline</h1><p>Evidence</p><script>secret()</script></article></body>';
  vi.stubGlobal('location', { href: 'https://example.com/story' });
  expect(extractPage()).toMatchObject({
    title: 'Source',
    url: 'https://example.com/story',
    text: 'Headline\nEvidence',
  });
});
it('reads a real-profile tab and closes only its own tab', async () => {
  vi.useFakeTimers();
  const page = { title: 'Source', url: 'https://example.com/', text: 'Evidence', truncated: false };
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    permissions: { contains: async () => true },
    tabs: {
      get: async () => ({ status: 'complete', url: 'https://example.com/' }),
      create: async () => ({ id: 7 }),
      remove,
    },
    scripting: { executeScript: async () => [{ result: page }] },
  });
  const result = readBrowserPage('https://example.com/');
  await vi.runAllTimersAsync();
  expect(await result).toEqual(page);
  expect(remove).toHaveBeenCalledWith(7);
  vi.useRealTimers();
});
it('reports missing browser access before opening a tab', async () => {
  vi.stubGlobal('chrome', { permissions: { contains: async () => false } });
  await expect(readBrowserPage('https://example.com/')).rejects.toThrow(
    'Browser site access is missing',
  );
});
it('closes the tab when extraction fails', async () => {
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    permissions: { contains: async () => true },
    tabs: {
      get: async () => ({ status: 'complete', url: 'https://example.com/' }),
      create: async () => ({ id: 8 }),
      remove,
    },
    scripting: {
      executeScript: async () => {
        throw new Error('No access');
      },
    },
  });
  await expect(readBrowserPage('https://example.com/')).rejects.toThrow('No access');
  expect(remove).toHaveBeenCalledWith(8);
});
it('captures metadata, selection, table structure and accessible math for page discussion', () => {
  document.documentElement.innerHTML = `<html lang="en"><head><title>AMC discussion</title><link rel="canonical" href="/amc/1"><meta name="author" content="Math Circle"><meta property="og:site_name" content="Practice"><meta name="description" content="A worked problem"><meta property="article:published_time" content="2026-10-01"></head><body><nav>Menu</nav><main><h1>Problem 1</h1><p>Find <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>x</mi></mrow><annotation encoding="application/x-tex">x^2 + 1</annotation></semantics></math></span><span class="katex-html">duplicate</span></span>.</p><table><tr><td>A</td><td>12</td></tr><tr><td>B</td><td>24</td></tr></table><img src="diagram.png" alt="Triangle ABC"><iframe src="/solution"></iframe></main></body></html>`;
  vi.stubGlobal('location', { href: 'https://example.com/amc?problem=1' });
  document.documentElement.lang = 'en';
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('h1')!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  const page = extractPage();
  expect(page).toMatchObject({
    canonicalUrl: 'https://example.com/amc/1',
    author: 'Math Circle',
    siteName: 'Practice',
    description: 'A worked problem',
    publishedAt: '2026-10-01',
    language: 'en',
    selection: 'Problem 1',
  });
  expect(page.text).toContain('x^2 + 1');
  expect(page.text).not.toContain('duplicate');
  expect(page.text).toContain('A | 12\nB | 24');
  expect(page.text).toContain('Triangle ABC');
  expect(page.limitations.join(' ')).toMatch(/images|diagrams/i);
  expect(page.limitations.join(' ')).toMatch(/frame/i);
});
it('bounds captures and marks unreadable content rather than claiming a complete page', () => {
  document.body.innerHTML = `<main><p>${'a'.repeat(25000)}</p></main>`;
  const page = extractPage();
  expect(page.text.length).toBe(24000);
  expect(page.truncated).toBe(true);
  expect(page.limitations.join(' ')).toMatch(/truncat/i);
  document.body.innerHTML = '<canvas></canvas>';
  expect(extractPage().limitations.join(' ')).toMatch(/readable text/i);
});

it('preserves code indentation and native fractions and exponents', () => {
  document.body.innerHTML =
    '<main><pre>def solve():\n    if True:\n        return "a  b"</pre><math><mfrac><mn>1</mn><mn>2</mn></mfrac><mo>+</mo><msup><mi>x</mi><mn>2</mn></msup></math></main>';
  const page = extractPage();
  expect(page.text).toContain('def solve():\n    if True:\n        return "a  b"');
  expect(page.text).toContain('(1)/(2)');
  expect(page.text).toContain('(x)^(2)');
});
