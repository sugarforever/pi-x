import { zstdDecompressSync } from 'node:zlib';
import { it, expect } from 'vitest';
import { configuredModels } from '../src/agent/models';

it.each([
  ['https://api.openai.com/v1', 'gpt-5.2', 'max_completion_tokens'],
  ['https://proxy.example.com/v1', 'gpt-5.2', 'max_completion_tokens'],
  ['https://api.deepseek.com/v1', 'deepseek-chat', 'max_tokens'],
])('uses the supported token limit for %s', async (baseUrl, model, field) => {
  const old = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body));
    if (!(field in payload!))
      return Response.json(
        { error: { message: 'Unsupported token limit parameter', type: 'invalid_request_error' } },
        { status: 400 },
      );
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model, choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  try {
    const models = configuredModels({ baseUrl, model, apiKey: 'fixture-key' });
    const result = await models.completeSimple(
      models.getModel('configured', model)!,
      { messages: [{ role: 'user', content: 'Reply OK', timestamp: Date.now() }] },
      { maxRetries: 0 },
    );
    expect(result.stopReason, result.errorMessage).toBe('stop');
    expect(payload).not.toHaveProperty('reasoning_effort');
    expect(payload?.[field]).toBe(2048);
    expect(payload).not.toHaveProperty(
      field === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens',
    );
  } finally {
    globalThis.fetch = old;
  }
});

it('routes subscription requests to Codex regardless of the custom base URL or API key', async () => {
  const old = globalThis.fetch;
  const token = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-test' } }))}.signature`;
  let requestUrl = '';
  let headers = new Headers();
  let body: Record<string, unknown> = {};
  globalThis.fetch = async (url, init) => {
    requestUrl = String(url);
    headers = new Headers(init?.headers);
    body = JSON.parse(
      headers.get('content-encoding') === 'zstd'
        ? zstdDecompressSync(init!.body as Uint8Array).toString()
        : String(init?.body),
    );
    return new Response(
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp-1', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  try {
    const models = configuredModels(
      {
        provider: 'chatgpt',
        baseUrl: 'https://untrusted.example/v1',
        apiKey: 'do-not-use',
        model: 'gpt-5.2',
      },
      async () => ({ apiKey: token }),
    );
    expect(models.getModel('configured', 'gpt-5.2')!.api).toBe('openai-codex-responses');
    const result = await models.completeSimple(
      models.getModel('configured', 'gpt-5.2')!,
      { messages: [{ role: 'user', content: 'OK', timestamp: Date.now() }] },
      { maxRetries: 0 },
    );
    expect(result.stopReason, result.errorMessage).toBe('stop');
    expect(requestUrl).toBe('https://chatgpt.com/backend-api/codex/responses');
    expect(headers.get('authorization')).toBe(`Bearer ${token}`);
    expect(headers.get('chatgpt-account-id')).toBe('acct-test');
    expect(body.store).toBe(false);
    expect(body).not.toHaveProperty('messages');
  } finally {
    globalThis.fetch = old;
  }
});
it('never resolves subscription credentials for custom endpoint requests', async () => {
  let resolved = false;
  const models = configuredModels(
    {
      provider: 'openai-compatible',
      baseUrl: 'https://custom.example/v1',
      apiKey: 'custom-key',
      model: 'model',
    },
    async () => {
      resolved = true;
      throw new Error('Must not resolve subscription');
    },
  );
  const auth = await models.getAuth(models.getModel('configured', 'model')!);
  expect(auth?.auth.apiKey).toBe('custom-key');
  expect(resolved).toBe(false);
});
