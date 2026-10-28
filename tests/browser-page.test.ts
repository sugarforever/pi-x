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
