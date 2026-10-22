import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { MemoryStorage } from '@earendil-works/pi-durable';
import { IndexedDbStorage } from '@earendil-works/pi-durable/storage/indexeddb';
import { indexedDB } from 'fake-indexeddb';
import { openDraft } from '../src/agent/draft';
import { defaultSettings } from '../src/shared/settings';

it('runs a real Pi Durable tool round against an OpenAI-compatible protocol', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const requests: any[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const message =
      requests.length === 1
        ? {
            content: null,
            tool_calls: [
              {
                id: 'call1',
                type: 'function',
                function: { name: 'writing_examples', arguments: '{"query":"coding"}' },
              },
            ],
          }
        : { content: '这是中文草稿。' };
    return new Response(
      `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', ...message }, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  let session: Awaited<ReturnType<typeof openDraft>> | undefined;
  try {
    session = await openDraft(new MemoryStorage(), settings, {
      prompt: { ...settings.prompts[0], tools: ['voice'] },
      post: {
        id: '123',
        url: 'https://x.com/author/status/123',
        text: 'Coding is fun',
        author: 'author',
        links: [],
      },
      samples: [{ id: 's1', title: 'Coding', text: 'My sample writing' }],
      context: async () => [],
      progress: () => {},
    });
    expect(await session.run('test-job')).toBe('这是中文草稿。');
    expect(requests[0].tools.map((x: any) => x.function.name)).toEqual(['writing_examples']);
    expect(requests[1].messages.find((x: any) => x.role === 'tool').content).toContain(
      'My sample writing',
    );
  } finally {
    await session?.close();
    globalThis.fetch = originalFetch;
  }
});
it('returns the persisted draft on reopening without another model request', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const options = {
    prompt: settings.prompts[0],
    post: {
      id: '123',
      url: 'https://x.com/author/status/123',
      text: 'Hello',
      author: 'author',
      links: [],
    },
    samples: [],
    context: async () => [],
    progress: () => {},
  };
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(
      'data: ' +
        JSON.stringify({
          id: 'c',
          model: 'test-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Saved draft' },
              finish_reason: 'stop',
            },
          ],
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const name = 'test-' + crypto.randomUUID();
  try {
    let session = await openDraft(
      await IndexedDbStorage.open(name, { indexedDB }),
      settings,
      options,
    );
    expect(await session.run('same-id')).toBe('Saved draft');
    await session.close();
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, options);
    expect(await session.run('same-id')).toBe('Saved draft');
    await session.close();
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
it('stops a model that keeps requesting tools after eight response turns', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const old = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    if (requests > 10) throw new Error('Test boundary reached');
    const payload = {
      id: 'c',
      model: 'test-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call${requests}`,
                type: 'function',
                function: { name: 'writing_examples', arguments: '{"query":"test"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2000);
  const session = await openDraft(new MemoryStorage(), settings, {
    prompt: { ...settings.prompts[0], tools: ['voice'] },
    post: { id: '1', url: 'https://x.com/a/status/1', author: 'a', text: 'Test', links: [] },
    samples: [],
    context: async () => [],
    progress: () => {},
    signal: controller.signal,
  });
  try {
    await expect(session.run('loop')).rejects.toThrow();
    expect(requests).toBe(8);
  } finally {
    clearTimeout(timer);
    await session.close();
    globalThis.fetch = old;
  }
});
it('resumes an interrupted generation from IndexedDB with the same submission', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const old = globalThis.fetch;
  let calls = 0;
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 1) {
      started();
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        });
      });
    }
    return new Response(
      'data: ' +
        JSON.stringify({
          id: 'c',
          model: 'test-model',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Recovered draft' },
              finish_reason: 'stop',
            },
          ],
        }) +
        '\n\ndata: [DONE]\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const name = 'interrupted-' + crypto.randomUUID();
  const options = {
    prompt: settings.prompts[0],
    post: { id: '1', url: 'https://x.com/a/status/1', author: 'a', text: 'Hello', links: [] },
    samples: [],
    context: async () => [],
    progress: () => {},
  };
  let session = await openDraft(
    await IndexedDbStorage.open(name, { indexedDB }),
    settings,
    options,
  );
  try {
    const pending = session.run('one-request').catch(() => undefined);
    await began;
    await session.close();
    await pending;
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, options);
    expect(await session.run('one-request')).toBe('Recovered draft');
    expect(calls).toBe(2);
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
