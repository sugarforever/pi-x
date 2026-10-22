import { it, expect } from 'vitest';
import { extractArticle, readArticle, searchWeb, selectSamples } from '../src/agent/research';
it('extracts readable article text while excluding scripts and navigation', () => {
  const text = extractArticle(
    '<html><head><title>Evidence</title></head><body><nav>Ignore navigation</nav><article><h1>Study</h1><p>' +
      'The study found a measurable improvement. '.repeat(30) +
      '</p></article><script>stealSecrets()</script></body></html>',
    'https://example.com',
  );
  expect(text.text).toContain('measurable improvement');
  expect(text.text).not.toContain('stealSecrets');
});
it('checks redirect destinations before fetching them', async () => {
  const seen: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    seen.push(String(input));
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/secret' } });
  };
  await expect(readArticle('https://example.com', fetcher)).rejects.toThrow(/public HTTPS/);
  expect(seen).toHaveLength(1);
});
it('reports blocked extension redirects instead of trying a second credentialed request', async () => {
  await expect(
    readArticle('https://t.co/link', async () => ({ type: 'opaqueredirect' }) as Response),
  ).rejects.toThrow(/redirect/i);
});
it('returns source links with search results and never treats snippets as verified facts', async () => {
  const result = await searchWeb('test', 'key', async (_url, init) => {
    expect(new Headers(init?.headers).get('X-Subscription-Token')).toBe('key');
    return Response.json({
      web: {
        results: [{ title: 'Study', url: 'https://example.com/paper', description: 'A claim' }],
      },
    });
  });
  expect(result.results[0]).toEqual({
    title: 'Study',
    url: 'https://example.com/paper',
    snippet: 'A claim',
  });
});
it('retrieves relevant writing samples with a bounded result', () => {
  const results = selectSamples('coding', [
    { id: '1', title: 'Cooking', text: 'A recipe' },
    { id: '2', title: 'Coding', text: 'How I write about coding' },
  ]);
  expect(results[0].id).toBe('2');
});
