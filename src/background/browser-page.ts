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
  const limitations: string[] = [];
  if (source.querySelector('img, svg, canvas'))
    limitations.push(
      'Images and diagrams are not included in text. Request a screenshot for visual details.',
    );
  if (source.querySelector('iframe, frame'))
    limitations.push('Embedded frame content is not included.');
  copy.querySelectorAll('.katex-html').forEach((node) => node.remove());
  const mathText = (node: Element): string => {
    const children = Array.from(node.children);
    const parts = children.map(mathText);
    if (node.localName === 'mfrac') return `(${parts[0] || ''})/(${parts[1] || ''})`;
    if (node.localName === 'msup') return `(${parts[0] || ''})^(${parts[1] || ''})`;
    if (node.localName === 'msub') return `(${parts[0] || ''})_(${parts[1] || ''})`;
    if (node.localName === 'msqrt') return `sqrt(${parts.join('')})`;
    return children.length ? parts.join('') : node.textContent || '';
  };
  copy.querySelectorAll('math').forEach((node) => {
    const tex = node.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    node.replaceWith(` $${tex || mathText(node)}$ `);
  });
  copy
    .querySelectorAll('img')
    .forEach((node) => node.replaceWith(node.alt ? `[Image: ${node.alt}]` : '[Image]'));
  copy.querySelectorAll('tr').forEach((row) => {
    row.replaceWith(
      Array.from(row.querySelectorAll('th, td'), (cell) => cell.textContent?.trim() || '').join(
        ' | ',
      ) + '\n',
    );
  });
  const code: string[] = [];
  const codeMarker = `PI_CODE_${Math.random().toString(36).slice(2)}_`;
  copy.querySelectorAll('pre, code').forEach((node) => {
    if (!copy.contains(node)) return;
    const value = node.textContent || '';
    const index = code.push(value) - 1;
    node.replaceWith(
      `${node.tagName.toLowerCase() === 'pre' ? '\n' : ''}${codeMarker}${index}_END${node.tagName.toLowerCase() === 'pre' ? '\n' : ''}`,
    );
  });
  copy
    .querySelectorAll('p, div, section, h1, h2, h3, h4, li, br, blockquote, pre')
    .forEach((node) => node.append('\n'));
  const text = (copy.textContent || '')
    .replace(/[\t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(new RegExp(`${codeMarker}(\\d+)_END`, 'g'), (_, index) => code[Number(index)]);
  if (text.length > 24000) limitations.push('Page text is truncated to 24,000 characters.');
  if (!text)
    limitations.push(
      'No readable text was found. The page may need a screenshot, login, or more time to load.',
    );
  const meta = (...keys: string[]) => {
    for (const key of keys) {
      const value = document
        .querySelector<HTMLMetaElement>(`meta[name="${key}"], meta[property="${key}"]`)
        ?.content?.trim();
      if (value) return value.slice(0, 2000);
    }
    return undefined;
  };
  let canonicalUrl: string | undefined;
  try {
    const href = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
    const url = href ? new URL(href, location.href) : undefined;
    if (url && ['http:', 'https:'].includes(url.protocol)) canonicalUrl = url.href;
  } catch {
    /* Invalid metadata is omitted. */
  }
  return {
    url: location.href,
    canonicalUrl,
    author: meta('author', 'article:author'),
    siteName: meta('og:site_name'),
    description: meta('description', 'og:description'),
    publishedAt: meta('article:published_time', 'date'),
    updatedAt: meta('article:modified_time'),
    language: document.documentElement.lang || undefined,
    selection: window.getSelection()?.toString().trim().slice(0, 8000) || undefined,
    limitations,
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
