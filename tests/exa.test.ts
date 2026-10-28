import { it, expect } from 'vitest';
import { searchExa, fetchExa } from '../src/agent/exa';
it('calls keyless Exa search and handles event-stream frames', async () => {
  const result = await searchExa('climate evidence', async (url, init) => {
    expect(String(url)).toBe('https://mcp.exa.ai/mcp');
    expect(init?.credentials).toBe('omit');
    expect(init?.redirect).toBe('error');
    const headers = new Headers(init?.headers);
    expect(headers.has('Authorization')).toBe(false);
    const body = JSON.parse(String(init?.body));
    expect(body.params).toMatchObject({
      name: 'web_search_exa',
      arguments: {
        query: 'climate evidence',
        numResults: 5,
        objective: 'Find reliable sources relevant to: climate evidence',
      },
    });
    return new Response(
      ': keepalive\n\nevent: message\ndata: ' +
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{ type: 'text', text: 'Title: Study\nURL: https://example.org\nEvidence' }],
          },
        }) +
        '\n\n',
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  expect(result.content).toContain('Evidence');
});
it('fetches a validated URL through Exa and accepts JSON responses', async () => {
  const result = await fetchExa('https://example.org/a', async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    expect(body.params).toEqual({
      name: 'web_fetch_exa',
      arguments: { urls: ['https://example.org/a'], maxCharacters: 18000 },
    });
    return Response.json({
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: 'Page content' }] },
    });
  });
  expect(result.content).toBe('Page content');
  let called = false;
  await expect(
    fetchExa('https://localhost/a', async () => {
      called = true;
      throw Error();
    }),
  ).rejects.toThrow();
  expect(called).toBe(false);
});
it('reports rate limits and MCP errors without treating them as results', async () => {
  await expect(searchExa('q', async () => new Response('', { status: 429 }))).rejects.toThrow(
    /rate limit/i,
  );
  for (const error of [
    { error: { message: 'Unavailable' } },
    { result: { isError: true, content: [{ type: 'text', text: 'Unavailable' }] } },
  ])
    await expect(
      searchExa('q', async (_url, init) =>
        Response.json({ id: JSON.parse(String(init?.body)).id, ...error }),
      ),
    ).rejects.toThrow(/Exa/);
});
