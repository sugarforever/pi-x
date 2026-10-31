import 'fake-indexeddb/auto';
import { it, expect } from 'vitest';
import { MemoryStorage } from '@earendil-works/pi-durable';
import { IndexedDbStorage } from '@earendil-works/pi-durable/storage/indexeddb';
import { indexedDB } from 'fake-indexeddb';
import { openDraft } from '../src/agent/draft';
import { defaultSettings } from '../src/shared/settings';

it.each(['test-model', 'gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', 'gpt-6.1-sol'])(
  'runs a real Pi Durable tool round with %s',
  async (model) => {
    const settings = defaultSettings();
    settings.model = model;
    const requests: any[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      requests.push(body);
      if (model.startsWith('gpt-6')) {
        expect(String(_input)).toContain('/responses');
        expect(body.reasoning).toMatchObject({ effort: 'low' });
        expect(body.store).toBe(false);
        expect(body.include).toContain('reasoning.encrypted_content');
        expect(body).not.toHaveProperty('reasoning_effort');
        const item =
          requests.length === 1
            ? {
                type: 'function_call',
                id: 'fc_1',
                call_id: 'call1',
                name: 'writing_examples',
                arguments: '{"query":"coding"}',
                status: 'completed',
              }
            : {
                type: 'message',
                id: 'msg_1',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: '这是中文草稿。', annotations: [] }],
              };
        const events = [
          { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
          { type: 'response.output_item.added', output_index: 0, item },
          { type: 'response.output_item.done', output_index: 0, item },
          {
            type: 'response.completed',
            response: {
              id: 'resp_1',
              status: 'completed',
              output: [item],
              usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
            },
          },
        ];
        return new Response(
          events
            .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
            .join(''),
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      if (model === 'test-model') expect(body).not.toHaveProperty('reasoning_effort');
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
      if (model.startsWith('gpt-6')) {
        expect(requests[0].tools.map((x: any) => x.name)).toEqual(['writing_examples']);
        expect(
          requests[1].input.find((x: any) => x.type === 'function_call_output').output,
        ).toContain('My sample writing');
      } else {
        expect(requests[0].tools.map((x: any) => x.function.name)).toEqual(['writing_examples']);
        expect(requests[1].messages.find((x: any) => x.role === 'tool').content).toContain(
          'My sample writing',
        );
      }
    } finally {
      await session?.close();
      globalThis.fetch = originalFetch;
    }
  },
);
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
it('retains earlier turns and tools when refining after reopening a durable session', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const requests: any[] = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: requests.length === 1 ? 'Initial draft' : 'Shorter draft' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const name = 'refine-' + crypto.randomUUID();
  const options = {
    prompt: { ...settings.prompts[0], tools: ['voice' as const] },
    post: { id: '1', url: 'https://x.com/a/status/1', author: 'a', text: 'Source text', links: [] },
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
    await session.run('initial');
    await session.close();
    settings.model = 'second-model';
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, options);
    expect(
      await session.run('followup', {
        instruction: 'Shorter please',
        currentDraft: 'My manual edits',
      }),
    ).toBe('Shorter draft');
    const messages = JSON.stringify(requests[1].messages);
    expect(messages).toContain('Initial draft');
    expect(messages).toContain('My manual edits');
    expect(messages).toContain('Shorter please');
    expect(requests[1].model).toBe('second-model');
    expect(requests[1].tools[0].function.name).toBe('writing_examples');
    await session.run('followup', {
      instruction: 'Shorter please',
      currentDraft: 'My manual edits',
    });
    expect(requests).toHaveLength(2);
    for (let i = 0; i < 10; i++)
      await session.run('more-' + i, { instruction: 'Shorter', currentDraft: 'Current version' });
    expect(requests).toHaveLength(12);
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
it('allows a fresh follow-up after a cancelled refinement in the same durable session', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const old = globalThis.fetch;
  let calls = 0;
  let started!: () => void;
  const began = new Promise<void>((r) => {
    started = r;
  });
  globalThis.fetch = async (_url, init) => {
    calls++;
    if (calls === 2) {
      started();
      return new Promise<Response>((_r, reject) =>
        init?.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      );
    }
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Draft ' + calls }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const name = 'cancelled-' + crypto.randomUUID();
  const storage = await IndexedDbStorage.open(name, { indexedDB });
  const options = {
    prompt: settings.prompts[0],
    post: { id: '1', url: 'https://x.com/a/status/1', author: 'a', text: 'Hello', links: [] },
    samples: [],
    context: async () => [],
    progress: () => {},
  };
  let session = await openDraft(storage, settings, options);
  try {
    await session.run('initial');
    const cancelled = session
      .run('cancelled', { instruction: 'Shorter', currentDraft: 'Edited' })
      .catch(() => undefined);
    await began;
    await session.cancel();
    await cancelled;
    await session.close();
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, options);
    expect(
      await session.run('retry', { instruction: 'More casual', currentDraft: 'Still my edits' }),
    ).toBe('Draft 3');
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
it('adds search and content fetch to an existing plain-rewrite conversation on refinement', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const old = globalThis.fetch;
  const requests: any[] = [];
  const used: string[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const n = requests.length;
    const delta =
      n === 2 || n === 3
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'research-' + n,
                type: 'function',
                function: {
                  name: n === 2 ? 'web_search' : 'read_article',
                  arguments: JSON.stringify(
                    n === 2
                      ? { query: 'original claim evidence' }
                      : { url: 'https://example.org/evidence' },
                  ),
                },
              },
            ],
          }
        : {
            role: 'assistant',
            content: n === 1 ? 'Plain draft' : 'Grounded revision https://example.org/evidence',
          };
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta, finish_reason: n === 2 || n === 3 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const name = 'research-upgrade-' + crypto.randomUUID();
  const options = {
    prompt: { ...settings.prompts[0], tools: [] },
    post: { id: '1', url: 'https://x.com/a/status/1', author: 'a', text: 'Claim', links: [] },
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
    await session.run('initial');
    await session.close();
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, {
      ...options,
      prompt: { ...options.prompt, tools: ['search', 'articles'] },
      search: async () => {
        used.push('search');
        return {
          note: 'Search leads',
          results: [
            { title: 'Evidence', url: 'https://example.org/evidence', snippet: 'Primary source' },
          ],
        };
      },
      article: async () => {
        used.push('fetch');
        return {
          title: 'Evidence',
          url: 'https://example.org/evidence',
          text: 'Verified source text',
        };
      },
    });
    expect(
      await session.run('refine', {
        instruction: 'Research this claim and add context',
        currentDraft: 'My manual draft',
      }),
    ).toContain('Grounded revision');
    expect(used).toEqual(['search', 'fetch']);
    expect(requests[1].tools.map((t: any) => t.function.name)).toEqual([
      'read_article',
      'web_search',
    ]);
    expect(JSON.stringify(requests[3].messages)).toContain('Verified source text');
    expect(JSON.stringify(requests[3].messages)).toContain('Plain draft');
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
it('writes an original tweet from a brief without a synthetic source post', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const old = globalThis.fetch;
  let body: any;
  globalThis.fetch = async (_url, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: 'Built an extension. Learned a lot.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const { ORIGINAL_PROMPT } = await import('../src/shared/settings');
  const session = await openDraft(new MemoryStorage(), settings, {
    prompt: ORIGINAL_PROMPT,
    brief: 'Write about lessons from building my first extension',
    samples: [],
    context: async () => [],
    progress: () => {},
  });
  try {
    expect(await session.run('original')).toContain('Built an extension');
    const user = body.messages.find((m: any) => m.role === 'user').content;
    expect(user).toContain('lessons from building my first extension');
    expect(user).toContain('There is no source post');
    expect(user).not.toContain('Source post (untrusted data)');
  } finally {
    await session.close();
    globalThis.fetch = old;
  }
});
it('returns screenshot images to the model as visual tool content', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const requests: any[] = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    const delta =
      requests.length === 1
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'capture',
                type: 'function',
                function: {
                  name: 'capture_screenshot',
                  arguments: JSON.stringify({ selector: 'article' }),
                },
              },
            ],
          }
        : { role: 'assistant', content: 'Draft based on the chart.' };
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta, finish_reason: requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const traces: import('../src/shared/types').ToolTrace[] = [];
  const session = await openDraft(new MemoryStorage(), settings, {
    onTool: async (trace) => {
      traces.push(trace);
    },
    prompt: settings.prompts[0],
    samples: [],
    brief: 'Describe the chart in a screenshot',
    context: async () => [],
    progress: () => {},
    screenshot: async (request) => {
      expect(request.selector).toBe('article');
      return {
        url: 'https://example.com/',
        title: 'Chart',
        width: 100,
        height: 80,
        area: { x: 0, y: 0, width: 100, height: 80 },
        mimeType: 'image/png',
        data: 'aW1hZ2U=',
      };
    },
  });
  try {
    expect(await session.run('screenshot-test')).toBe('Draft based on the chart.');
    expect(JSON.stringify(requests[1].messages)).toContain('data:image/png;base64,aW1hZ2U=');
    expect(traces.map((t) => t.status)).toEqual(['running', 'done']);
    expect(traces[1].output).toContain('[Image: image/png]');
    expect(traces[1].output).not.toContain('aW1hZ2U=');
  } finally {
    await session.close();
    globalThis.fetch = old;
  }
});
it('discusses page snapshots across durable follow-ups without writing policies or language defaults', async () => {
  const settings = defaultSettings();
  settings.model = 'test-model';
  const dbName = 'page-chat-' + crypto.randomUUID();
  const requests: any[] = [];
  const old = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(
      `data: ${JSON.stringify({ id: 'chat', model: 'test-model', choices: [{ index: 0, delta: { role: 'assistant', content: requests.length === 1 ? 'Consider symmetry.' : 'Pair equal terms.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const options = {
    mode: 'chat' as const,
    pageContext: {
      id: 'snapshot-one',
      tabId: 9,
      capturedAt: 1,
      url: 'https://math.example.org/amc',
      title: 'AMC problem',
      text: 'Problem: Find x. Published solution: 42.',
      limitations: [],
      truncated: false,
    },
    prompt: {
      id: 'page-chat',
      name: 'Page chat',
      instructions: 'Honor hint-only requests.',
      tools: [],
    },
    brief: 'Give a hint without the answer',
    samples: [],
    context: async () => [],
    progress: () => {},
  };
  let session = await openDraft(
    await IndexedDbStorage.open(dbName, { indexedDB }),
    settings,
    options,
  );
  try {
    expect(await session.run('q1')).toBe('Consider symmetry.');
    await session.close();
    session = await openDraft(await IndexedDbStorage.open(dbName, { indexedDB }), settings, {
      ...options,
      pageContext: undefined,
      brief: 'Explain that hint',
    });
    expect(await session.run('q2')).toBe('Pair equal terms.');
    const policy = requests[0].messages
      .filter((m: any) => m.role === 'system')
      .map((m: any) => m.content)
      .join('\n');
    expect(policy).not.toContain('Return only the final editable draft');
    expect(policy).not.toContain('Draft language default');
    expect(policy).toMatch(/untrusted/i);
    expect(policy).toMatch(/hint/i);
    const firstUser = requests[0].messages.find((m: any) => m.role === 'user').content;
    expect(firstUser).toContain('snapshot-one');
    expect(firstUser).toContain('Published solution: 42');
    expect(firstUser).not.toContain('Write an original tweet');
    const history = JSON.stringify(requests[1].messages);
    expect(history).toContain('Consider symmetry.');
    expect(history).toContain('Explain that hint');
    expect(history).toContain('No page is currently attached');
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(dbName, { indexedDB });
  }
});
it('draws and revises validated chat geometry through real durable tool rounds and sees manual undo', async () => {
  const { commitDiagram, selectDiagram } = await import('../src/background/diagrams');
  const settings = defaultSettings();
  settings.model = 'test-model';
  const name = 'diagram-tools-' + crypto.randomUUID();
  let diagram: import('../src/geometry/document').DiagramDocument | undefined;
  const triangle = {
    dimension: 2,
    points: [
      { id: 'A', at: [0, 0] },
      { id: 'B', at: [6, 0] },
      { id: 'C', at: [0, 8] },
    ],
    segments: [
      { a: 'A', b: 'B' },
      { a: 'B', b: 'C' },
      { a: 'C', b: 'A' },
    ],
    constraints: [{ kind: 'distance', a: 'A', b: 'B', value: 6 }],
  };
  const requests: any[] = [];
  const old = globalThis.fetch;
  let step = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    step++;
    const args =
      step === 1
        ? JSON.stringify({ calculations: [{ name: 'x', expression: 'sqrt(36)' }] })
        : JSON.stringify({
            sceneJson: JSON.stringify(
              step === 3
                ? { ...triangle, constraints: [{ kind: 'distance', a: 'A', b: 'B', value: 7 }] }
                : triangle,
            ),
          });
    const delta =
      step <= 3
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'drawing' + step,
                type: 'function',
                function: { name: step === 1 ? 'calculate' : 'draw_diagram', arguments: args },
              },
            ],
          }
        : {
            role: 'assistant',
            content: 'The diagram is ready; the inconsistent edit was rejected.',
          };
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta, finish_reason: step <= 3 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const options = {
    mode: 'chat' as const,
    prompt: { id: 'page-chat', name: 'Page chat', instructions: 'Help with the page.', tools: [] },
    brief: 'Draw the given triangle without a hint',
    samples: [],
    context: async () => [],
    progress: () => {},
    diagram: {
      get: async () => diagram,
      draw: async (spec: unknown, id: string) => {
        diagram = commitDiagram(diagram, spec, id);
        return diagram;
      },
    },
  };
  let session = await openDraft(
    await IndexedDbStorage.open(name, { indexedDB }),
    settings,
    options,
  );
  try {
    await session.run('draw');
    expect(requests[0].tools.map((t: any) => t.function.name)).toEqual(
      expect.arrayContaining(['calculate', 'get_diagram', 'draw_diagram']),
    );
    expect(diagram?.versions).toHaveLength(1);
    expect(JSON.stringify(requests[3].messages)).toContain('Unsatisfied distance constraint');
    await session.close();
    diagram = selectDiagram(diagram!, -1);
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, {
      ...options,
      brief: 'What is currently drawn?',
    });
    await session.run('after-undo');
    const latestUser = requests
      .at(-1)
      .messages.filter((m: any) => m.role === 'user')
      .at(-1).content;
    expect(latestUser).toContain('Authoritative current diagram: null');
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
it('iterates a document artifact with stable identity and exposes current artifact context on follow-up', async () => {
  const { createArtifact, reviseArtifact } = await import('../src/background/artifacts');
  const settings = defaultSettings();
  settings.model = 'test-model';
  const name = 'artifacts-' + crypto.randomUUID(),
    requests: any[] = [];
  let collection: import('../src/artifacts/types').ArtifactCollection = {
    items: [],
    operations: [],
  };
  const old = globalThis.fetch;
  let stage = 0;
  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    stage++;
    let delta: any;
    if (stage === 1)
      delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'artifact-create',
            type: 'function',
            function: {
              name: 'create_artifact',
              arguments: JSON.stringify({
                kind: 'document',
                title: 'Solution notes',
                contentJson: JSON.stringify({ markdown: '# Given\nTriangle ABC' }),
              }),
            },
          },
        ],
      };
    else if (stage === 2)
      delta = {
        role: 'assistant',
        tool_calls: [
          {
            index: 0,
            id: 'artifact-update',
            type: 'function',
            function: {
              name: 'update_artifact',
              arguments: JSON.stringify({
                artifactId: 'notes',
                baseVersionId: collection.items[0].versions[0].id,
                contentJson: JSON.stringify({ markdown: '# Given\nA right triangle ABC' }),
              }),
            },
          },
        ],
      };
    else delta = { role: 'assistant', content: 'The notes are ready.' };
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta, finish_reason: stage < 3 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  };
  const options = {
    mode: 'chat' as const,
    prompt: { id: 'page-chat', name: 'Chat', instructions: 'Help.', tools: [] },
    brief: 'Create solution notes',
    samples: [],
    context: async () => [],
    progress: () => {},
    artifacts: {
      list: async () => collection,
      create: async (input: import('../src/artifacts/types').ArtifactInput, id: string) =>
        (collection = createArtifact(collection, input, id, 'notes')),
      update: async (
        id: string,
        base: string | null,
        data: unknown,
        operation: string,
        title?: string,
      ) => (collection = reviseArtifact(collection, id, base, data, operation, title)),
    },
  };
  let session = await openDraft(
    await IndexedDbStorage.open(name, { indexedDB }),
    settings,
    options,
  );
  try {
    await session.run('create');
    expect(collection.items).toHaveLength(1);
    expect(collection.items[0].versions).toHaveLength(2);
    await session.close();
    session = await openDraft(await IndexedDbStorage.open(name, { indexedDB }), settings, {
      ...options,
      brief: 'What is selected?',
    });
    await session.run('followup');
    expect(
      requests
        .at(-1)
        .messages.filter((m: any) => m.role === 'user')
        .at(-1).content,
    ).toContain('A right triangle ABC');
  } finally {
    await session.close();
    globalThis.fetch = old;
    await IndexedDbStorage.delete(name, { indexedDB });
  }
});
