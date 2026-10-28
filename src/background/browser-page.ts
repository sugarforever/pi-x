import { researchUrl } from '../shared/urls';

// This function is serialized by Chrome; keep it independent of module bindings.
export function extractPage() {
  const source = document.querySelector('article, main, [role="main"]') || document.body;
  const copy = source.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll(
      'script, style, noscript, nav, header, footer, aside, form, [hidden], [aria-hidden="true"]',
    )
    .forEach((node) => node.remove());
  copy
    .querySelectorAll('p, div, section, h1, h2, h3, h4, li, br, blockquote, pre')
    .forEach((node) => node.append('\n'));
  const text = (copy.textContent || '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    url: location.href,
    title: document.title,
    text: text.slice(0, 24000),
    truncated: text.length > 24000,
  };
}

export async function readBrowserPage(value: string, signal?: AbortSignal) {
  const url = researchUrl(value);
  signal?.throwIfAborted();
  if (!(await chrome.permissions.contains({ origins: [`${url.origin}/*`] }))) {
    throw new Error(
      'Browser site access is missing. Allow HTTPS site access for Pi Quote in Chrome’s extension manager, then retry.',
    );
  }
  const tab = await chrome.tabs.create({ url: url.href, active: false });
  if (tab.id === undefined) throw new Error('Could not open the page in Chrome.');
  const tabId = tab.id;
  const close = () => {
    void chrome.tabs.remove(tabId).catch(() => {});
  };
  signal?.addEventListener('abort', close, { once: true });
  try {
    signal?.throwIfAborted();
    await waitForPage(tabId, signal);
    signal?.throwIfAborted();
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: extractPage });
    signal?.throwIfAborted();
    const page = results[0]?.result;
    if (!page?.text)
      throw new Error(
        'The page returned no readable text. It may require login or still be loading.',
      );
    researchUrl(page.url);
    return page;
  } finally {
    signal?.removeEventListener('abort', close);
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

export async function waitForPage(tabId: number, signal?: AbortSignal) {
  const deadline = Date.now() + 25000;
  while (true) {
    signal?.throwIfAborted();
    const current = await chrome.tabs.get(tabId);
    if (current.status === 'complete' && current.url && current.url !== 'about:blank') {
      researchUrl(current.url);
      break;
    }
    if (Date.now() >= deadline) throw new Error('The page took too long to load in Chrome.');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  // Wait for navigation and a quiet DOM, allowing client-rendered articles to appear.
  await chrome.scripting.executeScript({
    target: { tabId },
    func: async () => {
      await new Promise<void>((resolve) => {
        let quiet: ReturnType<typeof setTimeout>;
        const finish = () => {
          clearTimeout(quiet);
          clearTimeout(limit);
          observer.disconnect();
          resolve();
        };
        const settle = () => {
          clearTimeout(quiet);
          if (document.readyState !== 'loading') quiet = setTimeout(finish, 1500);
        };
        const observer = new MutationObserver(settle);
        const limit = setTimeout(finish, 20000);
        observer.observe(document, { childList: true, subtree: true, characterData: true });
        settle();
      });
    },
  });
}
