import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { researchUrl } from '../shared/urls';
import type { WritingSample } from '../shared/types';
export function extractArticle(
  html: string,
  url: string,
): { url: string; title: string; text: string } {
  const { document } = parseHTML(html);
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head.prepend(base);
  document
    .querySelectorAll('script,style,nav,header,footer,form,iframe,noscript')
    .forEach((el) => el.remove());
  const article = new Readability(document as unknown as Document).parse();
  const text = (
    article?.textContent ||
    document.querySelector('article,main')?.textContent ||
    document.body.textContent ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!text)
    throw new Error('No readable article text found. The site may require a login or JavaScript.');
  return { url, title: article?.title || document.title || url, text: text.slice(0, 18000) };
}
async function boundedText(response: Response, limit = 1_500_000): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error('Page is too large to read.');
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel();
  }
}
export async function readArticle(
  value: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  let url = researchUrl(value);
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetcher(url.href, {
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
        : AbortSignal.timeout(20000),
    });
    if (response.type === 'opaqueredirect')
      throw new Error('This link redirects. Use the expanded article URL instead of a short link.');
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Cannot read this redirect. Use the final article URL.');
      url = researchUrl(new URL(location, url).href);
      continue;
    }
    if (!response.ok) throw new Error(`Article request failed (${response.status}).`);
    const type = response.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml\+xml/i.test(type))
      throw new Error('Only HTML and text articles are supported.');
    const text = await boundedText(response);
    return type.includes('text/plain')
      ? { url: url.href, title: url.hostname, text: text.slice(0, 18000) }
      : extractArticle(text, url.href);
  }
  throw new Error('Too many article redirects.');
}
export async function searchWeb(
  query: string,
  key: string,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  if (!key) throw new Error('Add a Brave Search API key in extension settings to enable research.');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query.slice(0, 400));
  url.searchParams.set('count', '5');
  const response = await fetcher(url.href, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    credentials: 'omit',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new Error(`Search failed (${response.status}). Check your Brave Search API key.`);
  const data = JSON.parse(await boundedText(response, 500000));
  const results = (data.web?.results || []).slice(0, 5).flatMap((item: Record<string, string>) => {
    try {
      return [
        {
          title: String(item.title || '').slice(0, 300),
          url: researchUrl(item.url).href,
          snippet: String(item.description || '').slice(0, 1500),
        },
      ];
    } catch {
      return [];
    }
  });
  return {
    note: 'Search snippets are leads, not independently verified facts. Read sources before claiming verification.',
    results,
  };
}
export function selectSamples(query: string, samples: WritingSample[]): WritingSample[] {
  const words = query
    .toLowerCase()
    .split(/[\s\p{P}]+/u)
    .filter(Boolean);
  return samples
    .map((sample, index) => ({
      sample,
      index,
      score: words.reduce(
        (n, w) => n + (`${sample.title} ${sample.text}`.toLowerCase().includes(w) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 5)
    .map(({ sample }) => ({ ...sample, text: sample.text.slice(0, 2400) }));
}
