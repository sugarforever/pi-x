import { ArtifactStore } from './artifacts';
import { diagramArtifact, toDiagram } from '../artifacts/diagram-adapter';
import { DiagramStore } from './diagrams';
import { currentDiagram } from '../geometry/document';
import { CHAT_PROMPT, PageChats, captureCurrentPage, chatPanelState } from './page-chat';
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
const pageChats = new PageChats();
const artifacts = new ArtifactStore();
const diagrams = new DiagramStore(artifacts);
const selectedChatKey = (windowId: number) => `page-chat:${windowId}`;
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
    tools:
      job.mode === 'chat'
        ? job.prompt.tools
        : sessionTools(job.prompt.enabledTools, behavior.readContext),
  };
  if (
    job.mode === 'chat' &&
    !(await chrome.permissions.contains({ origins: ['https://mcp.exa.ai/*'] }))
  )
    prompt.tools = prompt.tools.filter((tool) => tool !== 'search');
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
      const sourcePost = job.mode === 'chat' ? undefined : await resolveSourcePost(job, combined);
      let observedDiagram: { id?: string; base: string | null } = { base: null };
      const readDiagram = async () => {
        const collection = await artifacts.get(sessionId(job));
        const artifact = diagramArtifact(collection);
        const doc = toDiagram(collection);
        observedDiagram = { id: artifact?.id, base: currentDiagram(doc)?.id ?? null };
        return doc;
      };
      const session = await openDraft(
        await IndexedDbStorage.open(database(sessionId(job))),
        settings,
        {
          prompt,
          mode: job.mode,
          diagram:
            job.mode === 'chat'
              ? {
                  get: readDiagram,
                  draw: async (spec, operationId) => {
                    const observed = observedDiagram;
                    combined.throwIfAborted();
                    if (!(await pageChats.get(sessionId(job))))
                      throw new Error('Conversation was deleted.');
                    combined.throwIfAborted();
                    const result = await diagrams.draw(
                      sessionId(job),
                      spec,
                      `${job.id}:${operationId}`,
                      observed.id,
                      observed.base,
                      job.id,
                    );
                    observedDiagram = {
                      id: observed.id || 'diagram',
                      base: currentDiagram(result)?.id ?? null,
                    };
                    return result;
                  },
                }
              : undefined,
          artifacts:
            job.mode === 'chat'
              ? {
                  operationId: (taskId) => `${job.id}:${taskId}`,
                  list: () => artifacts.get(sessionId(job)),
                  create: async (input, operation) => {
                    combined.throwIfAborted();
                    if (!(await pageChats.get(sessionId(job))))
                      throw new Error('Conversation was deleted.');
                    combined.throwIfAborted();
                    return artifacts.create(sessionId(job), input, operation, undefined, job.id);
                  },
                  update: async (id, base, data, operation, title) => {
                    combined.throwIfAborted();
                    if (!(await pageChats.get(sessionId(job))))
                      throw new Error('Conversation was deleted.');
                    combined.throwIfAborted();
                    return artifacts.revise(
                      sessionId(job),
                      id,
                      base,
                      data,
                      operation,
                      title,
                      job.id,
                    );
                  },
                }
              : undefined,
          pageContext: job.pageContext,
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
          screenshot:
            job.mode === 'chat' && !job.allowScreenshot
              ? undefined
              : async (request) => {
                  if (job.mode === 'chat') {
                    if (
                      !job.pageContext ||
                      request.url ||
                      (request.tabId !== undefined && request.tabId !== job.tabId)
                    )
                      throw new Error('Screenshot access is limited to the attached page.');
                    const current = await chrome.tabs.get(job.tabId);
                    if (current.url !== job.pageContext.url)
                      throw new Error(
                        'The attached page has changed. Refresh its context before capturing a screenshot.',
                      );
                  }
                  return navigator.locks.request('pi-x-screenshot', () =>
                    captureScreenshot(request, job.tabId, combined),
                  );
                },
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
    sender.id === chrome.runtime.id &&
    sender.url?.split('#')[0] === chrome.runtime.getURL('sidepanel.html');
  // Fragment identity belongs to this extension document, not the active chat
  // selection for its browser window. A preview must never resume another chat.
  const fragment = panel ? new URLSearchParams(new URL(sender.url!).hash.slice(1)) : undefined;
  const preview = ['tab', 'window'].includes(fragment?.get('preview') || '');
  const previewChatId = preview ? fragment?.get('artifact') : undefined;
  if (preview && (!previewChatId || previewChatId.length > 100))
    throw new Error('Invalid preview conversation.');
  if (panel && message.type === 'preview:open')
    return serial(async () => {
      if (typeof message.chatId !== 'string' || !(await pageChats.get(message.chatId)))
        throw new Error('Conversation is unavailable.');
      if (message.mode !== 'tab' && message.mode !== 'window')
        throw new Error('Invalid preview mode.');
      const url =
        chrome.runtime.getURL('sidepanel.html') +
        '#artifact=' +
        encodeURIComponent(message.chatId) +
        '&preview=' +
        message.mode;
      const key = `preview:${message.mode}:${message.chatId}`;
      const existing = (await chrome.storage.session.get(key))[key];
      if (typeof existing === 'number' && Number.isInteger(existing)) {
        try {
          const tab = await chrome.tabs.get(existing);
          if (tab.url === url) {
            const host = await chrome.windows.get(tab.windowId);
            await chrome.tabs.update(existing, { active: true });
            await chrome.windows.update(tab.windowId, {
              ...(host.state === 'minimized' ? { state: 'normal' as const } : {}),
              focused: true,
            });
            return;
          }
        } catch {
          /* Closed or navigated hosts are replaced below. */
        }
      }
      let tabId: number | undefined;
      if (message.mode === 'tab') {
        tabId = (await chrome.tabs.create({ url, active: true })).id;
      } else {
        const host = await chrome.windows.create({
          type: 'popup',
          url,
          width: 900,
          height: 720,
          focused: true,
        });
        tabId = host?.tabs?.[0]?.id;
      }
      if (tabId !== undefined) await chrome.storage.session.set({ [key]: tabId });
    });
  if (panel && message.type === 'panel:history')
    return historySessions(await allJobs(), Date.now(), await pageChats.list());
  if (panel && message.type === 'panel:chat')
    return serial(async () => {
      if (!Number.isInteger(message.windowId)) throw new Error('Invalid assistant window.');
      const selectionKey = selectedChatKey(message.windowId);
      if (message.action === 'new') {
        const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
        if (!tab) throw new Error('No active page.');
        const chat = await pageChats.create(await captureCurrentPage(tab));
        await chrome.storage.session.set({ [selectionKey]: chat.id });
        return null;
      }
      if (typeof message.id !== 'string') throw new Error('Invalid conversation.');
      const chat = await pageChats.get(message.id);
      if (!chat) throw new Error('Conversation is unavailable.');
      if (message.action === 'resume') {
        await chrome.storage.session.set({ [selectionKey]: chat.id });
        return null;
      }
      const selected = (await chrome.storage.session.get(selectionKey))[selectionKey];
      if (selected !== chat.id) throw new Error('Select this conversation first.');
      if (message.action === 'refresh') {
        const [tab] = await chrome.tabs.query({ active: true, windowId: message.windowId });
        if (!tab) throw new Error('No active page.');
        await pageChats.attach(chat.id, await captureCurrentPage(tab));
      } else if (message.action === 'remove') await pageChats.attach(chat.id, undefined);
      else if (message.action === 'delete') {
        const jobs = (await allJobs()).filter((j) => j.mode === 'chat' && j.sessionId === chat.id);
        for (const job of jobs) await manager.cancel(job.id);
        await navigator.locks.request(database(chat.id), () =>
          IndexedDbStorage.delete(database(chat.id)),
        );
        for (const job of jobs) await chrome.storage.local.remove(key(job.id));
        await pageChats.delete(chat.id);
        await diagrams.delete(chat.id);
        await chrome.storage.session.remove(selectionKey);
      } else throw new Error('Unknown conversation action.');
      return null;
    });
  if (panel && message.type === 'panel:mode')
    return serial(async () => {
      if (!Number.isInteger(message.windowId) || !['quote', 'reply'].includes(message.mode))
        throw new Error('Invalid writing mode.');
      const url = xPostUrl(message.url);
      await chrome.storage.session.remove(selectedChatKey(message.windowId));
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
    });
  if (panel && message.type === 'panel:new')
    return serial(async () => {
      if (!Number.isInteger(message.windowId)) throw new Error('Invalid writing window.');
      await chrome.storage.session.remove(selectedChatKey(message.windowId));
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
    });
  if (panel && message.type === 'panel:get') {
    if (!Number.isInteger(message.windowId)) throw new Error('Invalid assistant window.');
    const [tab] = preview
      ? []
      : await chrome.tabs.query({ active: true, windowId: message.windowId });
    const selectedId =
      previewChatId ??
      (await chrome.storage.session.get(selectedChatKey(message.windowId)))[
        selectedChatKey(message.windowId)
      ];
    const chat = typeof selectedId === 'string' ? await pageChats.get(selectedId) : undefined;
    if (chat) {
      const state = chatPanelState(chat, await allJobs(), publicSettings(await loadSettings()));
      state.artifacts = await artifacts.get(chat.id);
      state.diagram = toDiagram(state.artifacts);
      state.pageChanged =
        !!chat.context && (tab?.id !== chat.context.tabId || tab?.url !== chat.context.url);
      state.activePageTitle = tab?.title;
      return { tabId: chat.context?.tabId ?? -1, state };
    }
    if (preview) return null;
    if (tab?.id === undefined) return null;
    const createPageChat = () =>
      serial(async () => {
        const [active] = await chrome.tabs.query({ active: true, windowId: message.windowId });
        if (active?.id !== tab.id || active?.url !== tab.url) return null;
        // Recheck selection after queued admissions to avoid duplicate captures from polling panels.
        const currentId = (await chrome.storage.session.get(selectedChatKey(message.windowId)))[
          selectedChatKey(message.windowId)
        ];
        const current = typeof currentId === 'string' ? await pageChats.get(currentId) : undefined;
        const created = current || (await pageChats.create(await captureCurrentPage(tab)));
        await chrome.storage.session.set({ [selectedChatKey(message.windowId)]: created.id });
        return {
          tabId: created.context?.tabId ?? -1,
          state: chatPanelState(created, await allJobs(), publicSettings(await loadSettings())),
        };
      });
    const autoChat =
      /^https?:\/\//i.test(tab.url || '') &&
      !/^https:\/\/(?:www\.)?(?:x|twitter)\.com(?:\/|$)/i.test(tab.url || '');
    if (autoChat) return createPageChat();
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
    if (preview && (message.composerId !== previewChatId || message.command?.action !== 'artifact'))
      throw new Error('Invalid preview command.');
    const selectedId =
      previewChatId ??
      (Number.isInteger(message.windowId)
        ? (await chrome.storage.session.get(selectedChatKey(message.windowId)))[
            selectedChatKey(message.windowId)
          ]
        : undefined);
    if (typeof selectedId === 'string' && selectedId === message.composerId)
      return serial(async () => {
        const chat = await pageChats.get(selectedId);
        if (!chat) throw new Error('Conversation is unavailable.');
        const command = message.command;
        if (!command || typeof command.action !== 'string')
          throw new Error('Invalid chat command.');
        const jobs = (await allJobs()).filter((j) => j.mode === 'chat' && j.sessionId === chat.id);
        if (command.action === 'cancel') {
          for (const job of jobs) if (job.status === 'running') await manager.cancel(job.id);
          return {};
        }
        if (jobs.some((j) => j.status === 'running'))
          throw new Error('Wait for the current answer or stop it first.');
        if (command.action === 'artifact') {
          if (typeof command.artifactId !== 'string') throw new Error('Invalid artifact ID.');
          if (command.operation === 'select') await artifacts.select(chat.id, command.artifactId);
          else if (command.operation === 'version')
            await artifacts.select(chat.id, command.artifactId, command.versionId ?? null);
          else if (command.operation === 'remove')
            await artifacts.remove(chat.id, command.artifactId);
          else if (command.operation === 'label')
            await artifacts.label(
              chat.id,
              command.artifactId,
              command.versionId,
              command.point,
              command.offset,
            );
          else throw new Error('Invalid artifact command.');
          await pageChats.save({ ...chat, updatedAt: Date.now() });
          return {};
        }
        if (command.action === 'diagram') {
          const doc = await diagrams.get(chat.id);
          if (!doc) throw new Error('No diagram is available. Ask the assistant to draw one.');
          if (command.operation === 'select') {
            const cursor =
              command.versionId === undefined || command.versionId === ''
                ? -1
                : doc.versions.findIndex((v) => v.id === command.versionId);
            if (command.versionId && cursor < 0) throw new Error('Diagram version is unavailable.');
            await diagrams.select(chat.id, cursor);
          } else if (command.operation === 'label') {
            if (currentDiagram(doc)?.id !== command.versionId)
              throw new Error('The diagram changed. Try moving the label again.');
            await diagrams.label(chat.id, command.point, command.offset);
          } else throw new Error('Invalid diagram command.');
          await pageChats.save({ ...chat, updatedAt: Date.now() });
          return {};
        }
        const settings = await loadSettings();
        if (command.action === 'model') {
          if (typeof command.modelId !== 'string') throw new Error('Invalid model.');
          modelSettings(settings, command.modelId);
          await pageChats.save({ ...chat, modelId: command.modelId });
          return {};
        }
        if (
          command.action !== 'refine' ||
          typeof command.instruction !== 'string' ||
          !command.instruction.trim() ||
          command.instruction.length > 4000
        )
          throw new Error('Enter a message of up to 4,000 characters.');
        if (!modelSettings(settings, chat.modelId).model)
          throw new Error('Choose a model in Settings first.');
        if ((await allJobs()).filter((j) => j.status === 'running').length >= 3)
          throw new Error('Three requests are already running. Stop one first.');
        const job: Job = {
          id: crypto.randomUUID(),
          sessionId: chat.id,
          composerId: chat.id,
          mode: 'chat',
          tabId: chat.context?.tabId ?? -1,
          pageContext: chat.context,
          modelId: chat.modelId || settings.defaultModelId || 'default',
          brief: command.instruction.trim(),
          allowScreenshot: command.allowScreenshot === true,
          prompt: structuredClone(CHAT_PROMPT),
          status: 'running',
          progress: 'Starting…',
          createdAt: Date.now(),
        };
        await manager.save(job);
        await pageChats.save({ ...chat, updatedAt: job.createdAt });
        void manager.run(job);
        return {};
      });
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
  if (message.type === 'chatgpt:browser') return chatGPTAuth.startBrowser();
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
    void serial(() => chrome.storage.session.remove(selectedChatKey(sender.tab!.windowId)));
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
  if (tab.windowId === undefined) return;
  const windowId = tab.windowId;
  // Keep Chrome's open call in the toolbar's user gesture.
  void chrome.sidePanel.open({ windowId });
  return serial(async () => {
    await ready;
    const selectionKey = selectedChatKey(windowId);
    const selected = (await chrome.storage.session.get(selectionKey))[selectionKey];
    if (typeof selected === 'string' && (await pageChats.get(selected))) return;
    const chat = await pageChats.create(await captureCurrentPage(tab));
    await chrome.storage.session.set({ [selectionKey]: chat.id });
  });
});
// Capture the registered loopback redirect in the tab we opened. No local
// listener is required: the URL update arrives even if localhost is unreachable.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url?.startsWith('http://localhost:1455/auth/callback')) return;
  void ready
    .then(() => chatGPTAuth.completeBrowser(tabId, change.url!))
    .then(async (handled) => {
      if (handled) await chrome.tabs.update(tabId, { url: chrome.runtime.getURL('options.html') });
    })
    .catch(() => {});
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void ready.then(() => chatGPTAuth.closeBrowser(tabId)).catch(() => {});
  void chrome.storage.session.remove(`compose:${tabId}`);
});
async function maintenance() {
  return serial(async () => {
    await ready;
    const jobs = await allJobs();
    for (const chat of await pageChats.list()) {
      if (
        Date.now() - chat.updatedAt > 24 * 60 * 60_000 &&
        !jobs.some((j) => j.sessionId === chat.id && j.status === 'running')
      ) {
        await pageChats.delete(chat.id);
        await diagrams.delete(chat.id);
      }
    }
    for (const job of jobs) {
      if (job.status === 'running') {
        if (Date.now() - job.createdAt > 10 * 60_000) {
          await manager.cancel(job.id);
          continue;
        }
        if (job.mode === 'chat') {
          if (await pageChats.get(sessionId(job))) void manager.run(job);
          else await manager.cancel(job.id);
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
        if (job.mode === 'chat') {
          const chat = await pageChats.get(sessionId(job));
          if (chat && Date.now() - chat.updatedAt <= 24 * 60 * 60_000) continue;
        }
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
  });
}
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pi-x-maintenance') return maintenance();
});
chrome.runtime.onInstalled.addListener(() => {
  void chrome.alarms.create('pi-x-maintenance', { periodInMinutes: 0.5 });
});
chrome.runtime.onStartup.addListener(() => {
  void chrome.alarms.create('pi-x-maintenance', { periodInMinutes: 0.5 });
  void maintenance();
});
