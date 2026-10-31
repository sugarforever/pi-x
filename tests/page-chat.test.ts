import { afterEach, expect, it, vi } from 'vitest';
import { PageChats, captureCurrentPage, chatPanelState } from '../src/background/page-chat';
import type { Job, PageContext } from '../src/shared/types';
const page = {
  id: 'snap-1',
  tabId: 7,
  capturedAt: 1,
  url: 'https://math.example.org/amc',
  title: 'AMC',
  text: 'Question and solution',
  truncated: false,
  limitations: [],
} as PageContext;
function setup() {
  const data: Record<string, any> = {};
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string | null) =>
          key ? { [key]: structuredClone(data[key]) } : structuredClone(data),
        set: async (values: any) => Object.assign(data, structuredClone(values)),
        remove: async (key: string) => {
          delete data[key];
        },
      },
    },
  });
  return new PageChats();
}
afterEach(() => vi.unstubAllGlobals());
it('persists standalone conversations and replaces attached context without mutating earlier snapshots', async () => {
  const chats = setup();
  const chat = await chats.create(page);
  await chats.attach(chat.id, { ...page, id: 'snap-2', text: 'Updated solution' });
  expect((await new PageChats().get(chat.id))?.context?.text).toBe('Updated solution');
  expect(chat.context?.text).toBe('Question and solution');
  await chats.attach(chat.id, undefined);
  expect((await chats.get(chat.id))?.context).toBeUndefined();
  expect(await chats.list()).toHaveLength(1);
  await chats.delete(chat.id);
  expect(await chats.get(chat.id)).toBeUndefined();
});
it('builds chat responses as messages, preserves snapshot provenance, and keeps the conversation ready after its tab closes', async () => {
  const chats = setup();
  const chat = await chats.create(page);
  const job = {
    id: 'j',
    sessionId: chat.id,
    mode: 'chat',
    tabId: 7,
    composerId: chat.id,
    prompt: { id: 'page-chat', name: 'Page chat', instructions: '', tools: [] },
    status: 'done',
    progress: '',
    createdAt: Date.now(),
    brief: 'Give me a hint',
    draft: 'Try symmetry',
    pageContext: page,
  } as Job;
  const state = chatPanelState(chat, [job], { prompts: [], defaultPromptId: '', configured: true });
  expect(state.mode).toBe('chat');
  expect(state.ready).toBe(true);
  expect(state.turns.map((t) => t.text)).toEqual(['Give me a hint', 'Try symmetry']);
  expect(state.turns[1].status).toBeUndefined();
  expect(state.turns[0].context?.id).toBe('snap-1');
  expect(state.canUndo).toBe(false);
});
it('captures the existing HTTP(S) tab without opening a research tab and reports protected-page limitations', async () => {
  setup();
  vi.stubGlobal('chrome', {
    scripting: {
      executeScript: async () => [
        { result: { ...page, id: undefined, tabId: undefined, capturedAt: undefined } },
      ],
    },
  });
  const result = await captureCurrentPage({ id: 7, url: 'https://math.example.org/amc' });
  expect(result).toMatchObject({ tabId: 7, title: 'AMC', text: 'Question and solution' });
  expect(result.id).toBeTruthy();
  const protectedPage = await captureCurrentPage({
    id: 8,
    url: 'chrome://settings',
    title: 'Settings',
  });
  expect(protectedPage.text).toBe('');
  expect(protectedPage.limitations.join(' ')).toMatch(/cannot|unsupported/i);
});
it('does not expose conversations to unrelated jobs', async () => {
  const chat = await setup().create(page);
  const state = chatPanelState(chat, [{ sessionId: 'other', brief: 'secret' } as Job], {
    prompts: [],
    defaultPromptId: '',
    configured: true,
  });
  expect(state.turns).toEqual([]);
});
