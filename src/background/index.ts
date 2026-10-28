import { chatGPTAuth } from './chatgpt-auth';
import { historySessions } from './history';
import {
  REPLY_PROMPT,
  modelBaseUrl,
  modelSettings,
  modelProfiles,
  behaviorSettings,
  quotePrompts,
} from '../shared/settings';
import { captureScreenshot } from './screenshot';
import { readBrowserPage } from './browser-page';
import { IndexedDbStorage } from '@earendil-works/pi-durable/storage/indexeddb';
import { openDraft } from '../agent/draft';
import { configuredModels } from '../agent/models';
import { loadSettings, publicSettings, validateSettings } from '../shared/settings';
import { originPattern, xPostUrl } from '../shared/urls';
import type { Job, Post, Settings } from '../shared/types';
import { JobManager, ownsJob } from './jobs';
import { readConversation, resolveSourcePost } from './context';
import { originalInput } from './original';
import { refinementJob } from './refinement';
import { sessionTools } from './research-access';
const sessionId = (job: Job) => job.sessionId || job.id;

// Content scripts never receive raw local storage access, API keys, or transcripts.
const ready = chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
const key = (id: string) => `job:${id}`;
const database = (id: string) => `pi-x-${id}`;
const store = {
  async get(id: string): Promise<Job | undefined> {
    return (await chrome.storage.local.get(key(id)))[key(id)] as Job | undefined;
  },
  async put(job: Job) {
    await chrome.storage.local.set({ [key(job.id)]: job });
  },
};
async function hasOrigin(url: string) {
  if (!(await chrome.permissions.contains({ origins: [originPattern(url)] })))
    throw new Error(
      'Site access is missing. Open Pi Quote settings and click Test connection to grant access.',
    );
}
function safeError(error: unknown, s: Settings): Error {
  let message = error instanceof Error ? error.message : 'Generation failed.';
  for (const secret of [s.apiKey]) if (secret) message = message.split(secret).join('[redacted]');
  return new Error(message.slice(0, 600));
}
const manager = new JobManager(store, async (job, signal, progress, record) => {
  const settings = modelSettings(await loadSettings(), job.modelId);
  await hasOrigin(modelBaseUrl(settings));
  const behavior = behaviorSettings(settings);
  const prompt = {
    ...job.prompt,
    tools: sessionTools(job.prompt.enabledTools, behavior.readContext),
  };
  if (prompt.tools.includes('search')) await hasOrigin('https://mcp.exa.ai');
  const combined = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.max(1, job.createdAt + 10 * 60_000 - Date.now())),
  ]);
  try {
    return await navigator.locks.request(database(sessionId(job)), async () => {
      combined.throwIfAborted();
      if (job.post?.truncated || /(?:…|\.\.\.)\s*$/.test(job.post?.text || ''))
        await progress('Reading full source post…');
      const sourcePost = await resolveSourcePost(job, combined);
      const session = await openDraft(
        await IndexedDbStorage.open(database(sessionId(job))),
        settings,
        {
          prompt,
          mode: job.mode,
          onTool: (trace) =>
            record({
              ...trace,
              arguments: settings.apiKey
                ? trace.arguments.split(settings.apiKey).join('[redacted]')
                : trace.arguments,
              output: settings.apiKey
                ? trace.output?.split(settings.apiKey).join('[redacted]')
                : trace.output,
            }),
          post: sourcePost,
          brief: job.brief,
          initialDraft: job.initialDraft,
          samples: settings.samples,
          signal: combined,
          context: (url) => readConversation(job, url, combined),
          article: (url) => readBrowserPage(url, combined),
          screenshot: async (request) =>
            navigator.locks.request('pi-x-screenshot', () =>
              captureScreenshot(request, job.tabId, combined),
            ),
          progress: (text) => {
            void progress(text).catch(() => {});
          },
        },
      );
      try {
        return await session.run(job.id, job.refinement);
      } finally {
        await session.close();
      }
    });
  } catch (error) {
    throw safeError(error, settings);
  }
});
function trustedOptions(sender: chrome.runtime.MessageSender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
}
function contentSender(sender: chrome.runtime.MessageSender) {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || !sender.url) return false;
  const url = new URL(sender.url);
  return (
    url.protocol === 'https:' &&
    ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'].includes(url.hostname) &&
    (sender.frameId === undefined || sender.frameId === 0)
  );
}
function validatePost(value: unknown): Post {
  if (!value || typeof value !== 'object') throw new Error('No source post selected.');
  const p = value as Post;
  const url = xPostUrl(p.url);
  if (
    typeof p.id !== 'string' ||
    !/^\d+$/.test(p.id) ||
    !url.endsWith(`/status/${p.id}`) ||
    typeof p.text !== 'string' ||
    !p.text.trim() ||
    p.text.length > 40000 ||
    typeof p.author !== 'string' ||
    p.author.length > 500 ||
    !Array.isArray(p.links) ||
    p.links.length > 30 ||
    p.links.some((x) => typeof x !== 'string' || x.length > 2048)
  )
    throw new Error('Cannot read this source post. Try opening its permalink first.');
  return {
    ...(p.truncated === true ? { truncated: true } : {}),
    id: p.id,
    url,
    author: p.author,
    ...(typeof p.articleTitle === 'string' && p.articleTitle.trim() && p.articleTitle.length <= 1000
      ? { articleTitle: p.articleTitle }
      : {}),
    text: p.text,
    links: p.links,
    ...(p.quoted && typeof p.quoted.text === 'string'
      ? {
          quoted: {
            text: p.quoted.text.slice(0, 20000),
            ...(p.quoted.url ? { url: xPostUrl(p.quoted.url) } : {}),
          },
        }
      : {}),
  };
}
async function allJobs(): Promise<Job[]> {
  return Object.entries(await chrome.storage.local.get(null))
    .filter(([k]) => k.startsWith('job:'))
    .map(([, v]) => v as Job);
}
let admissions = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const work = admissions.then(fn);
  admissions = work.then(
    () => {},
    () => {},
  );
  return work;
}
async function handle(message: any, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  if (!message || typeof message.type !== 'string') throw new Error('Invalid request.');
  const panel =
    sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('sidepanel.html');
  if (panel && message.type === 'panel:history') return historySessions(await allJobs());
  if (panel && message.type === 'panel:mode') {
    if (!Number.isInteger(message.windowId) || !['quote', 'reply'].includes(message.mode))
      throw new Error('Invalid writing mode.');
    const url = xPostUrl(message.url);
    const tab = await chrome.tabs.create({
      windowId: message.windowId,
      url: 'about:blank',
      active: false,
    });
    if (tab.id === undefined) throw new Error('Could not open the source post.');
    try {
      await chrome.storage.session.set({ [`compose:${tab.id}`]: { mode: message.mode, url } });
      await chrome.tabs.update(tab.id, { url, active: true });
      return { tabId: tab.id };
    } catch (e) {
      await chrome.storage.session.remove(`compose:${tab.id}`);
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw e;
    }
  }
  if (panel && message.type === 'panel:new') {
    if (!Number.isInteger(message.windowId)) throw new Error('Invalid writing window.');
    // Register intent before navigation so a fast content script cannot miss the handoff.
    const tab = await chrome.tabs.create({
      windowId: message.windowId,
      url: 'about:blank',
      active: false,
    });
    if (tab.id === undefined) throw new Error('Could not open a new X composer.');
    try {
      const restore =
        typeof message.restoreJobId === 'string'
          ? await store.get(message.restoreJobId)
          : undefined;
      if (message.restoreJobId && !restore?.draft)
        throw new Error('This historical draft is unavailable.');
      await chrome.storage.session.set({
        [`compose:${tab.id}`]: restore?.draft ? { mode: 'compose', draft: restore.draft } : true,
      });
      await chrome.tabs.update(tab.id, { url: 'https://x.com/compose/post', active: true });
      return { tabId: tab.id };
    } catch (e) {
      await chrome.storage.session.remove(`compose:${tab.id}`);
      await chrome.tabs.remove(tab.id).catch(() => {});
      throw e;
    }
  }
  if (panel && message.type === 'panel:get') {
    if (!Number.isInteger(message.windowId)) throw new Error('Invalid assistant window.');
    const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
    if (tab?.id === undefined) return null;
    try {
      const state = await chrome.tabs.sendMessage(tab.id, { type: 'panel:state' });
      if (state) {
        const ids: string[] = Array.isArray(state.jobIds)
          ? state.jobIds.filter((id: unknown): id is string => typeof id === 'string').slice(-64)
          : [];
        const stored = await chrome.storage.local.get(ids.map(key));
        const jobs = ids
          .map((id) => stored[key(id)] as Job | undefined)
          .filter(
            (job): job is Job =>
              !!job && job.tabId === tab.id && job.composerId === state.composerId,
          );
        state.toolCalls = jobs
          .sort((a, b) => a.createdAt - b.createdAt)
          .flatMap((job) =>
            (job.toolCalls || []).map((trace) => ({
              ...trace,
              id: `${job.id}:${trace.id}`,
              jobId: job.id,
            })),
          );
      }
      return state
        ? {
            tabId: tab.id,
            state,
          }
        : null;
    } catch {
      return null;
    }
  }
  if (panel && message.type === 'panel:command') {
    if (!Number.isInteger(message.tabId) || typeof message.composerId !== 'string')
      throw new Error('Invalid target draft.');
    const target = await chrome.tabs.get(message.tabId);
    if (
      !Number.isInteger(message.windowId) ||
      target.windowId !== message.windowId ||
      !target.active
    )
      throw new Error('Switch back to the target X tab before applying changes.');
    const result = await chrome.tabs.sendMessage(message.tabId, {
      type: 'panel:command',
      composerId: message.composerId,
      command: message.command,
    });
    if (!result?.ok) throw new Error(result?.error || 'The quote dialog has closed.');
    return result.value;
  }
  if (panel && message.type === 'settings:public') return publicSettings(await loadSettings());
  if (panel && message.type === 'settings:open') {
    await chrome.runtime.openOptionsPage();
    return null;
  }
  const options = trustedOptions(sender);
  const page = contentSender(sender);
  if (!options && !page) throw new Error('Untrusted extension request.');
  if (page && message.type === 'composer:activate') {
    await chrome.storage.session.set({ [`compose:${sender.tab!.id}`]: true });
    return null;
  }
  if (page && message.type === 'composer:claim') {
    const intent = (await chrome.storage.session.get(`compose:${sender.tab!.id}`))[
      `compose:${sender.tab!.id}`
    ];
    return {
      intent: intent && typeof intent === 'object' ? intent : undefined,
      compose:
        /^\/compose\/(post|tweet)\/?$/.test(new URL(sender.url!).pathname) &&
        !!(await chrome.storage.session.get(`compose:${sender.tab!.id}`))[
          `compose:${sender.tab!.id}`
        ],
    };
  }
  if (message.type === 'settings:public') return publicSettings(await loadSettings());
  if (message.type === 'settings:open') {
    await chrome.runtime.openOptionsPage();
    return null;
  }
  if (message.type === 'job:get' || message.type === 'job:cancel') {
    if (typeof message.id !== 'string') throw new Error('Invalid job ID.');
    const job = await store.get(message.id);
    if (!job || (!options && !ownsJob(job, sender)))
      throw new Error('Draft not found for this page.');
    if (message.type === 'job:cancel') {
      await manager.cancel(job.id);
      return null;
    }
    if (job.status === 'running') {
      await manager.touch(job.id);
      void manager.run(job);
    }
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      draft: job.draft,
      error: job.error,
    };
  }
  if (message.type === 'job:start' || message.type === 'job:refine')
    return serial(async () => {
      const storedSettings = await loadSettings();
      if (
        message.modelId !== undefined &&
        (typeof message.modelId !== 'string' || message.modelId.length > 100)
      )
        throw new Error('Invalid model.');
      const settings = modelSettings(storedSettings, message.modelId);
      if (!settings.model) throw new Error('Choose a model in Pi Quote settings first.');
      const refinement =
        message.type === 'job:refine'
          ? refinementJob(
              typeof message.previousJobId === 'string'
                ? await store.get(message.previousJobId)
                : undefined,
              message,
              sender,
            )
          : undefined;
      const composing = message.type === 'job:start' && message.mode === 'compose';
      if (
        composing &&
        (!page ||
          !(await chrome.storage.session.get(`compose:${sender.tab!.id}`))[
            `compose:${sender.tab!.id}`
          ])
      )
        throw new Error('Start an original tweet using New tweet in the side panel.');
      const original = composing
        ? originalInput(
            message.brief,
            message.promptId,
            settings.prompts,
            message.initialDraft ?? '',
          )
        : undefined;
      const prompt =
        refinement?.prompt ||
        original?.prompt ||
        (message.mode === 'reply' && message.promptId === REPLY_PROMPT.id
          ? REPLY_PROMPT
          : undefined) ||
        quotePrompts(settings).find((p) => p.id === (message.promptId || settings.defaultPromptId));
      if (!prompt)
        throw new Error('Prompt was removed. Refresh the page or choose another prompt.');
      if (typeof message.composerId !== 'string' || message.composerId.length > 100)
        throw new Error('Invalid composer.');
      const post = refinement
        ? refinement.post
        : composing
          ? undefined
          : validatePost(message.post);
      const jobs = await allJobs();
      const tabId = page ? sender.tab!.id! : -1;
      for (const j of jobs)
        if (j.tabId === tabId && j.composerId === message.composerId && j.status === 'running')
          await manager.cancel(j.id);
      if ((await allJobs()).filter((j) => j.status === 'running').length >= 3)
        throw new Error('Three drafts are already running. Cancel one before starting another.');
      const job: Job = {
        id: crypto.randomUUID(),
        tabId,
        documentId: sender.documentId,
        composerId: message.composerId,
        mode:
          refinement?.mode ||
          (composing ? 'compose' : message.mode === 'reply' ? 'reply' : 'quote'),
        modelId: message.modelId || storedSettings.defaultModelId || 'default',
        brief:
          refinement?.brief ||
          original?.brief ||
          (typeof message.brief === 'string' ? message.brief.slice(0, 4000) : undefined),
        initialDraft: original?.initialDraft,
        post,
        ...(refinement
          ? { sessionId: refinement.sessionId, refinement: refinement.refinement }
          : {}),
        prompt: structuredClone(prompt),
        status: 'running',
        progress: 'Starting…',
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      };
      await manager.save(job);
      void manager.run(job);
      return { id: job.id };
    });
  if (!options) throw new Error('This action is only available in extension settings.');
  if (message.type === 'chatgpt:status') return chatGPTAuth.status();
  if (message.type === 'chatgpt:start') return chatGPTAuth.start();
  if (message.type === 'chatgpt:poll') return chatGPTAuth.poll();
  if (message.type === 'chatgpt:cancel') return chatGPTAuth.cancel();
  if (message.type === 'chatgpt:signout') return chatGPTAuth.signOut();
  if (message.type === 'settings:get') return loadSettings();
  if (message.type === 'settings:save') {
    const settings = validateSettings(message.settings);
    await chrome.storage.local.set({ settings });
    return publicSettings(settings);
  }
  if (message.type === 'connection:test') {
    const s = validateSettings(message.settings);
    if (!s.model) throw new Error('Enter a model ID first.');
    await hasOrigin(modelBaseUrl(s));
    try {
      const models = configuredModels(s);
      const result = await models.completeSimple(
        models.getModel('configured', s.model)!,
        { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: Date.now() }] },
        { timeoutMs: 25000, maxRetries: 0 },
      );
      if (result.stopReason === 'error' || result.stopReason === 'aborted')
        throw new Error(result.errorMessage || 'Connection failed.');
      return 'Connection successful.';
    } catch (e) {
      throw safeError(e, s);
    }
  }
  if (message.type === 'data:clear') {
    await serial(async () => {
      for (const j of await allJobs()) {
        await manager.cancel(j.id);
        await navigator.locks.request(database(sessionId(j)), () =>
          IndexedDbStorage.delete(database(sessionId(j))),
        );
      }
      await navigator.locks.request('pi-x-chatgpt-auth', () => chrome.storage.local.clear());
      await chrome.storage.session.clear();
    });
    return null;
  }
  throw new Error('Unknown extension request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type === 'panel:open') {
    if (!contentSender(sender)) {
      respond({ ok: false, error: 'Untrusted assistant request.' });
      return;
    }
    // Call open synchronously in the message's user gesture; do not await storage or setOptions.
    void chrome.sidePanel.open({ windowId: sender.tab!.windowId }).then(
      () => respond({ ok: true, value: null }),
      (e) => respond({ ok: false, error: String(e) }),
    );
    return true;
  }
  void handle(message, sender).then(
    (value) => respond({ ok: true, value }),
    (error) =>
      respond({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }),
  );
  return true;
});
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) void chrome.sidePanel.open({ windowId: tab.windowId });
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`compose:${tabId}`);
});
async function maintenance() {
  await ready;
  const jobs = await allJobs();
  for (const job of jobs) {
    if (job.status === 'running') {
      if (Date.now() - job.createdAt > 10 * 60_000) {
        await manager.cancel(job.id);
        continue;
      }
      if (job.tabId === -1) {
        if (Date.now() - (job.lastSeenAt || job.createdAt) < 15000) void manager.run(job);
        else await manager.cancel(job.id);
        continue;
      }
      // A live composer is the authority to resume; a browser restart must not recreate a closed draft.
      try {
        const response = await chrome.tabs.sendMessage(
          job.tabId,
          { type: 'composer:alive', composerId: job.composerId },
          job.documentId ? { documentId: job.documentId } : {},
        );
        if (response?.alive) void manager.run(job);
        else await manager.cancel(job.id);
      } catch {
        await manager.cancel(job.id);
      }
    } else if (Date.now() - job.createdAt > 24 * 60 * 60_000) {
      // A newer refinement may still depend on the shared conversation database.
      if (
        !jobs.some(
          (j) =>
            sessionId(j) === sessionId(job) &&
            (j.status === 'running' || Date.now() - j.createdAt <= 24 * 60 * 60_000),
        )
      )
        await navigator.locks.request(database(sessionId(job)), () =>
          IndexedDbStorage.delete(database(sessionId(job))),
        );
      await chrome.storage.local.remove(key(job.id));
    }
  }
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pi-x-maintenance') void maintenance();
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('pi-x-maintenance', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create('pi-x-maintenance', { periodInMinutes: 0.5 });
  void maintenance();
});
