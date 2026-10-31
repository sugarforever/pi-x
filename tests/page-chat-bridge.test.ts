import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { defaultSettings } from '../src/shared/settings';

async function setup(searchAllowed = true, artifactTool = false) {
  vi.resetModules();
  const settings = defaultSettings();
  settings.model = 'test-model';
  const data: Record<string, any> = { settings },
    session: Record<string, any> = {};
  const storage = (values: Record<string, any>) => ({
    get: async (keys: string | string[] | null) =>
      keys === null
        ? structuredClone(values)
        : Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((k) => [k, structuredClone(values[k])]),
          ),
    set: async (v: any) => {
      Object.assign(values, structuredClone(v));
    },
    remove: async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete values[k];
    },
    clear: async () => {
      for (const k of Object.keys(values)) delete values[k];
    },
    setAccessLevel: async () => {},
  });
  let listener: any, alarmListener: any, toolbarListener: any;
  const requests: any[] = [];
  let active = {
    id: 7,
    windowId: 42,
    active: true,
    url: 'https://math.example.org/amc',
    title: 'AMC',
  };
  let finishCreation!: () => void;
  let beganCreation!: () => void;
  const creationStarted = new Promise<void>((resolve) => {
    beganCreation = resolve;
  });
  const creationAllowed = new Promise<void>((resolve) => {
    finishCreation = resolve;
  });
  const changed = { addListener: vi.fn() };
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, fn: any) => fn() } });
  vi.stubGlobal('fetch', async (_url: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return new Response(
      `data: ${JSON.stringify({ id: 'c', model: 'test-model', choices: [{ index: 0, delta: artifactTool && requests.length === 1 ? { role: 'assistant', tool_calls: [{ index: 0, id: 'artifact', type: 'function', function: { name: 'create_artifact', arguments: JSON.stringify({ kind: 'document', title: 'Notes', contentJson: JSON.stringify({ markdown: '# Notes' }) }) } }] } : { role: 'assistant', content: 'Try symmetry.' }, finish_reason: artifactTool && requests.length === 1 ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  });
  vi.stubGlobal('chrome', {
    storage: { local: storage(data), session: storage(session) },
    runtime: {
      id: 'test',
      getURL: (p: string) => `chrome-extension://test/${p}`,
      onMessage: {
        addListener: (fn: any) => {
          listener = fn;
        },
      },
      onInstalled: changed,
      onStartup: changed,
    },
    action: {
      onClicked: {
        addListener: (fn: any) => {
          toolbarListener = fn;
        },
      },
    },
    sidePanel: { open: async () => {} },
    alarms: {
      onAlarm: {
        addListener: (fn: any) => {
          alarmListener = fn;
        },
      },
    },
    permissions: {
      contains: async ({ origins }: any) =>
        searchAllowed || !origins.some((o: string) => o.includes('mcp.exa.ai')),
    },
    tabs: {
      create: async () => {
        beganCreation();
        await creationAllowed;
        return { id: 9 };
      },
      update: async (id: number, update: any) => {
        active = { ...active, id, ...update };
        return active;
      },
      query: async () => [active],
      get: async () => active,
      sendMessage: async () => {
        throw new Error('No X script');
      },
      onUpdated: changed,
      onRemoved: changed,
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            url: active.url,
            title: active.title,
            text: 'Question: Find x. Solution: 42.',
            limitations: [],
            truncated: false,
          },
        },
      ],
    },
  });
  await import('../src/background/index');
  const rpc = (message: any, trusted = true, fragment = ''): Promise<any> =>
    new Promise((resolve) =>
      listener(
        message,
        {
          id: 'test',
          url: `chrome-extension://test/${trusted ? 'sidepanel.html' : 'other.html'}${fragment}`,
        },
        resolve,
      ),
    );
  return {
    data,
    session,
    creationStarted,
    finishCreation,
    requests,
    rpc,
    maintain: () => alarmListener({ name: 'pi-x-maintenance' }),
    toolbar: () => toolbarListener(active),
    navigate: (url = 'https://other.example.org/') => {
      active = { ...active, id: 8, url, title: 'Other page' };
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('opens a non-X page chat, admits follow-ups, and pins context across navigation and tab loss', async () => {
  const { rpc, data, requests, navigate } = await setup();
  const initial = await rpc({ type: 'panel:get', windowId: 42 });
  expect(initial.ok).toBe(true);
  expect(initial.value?.state.mode).toBe('chat');
  const id = initial.value.state.composerId;
  expect(requests).toHaveLength(0);
  const send = await rpc({
    type: 'panel:command',
    windowId: 42,
    tabId: 7,
    composerId: id,
    command: { action: 'refine', instruction: 'Only a hint' },
  });
  expect(send.ok).toBe(true);
  await vi.waitFor(() =>
    expect(Object.values(data).some((v: any) => v.mode === 'chat' && v.status === 'done')).toBe(
      true,
    ),
  );
  expect(
    requests[0].tools?.some((t: any) => t.function.name === 'capture_screenshot') || false,
  ).toBe(false);
  navigate();
  const after = await rpc({ type: 'panel:get', windowId: 42 });
  expect(after.value.state.composerId).toBe(id);
  expect(after.value.state.pageChanged).toBe(true);
  expect(after.value.state.pageContext.url).toBe('https://math.example.org/amc');
  const contextId = after.value.state.pageContext.id;
  expect((await rpc({ type: 'panel:chat', windowId: 42, action: 'refresh', id })).ok).toBe(true);
  const refreshed = await rpc({ type: 'panel:get', windowId: 42 });
  expect(refreshed.value.state.pageContext.url).toBe('https://other.example.org/');
  expect(refreshed.value.state.turns[0].context.id).toBe(contextId);
  expect((await rpc({ type: 'panel:chat', windowId: 42, action: 'remove', id })).ok).toBe(true);
  expect((await rpc({ type: 'panel:get', windowId: 42 })).value.state.pageContext).toBeUndefined();
  const denied = await rpc({ type: 'panel:chat', windowId: 42, action: 'delete', id }, false);
  expect(denied.ok).toBe(false);
  expect((await rpc({ type: 'panel:chat', windowId: 42, action: 'delete', id })).ok).toBe(true);
  expect(data[`chat:${id}`]).toBeUndefined();
  expect(Object.values(data).some((v: any) => v.sessionId === id)).toBe(false);
});

it('answers attached-page questions without optional search site access', async () => {
  const { rpc, data, requests } = await setup(false);
  const initial = await rpc({ type: 'panel:get', windowId: 42 });
  await rpc({
    type: 'panel:command',
    windowId: 42,
    composerId: initial.value.state.composerId,
    command: { action: 'refine', instruction: 'Explain the question' },
  });
  await vi.waitFor(() =>
    expect(Object.values(data).some((v: any) => v.mode === 'chat' && v.status === 'done')).toBe(
      true,
    ),
  );
  expect(requests[0].tools?.some((t: any) => t.function.name === 'web_search') || false).toBe(
    false,
  );
});

it('keeps all chat turns until the latest activity expires and then deletes the whole conversation', async () => {
  const { rpc, data, maintain } = await setup();
  const initial = await rpc({ type: 'panel:get', windowId: 42 });
  const id = initial.value.state.composerId;
  const oldTime = Date.now() - 25 * 60 * 60_000;
  data['job:old-chat-turn'] = {
    id: 'old-chat-turn',
    mode: 'chat',
    sessionId: id,
    tabId: 7,
    composerId: id,
    createdAt: oldTime,
    status: 'done',
    prompt: { id: 'page-chat', name: 'Page chat', instructions: '', tools: [] },
    brief: 'Original question',
    draft: 'Earlier answer',
  };
  await maintain();
  expect(data['job:old-chat-turn']?.draft).toBe('Earlier answer');
  data[`chat:${id}`].updatedAt = oldTime;
  await maintain();
  expect(data[`chat:${id}`]).toBeUndefined();
  expect(data['job:old-chat-turn']).toBeUndefined();
});

it('makes page chat the toolbar entry even on X without an active composer', async () => {
  const { rpc, toolbar, navigate, requests } = await setup();
  navigate('https://x.com/home');
  await toolbar();
  const result = await rpc({ type: 'panel:get', windowId: 42 });
  expect(result.value?.state.mode).toBe('chat');
  expect(result.value.state.pageContext.url).toBe('https://x.com/home');
  expect(requests).toHaveLength(0);
});

it('does not reattach the old page when panel polling overlaps opening an X draft', async () => {
  const { rpc, session, data, creationStarted, finishCreation } = await setup();
  await rpc({ type: 'panel:get', windowId: 42 });
  const opening = rpc({ type: 'panel:new', windowId: 42 });
  await creationStarted;
  const polling = rpc({ type: 'panel:get', windowId: 42 });
  await new Promise((resolve) => setTimeout(resolve, 5));
  finishCreation();
  expect((await opening).ok).toBe(true);
  await polling;
  expect(session['page-chat:42']).toBeUndefined();
  expect(Object.keys(data).filter((k) => k.startsWith('chat:'))).toHaveLength(1);
});
it('exposes persistent chat diagrams, validates version commands and removes drawings on conversation deletion', async () => {
  const { commitDiagram } = await import('../src/background/diagrams');
  const { rpc, data } = await setup();
  const panel = await rpc({ type: 'panel:get', windowId: 42 });
  const id = panel.value.state.composerId;
  data[`diagram:${id}`] = commitDiagram(
    undefined,
    {
      dimension: 2,
      title: 'Triangle',
      points: [
        { id: 'A', at: [0, 0] },
        { id: 'B', at: [4, 0] },
      ],
      segments: [{ a: 'A', b: 'B' }],
    },
    'one',
  );
  expect(
    (await rpc({ type: 'panel:get', windowId: 42 })).value.state.diagram.versions,
  ).toHaveLength(1);
  const send = (command: any) =>
    rpc({ type: 'panel:command', windowId: 42, composerId: id, command });
  expect((await send({ action: 'diagram', operation: 'select' })).ok).toBe(true);
  expect(data[`artifacts:${id}`].items[0].cursor).toBe(-1);
  expect((await send({ action: 'diagram', operation: 'select', versionId: 'one' })).ok).toBe(true);
  expect(
    (
      await send({
        action: 'diagram',
        operation: 'label',
        versionId: 'stale',
        point: 'A',
        offset: [22, 5],
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await send({
        action: 'diagram',
        operation: 'label',
        versionId: 'one',
        point: 'A',
        offset: [22, 5],
      })
    ).ok,
  ).toBe(true);
  expect(data[`artifacts:${id}`].items[0].versions[0].view.labels.A).toEqual([22, 5]);
  await rpc({ type: 'panel:chat', windowId: 42, action: 'delete', id });
  expect(data[`diagram:${id}`]).toBeUndefined();
});

it('allows the expanded diagram tab to resume its local conversation while rejecting other extension pages', async () => {
  const { rpc } = await setup();
  const initial = await rpc({ type: 'panel:get', windowId: 42 });
  const id = initial.value.state.composerId;
  expect(
    (await rpc({ type: 'panel:chat', windowId: 42, action: 'resume', id }, true, `#diagram=${id}`))
      .ok,
  ).toBe(true);
  expect(
    (await rpc({ type: 'panel:chat', windowId: 42, action: 'resume', id }, false, `#diagram=${id}`))
      .ok,
  ).toBe(false);
});

it('persists tool-created documents with correct job receipts and cleans all artifact kinds with the chat', async () => {
  const { rpc, data, requests } = await setup(true, true);
  const initial = await rpc({ type: 'panel:get', windowId: 42 }),
    id = initial.value.state.composerId;
  await rpc({
    type: 'panel:command',
    windowId: 42,
    composerId: id,
    command: { action: 'refine', instruction: 'Create notes' },
  });
  await vi.waitFor(() =>
    expect(Object.values(data).some((v: any) => v.mode === 'chat' && v.status === 'done')).toBe(
      true,
    ),
  );
  expect(requests[1].messages.find((m: any) => m.role === 'tool').content).toContain(
    '"saved":true',
  );
  const state = (await rpc({ type: 'panel:get', windowId: 42 })).value.state;
  expect(state.artifacts.items[0].kind).toBe('document');
  expect(state.artifacts.operations[0].jobId).toBe(state.turns[0].jobId);
  await rpc({ type: 'panel:chat', windowId: 42, action: 'delete', id });
  expect(data[`artifacts:${id}`]).toBeUndefined();
});

it('keeps a preview bound to its chat without changing the window selection', async () => {
  const { rpc } = await setup();
  const initial = await rpc({ type: 'panel:get', windowId: 42 });
  const id = initial.value.state.composerId;
  await rpc({ type: 'panel:chat', windowId: 42, action: 'new' });
  const other = (await rpc({ type: 'panel:get', windowId: 42 })).value.state.composerId;
  expect(other).not.toBe(id);
  const fragment = `#artifact=${id}&preview=tab`;
  const preview = await rpc({ type: 'panel:get', windowId: 42 }, true, fragment);
  expect(preview.value.state.composerId).toBe(id);
  const query = chrome.tabs.query;
  chrome.tabs.query = (async () => {
    throw new Error('Original browser window closed');
  }) as any;
  expect((await rpc({ type: 'panel:get', windowId: 42 }, true, fragment)).ok).toBe(true);
  chrome.tabs.query = query;
  expect((await rpc({ type: 'panel:get', windowId: 42 })).value.state.composerId).toBe(other);
  const denied = await rpc(
    {
      type: 'panel:command',
      windowId: 42,
      composerId: other,
      command: { action: 'artifact', operation: 'select', artifactId: 'missing' },
    },
    true,
    fragment,
  );
  expect(denied.ok).toBe(false);
  await rpc({ type: 'panel:chat', windowId: 42, action: 'resume', id });
  await rpc({ type: 'panel:chat', windowId: 42, action: 'delete', id });
  expect((await rpc({ type: 'panel:get', windowId: 42 }, true, fragment)).value).toBeNull();
});

it('reuses preview owner tabs across callers and replaces closed or navigated owners', async () => {
  const { rpc } = await setup();
  const id = (await rpc({ type: 'panel:get', windowId: 42 })).value.state.composerId;
  const tabs = new Map<number, any>();
  let nextId = 100;
  const create = vi.fn(async ({ url }: any) => {
    const tab = { id: nextId++, windowId: 42, url };
    tabs.set(tab.id, tab);
    return tab;
  });
  chrome.tabs.create = create as any;
  chrome.tabs.get = (async (id: number) => {
    if (!tabs.has(id)) throw new Error('Closed');
    return tabs.get(id);
  }) as any;
  chrome.tabs.update = vi.fn(async (id: number) => tabs.get(id)) as any;
  (chrome as any).windows = {
    get: async () => ({ state: 'normal' }),
    update: vi.fn(async () => ({})),
  };
  const open = () => rpc({ type: 'preview:open', chatId: id, mode: 'tab' });
  expect((await Promise.all([open(), open()])).every((r) => r.ok)).toBe(true);
  expect(create).toHaveBeenCalledTimes(1);
  expect(tabs.get(100).url).toContain('&preview=tab');
  tabs.get(100).url = 'https://example.org';
  expect((await open()).ok).toBe(true);
  expect(create).toHaveBeenCalledTimes(2);
  tabs.delete(101);
  expect((await open()).ok).toBe(true);
  expect(create).toHaveBeenCalledTimes(3);
  expect((await rpc({ type: 'preview:open', chatId: id, mode: 'tab' }, false)).ok).toBe(false);
});
