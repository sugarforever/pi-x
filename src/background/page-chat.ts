import type { Job, PageChat, PageContext, PublicSettings } from '../shared/types';
import type { PanelState, PanelTurn } from '../shared/panel';
import { extractPage } from './browser-page';

export const CHAT_PROMPT = {
  id: 'page-chat',
  name: 'Page chat',
  instructions:
    'Discuss the attached page and answer the user’s questions. Follow their requested level of detail and language. For learning problems, honor hint-only requests and distinguish the published solution from your own reasoning.',
  tools: ['articles', 'search'] as ('articles' | 'search')[],
};
const key = (id: string) => `chat:${id}`;
export class PageChats {
  async get(id: string): Promise<PageChat | undefined> {
    return (await chrome.storage.local.get(key(id)))[key(id)] as PageChat | undefined;
  }
  async save(chat: PageChat) {
    await chrome.storage.local.set({ [key(chat.id)]: chat });
    return chat;
  }
  async create(context: PageContext) {
    const now = Date.now();
    return this.save({
      id: crypto.randomUUID(),
      context,
      title: context.title || 'Page chat',
      createdAt: now,
      updatedAt: now,
    });
  }
  async attach(id: string, context: PageContext | undefined) {
    const chat = await this.get(id);
    if (!chat) throw new Error('This conversation is unavailable. Start a new chat.');
    return this.save({ ...chat, context, updatedAt: Date.now() });
  }
  async list(): Promise<PageChat[]> {
    return Object.entries(await chrome.storage.local.get(null))
      .filter(([k]) => k.startsWith('chat:'))
      .map(([, value]) => value as PageChat);
  }
  async delete(id: string) {
    await chrome.storage.local.remove(key(id));
  }
}

export async function captureCurrentPage(tab: {
  id?: number;
  url?: string;
  title?: string;
}): Promise<PageContext> {
  const base: PageContext = {
    id: crypto.randomUUID(),
    tabId: tab.id ?? -1,
    capturedAt: Date.now(),
    url: tab.url || '',
    title: tab.title || 'Page',
    text: '',
    truncated: false,
    limitations: [],
  };
  if (tab.id === undefined || !/^https?:\/\//i.test(tab.url || ''))
    return {
      ...base,
      limitations: [
        'Chrome cannot read this page. Open a normal HTTP(S) web page, then refresh context. Browser pages and the built-in PDF viewer are unsupported.',
      ],
    };
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPage,
    });
    const page = results[0]?.result;
    if (!page) throw new Error('No page content returned.');
    return { ...base, ...page, id: base.id, tabId: tab.id, capturedAt: base.capturedAt };
  } catch {
    return {
      ...base,
      limitations: [
        'Chrome could not capture readable content. Check site access; protected pages and the built-in PDF viewer may be unavailable.',
      ],
    };
  }
}

export function chatPanelState(
  chat: PageChat,
  allJobs: Job[],
  settings: PublicSettings,
): PanelState {
  const jobs = allJobs
    .filter((j) => j.mode === 'chat' && j.sessionId === chat.id)
    .sort((a, b) => a.createdAt - b.createdAt);
  const turns: PanelTurn[] = [];
  for (const job of jobs) {
    turns.push({
      id: `${job.id}:user`,
      jobId: job.id,
      role: 'user',
      text: job.brief || '',
      context: job.pageContext,
    });
    if (job.draft || job.error || job.status === 'cancelled')
      turns.push({
        id: job.id,
        jobId: job.id,
        role: 'agent',
        text: job.draft || job.error || 'Request stopped.',
        status: job.error || job.status === 'cancelled' ? 'error' : undefined,
        context: job.pageContext,
      });
  }
  const running = jobs.findLast((j) => j.status === 'running');
  return {
    composerId: chat.id,
    mode: 'chat',
    modelId: chat.modelId,
    pageContext: chat.context,
    currentDraft: '',
    prompts: [],
    promptId: CHAT_PROMPT.id,
    busy: !!running,
    ready: settings.configured,
    status: running?.progress || 'Ready',
    turns,
    canUndo: false,
    jobIds: jobs.map((j) => j.id),
    toolCalls: jobs.flatMap((j) =>
      (j.toolCalls || []).map((t) => ({ ...t, id: `${j.id}:${t.id}`, jobId: j.id })),
    ),
  };
}
