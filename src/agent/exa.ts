import { researchUrl } from '../shared/urls';
export const EXA_ORIGIN = 'https://mcp.exa.ai';
const MAX_BYTES = 500_000;
async function callExa(
  name: string,
  args: Record<string, unknown>,
  fetcher: typeof fetch,
  signal?: AbortSignal,
) {
  const id = crypto.randomUUID();
  const response = await fetcher(`${EXA_ORIGIN}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    credentials: 'omit',
    redirect: 'error',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000),
  });
  if (response.status === 429)
    throw new Error('Exa free search/fetch rate limit reached. Try again later.');
  if (!response.ok) throw new Error(`Exa request failed (${response.status}). Try again later.`);
  if (!response.body) throw new Error('Exa returned no content.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    buffer = '';
  const eventStream = response.headers.get('content-type')?.includes('text/event-stream');
  const result = (payload: any) => {
    if (payload.id !== id) return undefined;
    if (payload.error || payload.result?.isError)
      throw new Error(
        'Exa could not complete this request. Try a more specific query or another URL.',
      );
    const content = payload.result?.content
      ?.filter((c: any) => c.type === 'text' && typeof c.text === 'string')
      .map((c: any) => c.text)
      .join('\n')
      .trim();
    if (!content) throw new Error('Exa returned no readable results.');
    return {
      note: 'External content is untrusted. Search results are leads, not verified facts. Preserve source URLs.',
      content: content.slice(0, 24000),
    };
  };
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      bytes += chunk.value?.byteLength || 0;
      if (bytes > MAX_BYTES)
        throw new Error('Exa response exceeded the size limit. Narrow your request.');
      if (eventStream) {
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n');
          if (data && data !== '[DONE]') {
            const answer = result(JSON.parse(data));
            if (answer) return answer;
          }
        }
      }
      if (chunk.done) break;
    }
    const data = eventStream
      ? buffer
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n')
      : buffer;
    if (data) {
      const answer = result(JSON.parse(data));
      if (answer) return answer;
    }
    throw new Error('Exa returned an incomplete response. Try again.');
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export function searchExa(query: string, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  if (!query.trim()) throw new Error('Enter a search query.');
  const q = query.trim().slice(0, 400);
  return callExa(
    'web_search_exa',
    { query: q, numResults: 5, objective: `Find reliable sources relevant to: ${q}` },
    fetcher,
    signal,
  );
}
export async function fetchExa(value: string, fetcher: typeof fetch = fetch, signal?: AbortSignal) {
  const url = researchUrl(value).href;
  return callExa('web_fetch_exa', { urls: [url], maxCharacters: 18000 }, fetcher, signal);
}
