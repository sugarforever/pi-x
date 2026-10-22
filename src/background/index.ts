import { IndexedDbStorage } from '@earendil-works/pi-durable/storage/indexeddb';
import { openDraft } from '../agent/draft';
import { configuredModels } from '../agent/models';
import { loadSettings, publicSettings, validateSettings } from '../shared/settings';
import { originPattern, xPostUrl } from '../shared/urls';
import type { Job, Post, Settings } from '../shared/types';
import { JobManager, ownsJob } from './jobs';
import { readConversation } from './context';

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
    throw new Error('Site access is missing. Open AI Quote settings and save to grant access.');
}
function safeError(error: unknown, s: Settings): Error {
  let message = error instanceof Error ? error.message : 'Generation failed.';
  for (const secret of [s.apiKey, s.searchKey])
    if (secret) message = message.split(secret).join('[redacted]');
  return new Error(message.slice(0, 600));
}
const manager = new JobManager(store, async (job, signal, progress) => {
  const settings = await loadSettings();
  await hasOrigin(settings.baseUrl);
  if (job.prompt.tools.includes('search')) {
    if (!settings.searchKey)
      throw new Error('Add a Brave Search API key in settings for this prompt.');
    await hasOrigin('https://api.search.brave.com');
  }
  if (
    job.prompt.tools.includes('articles') &&
    (!settings.articleAccess || !(await chrome.permissions.contains({ origins: ['https://*/*'] })))
  )
    throw new Error('Enable article access in settings for this prompt.');
  const combined = AbortSignal.any([
    signal,
    AbortSignal.timeout(Math.max(1, job.createdAt + 10 * 60_000 - Date.now())),
  ]);
  try {
    return await navigator.locks.request(database(job.id), async () => {
      combined.throwIfAborted();
      const session = await openDraft(await IndexedDbStorage.open(database(job.id)), settings, {
        prompt: job.prompt,
        post: job.post,
        samples: settings.samples,
        signal: combined,
        context: (url) => readConversation(job, url, combined),
        progress: (text) => {
          void progress(text).catch(() => {});
        },
      });
      try {
        return await session.run(job.id);
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
    id: p.id,
    url,
    author: p.author,
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
  const options = trustedOptions(sender);
  const page = contentSender(sender);
  if (!options && !page) throw new Error('Untrusted extension request.');
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
  if (message.type === 'job:start')
    return serial(async () => {
      const settings = await loadSettings();
      if (!settings.model) throw new Error('Choose a model in AI Quote settings first.');
      const prompt = settings.prompts.find(
        (p) => p.id === (message.promptId || settings.defaultPromptId),
      );
      if (!prompt)
        throw new Error('Prompt was removed. Refresh the page or choose another prompt.');
      if (typeof message.composerId !== 'string' || message.composerId.length > 100)
        throw new Error('Invalid composer.');
      const post = validatePost(message.post);
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
        post,
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
  if (message.type === 'settings:get') return loadSettings();
  if (message.type === 'settings:save') {
    const settings = validateSettings(message.settings);
    await hasOrigin(settings.baseUrl);
    await chrome.storage.local.set({ settings });
    return publicSettings(settings);
  }
  if (message.type === 'connection:test') {
    const s = validateSettings(message.settings);
    if (!s.model) throw new Error('Enter a model ID first.');
    await hasOrigin(s.baseUrl);
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
        await navigator.locks.request(database(j.id), () =>
          IndexedDbStorage.delete(database(j.id)),
        );
      }
      await chrome.storage.local.clear();
    });
    return null;
  }
  throw new Error('Unknown extension request.');
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  void handle(message, sender).then(
    (value) => respond({ ok: true, value }),
    (error) =>
      respond({ ok: false, error: error instanceof Error ? error.message : 'Request failed.' }),
  );
  return true;
});
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
async function maintenance() {
  await ready;
  for (const job of await allJobs()) {
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
      await navigator.locks.request(database(job.id), () =>
        IndexedDbStorage.delete(database(job.id)),
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
