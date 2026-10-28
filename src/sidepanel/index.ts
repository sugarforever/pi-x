import type { historySessions } from '../background/history';
import type { PublicSettings } from '../shared/types';
import { conversationItems } from './conversation-items';
import { renderToolHistory } from './tool-history';
import type { PanelCommand, PanelResult, PanelState, PanelTurn } from '../shared/panel';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const request = el<HTMLTextAreaElement>('request'),
  send = el<HTMLButtonElement>('send'),
  prompt = el<HTMLSelectElement>('prompt');
let target: { tabId: number; state: PanelState } | null = null;
let signature = '';
const expandedTools = new Set<string>();
let polling = false;
let acting = false;
let identity = '';
let panelWindowId: number;
let selectedPrompt = '';
let historyOpen = false;
let historyData: ReturnType<typeof historySessions> = [];
let requestedMode: 'quote' | 'reply' = 'quote';
let publicConfig: PublicSettings | undefined;
const promptChoices = new Map<string, string>();
const unsent = new Map<string, string>();
let confirmation:
  { tabId: number; composerId: string; command: PanelCommand; expectedCurrent: string } | undefined;
async function rpc<T>(message: unknown): Promise<T> {
  const r = await chrome.runtime.sendMessage(message);
  if (!r?.ok) throw new Error(r?.error || 'The assistant is unavailable.');
  return r.value;
}
function error(text: string) {
  el('error').textContent = text;
  el('error').hidden = !text;
}
function updateSend() {
  request.style.height = 'auto';
  request.style.height = `${Math.min(140, Math.max(34, request.scrollHeight))}px`;
  prompt.disabled = !target || acting || !!target.state.busy;
  send.disabled = acting || !target?.state.ready || target.state.busy || !request.value.trim();
  el<HTMLButtonElement>('regenerate').disabled = acting || !target || target.state.busy;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.revision-regenerate'))
    button.disabled = acting || !target || target.state.busy;
}
async function command(command: PanelCommand, expectedTarget = target) {
  if (
    !expectedTarget ||
    expectedTarget.state.composerId !== target?.state.composerId ||
    expectedTarget.tabId !== target.tabId
  )
    return;
  acting = true;
  updateSend();
  error('');
  try {
    const r = await rpc<PanelResult>({
      type: 'panel:command',
      windowId: panelWindowId,
      tabId: expectedTarget.tabId,
      composerId: expectedTarget.state.composerId,
      command,
    });
    if (r.conflict) {
      confirmation = {
        tabId: expectedTarget.tabId,
        composerId: expectedTarget.state.composerId,
        command,
        expectedCurrent: r.currentDraft!,
      };
      el('conflict').hidden = false;
    } else {
      confirmation = undefined;
      el('conflict').hidden = true;
    }
    return true;
  } catch (e) {
    error(e instanceof Error ? e.message : 'Could not update the draft.');
    return false;
  } finally {
    acting = false;
    await refresh();
    updateSend();
  }
}
function renderTurn(turn: PanelTurn, state: PanelState, historical = false) {
  const article = document.createElement('article');
  if (turn.jobId) article.dataset.jobId = turn.jobId;
  article.className = 'turn ' + turn.role + (turn.status === 'error' ? ' error' : '');
  if (turn.role === 'agent' && turn.status !== 'error') article.classList.add('revision');
  article.setAttribute('aria-label', turn.role === 'user' ? 'You' : 'Assistant');
  const text = document.createElement('div');
  text.className = 'turn-text';
  text.textContent = turn.text;
  article.append(text);
  if (turn.role === 'agent' && turn.status !== 'error') {
    // Keep source links inline instead of duplicating them in a separate list.
    let offset = 0;
    text.replaceChildren();
    for (const match of turn.text.matchAll(/https:\/\/[^\s<>"）)]+/g)) {
      text.append(turn.text.slice(offset, match.index));
      const link = document.createElement('a');
      link.href = match[0];
      link.textContent = match[0];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      text.append(link);
      offset = match.index! + match[0].length;
    }
    text.append(turn.text.slice(offset));
    const actions = document.createElement('div');
    actions.className = 'revision-actions';
    const copy = document.createElement('button');
    copy.className = 'icon-button';
    copy.setAttribute('aria-label', 'Copy');
    copy.title = 'Copy';
    copy.innerHTML =
      '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg>';
    copy.onclick = () =>
      void navigator.clipboard.writeText(turn.text).then(
        () => {
          copy.title = 'Copied';
          copy.setAttribute('aria-label', 'Copied');
        },
        () => error('Copy is unavailable. Select the revision text to copy it.'),
      );
    const meta = document.createElement('span');
    meta.className = 'revision-meta';
    const version =
      state.turns
        .filter((t) => t.role === 'agent' && t.status !== 'error')
        .findIndex((t) => t.id === turn.id) + 1;
    meta.textContent = `v${version} · ${Array.from(turn.text).length} chars`;
    actions.append(meta, copy);
    if (
      !historical &&
      state.turns.filter((t) => t.role === 'agent' && t.status !== 'error').at(-1)?.id === turn.id
    ) {
      const regenerate = document.createElement('button');
      regenerate.className = 'icon-button revision-regenerate';
      regenerate.setAttribute('aria-label', 'Regenerate');
      regenerate.title = 'Regenerate';
      regenerate.innerHTML =
        '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>';
      regenerate.disabled = state.busy || acting;
      regenerate.onclick = () => void command({ action: 'regenerate', promptId: prompt.value });
      actions.append(regenerate);
    }

    if (turn.status === 'proposal' || turn.status === 'applied' || turn.status === 'reverted') {
      const dismiss = document.createElement('button');
      dismiss.className = 'icon-button';
      dismiss.setAttribute('aria-label', 'Dismiss');
      dismiss.title = 'Dismiss';
      dismiss.innerHTML = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M7 17 17 7"/></svg>';
      dismiss.disabled = state.busy;
      const apply = document.createElement('button');
      apply.className = turn.status === 'applied' ? 'primary applied' : 'primary';
      apply.textContent = historical
        ? 'Use draft'
        : turn.status === 'applied'
          ? '✓ Inserted'
          : 'Insert';
      apply.title = turn.status === 'applied' ? 'Apply again' : 'Apply to draft';
      apply.setAttribute(
        'aria-label',
        historical
          ? 'Use draft'
          : turn.status === 'proposal'
            ? 'Apply to draft'
            : 'Apply again to draft',
      );
      apply.disabled = !historical && state.busy;
      const captured = target;
      dismiss.onclick = () => void command({ action: 'dismiss', turnId: turn.id }, captured);
      apply.onclick = historical
        ? () => void newTweet(turn.id)
        : () => void command({ action: 'apply', turnId: turn.id }, captured);
      if (!historical && turn.status === 'proposal') actions.append(dismiss);
      actions.append(apply);
    } else {
      const result = document.createElement('span');
      result.className = 'revision-state';
      result.textContent = 'Dismissed';
      actions.append(result);
    }
    article.append(actions);
  }
  return article;
}
function render() {
  el('empty').hidden = !!target || historyOpen;
  el('workspace').hidden = !target || historyOpen;
  prompt.hidden = !target;
  el('regenerate').hidden = !target;
  const nextIdentity = target ? `${target.tabId}:${target.state.composerId}` : '';
  if (nextIdentity !== identity) {
    unsent.set(identity, request.value);
    identity = nextIdentity;
    selectedPrompt = promptChoices.get(identity) || '';
    request.value = unsent.get(identity) || '';
    confirmation = undefined;
    el('conflict').hidden = true;
    error('');
    signature = '';
    expandedTools.clear();
    if (target) el('new-status').textContent = '';
  }
  if (!target) {
    updateSend();
    return;
  }
  const state = target.state;
  const composing = state.mode === 'compose';
  el('regenerate').hidden = state.turns.some((t) => t.role === 'agent' && t.status !== 'error');
  el('source-details').hidden = composing;
  el('source-text').textContent = state.post?.text || '';
  el('draft-details').hidden = !state.currentDraft.trim();
  el('context-row').hidden = composing && !state.currentDraft.trim() && !state.canUndo;
  request.placeholder =
    composing && !state.turns.length ? 'What do you want to say?' : 'Ask for a change…';
  el('source-author').textContent = state.post?.author || '';
  el('source-snippet').textContent = state.post?.text || '';
  el('quote-mode').classList.toggle('active', state.mode === 'quote');
  el('reply-mode').classList.toggle('active', state.mode === 'reply');
  el('reply-mode').toggleAttribute('aria-current', state.mode === 'reply');
  el('compose-mode').classList.toggle('active', composing);
  el('quote-mode').toggleAttribute('aria-current', state.mode === 'quote');
  el('compose-mode').toggleAttribute('aria-current', composing);
  el('source').textContent = state.post?.author || '';
  el<HTMLAnchorElement>('source').href = state.post?.url || 'https://x.com';

  el('current-draft').textContent = state.currentDraft || 'Nothing applied yet.';
  el('draft-count').textContent = state.currentDraft ? `${state.currentDraft.length}` : 'Empty';
  el('progress').textContent = state.busy ? state.status : '';
  el('progress').title = state.status;
  el('progress').parentElement!.hidden = !state.busy;
  el('stop').hidden = !state.busy;
  el('undo').hidden = !state.canUndo;
  if (
    prompt.options.length !== state.prompts.length ||
    JSON.stringify(Array.from(prompt.options, (o) => ({ id: o.value, name: o.text }))) !==
      JSON.stringify(state.prompts)
  ) {
    prompt.replaceChildren(...state.prompts.map((p) => new Option(p.name, p.id)));
  }
  if (selectedPrompt && !state.prompts.some((p) => p.id === selectedPrompt)) selectedPrompt = '';
  if (document.activeElement !== prompt) prompt.value = selectedPrompt || state.promptId;
  const nextSignature = JSON.stringify([state.turns, state.busy, state.toolCalls]);
  if (signature !== nextSignature) {
    const log = el('conversation');
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    log.replaceChildren(
      ...conversationItems(state.turns, state.toolCalls || []).map((item) =>
        item.kind === 'turn'
          ? renderTurn(item.turn, state)
          : renderToolHistory(item.traces, expandedTools, item.jobId),
      ),
    );
    if (nearBottom || !signature) log.scrollTop = log.scrollHeight;
    signature = nextSignature;
  }
  const model = el<HTMLSelectElement>('model-choice');
  if (document.activeElement !== model)
    model.value = state.modelId || publicConfig?.defaultModelId || 'default';
  model.disabled = state.busy || acting;
  updateSend();
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    target = await rpc<typeof target>({ type: 'panel:get', windowId: panelWindowId });
    render();
  } catch {
    target = null;
    render();
  } finally {
    polling = false;
  }
}
async function newTweet(restoreJobId?: string) {
  const buttons = [el<HTMLButtonElement>('new-tweet'), el<HTMLButtonElement>('start-tweet')];
  buttons.forEach((b) => (b.disabled = true));
  el('new-status').textContent = 'Opening a fresh draft… Sign in to X if prompted.';
  try {
    await rpc({ type: 'panel:new', windowId: panelWindowId, restoreJobId });
    setHistory(false);
    await refresh();
  } catch (e) {
    el('new-status').textContent = e instanceof Error ? e.message : 'Could not open X.';
    error(String(e));
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}
function setHistory(open: boolean) {
  historyOpen = open;
  el('history-view').hidden = !open;
  render();
}
async function loadPublicSettings() {
  publicConfig = await rpc<PublicSettings>({ type: 'settings:public' });
  const model = el<HTMLSelectElement>('model-choice');
  model.replaceChildren(
    ...(publicConfig.models || []).map((m) => {
      const o = new Option(m.model || 'Unconfigured model', m.id);
      o.disabled = !m.model;
      return o;
    }),
  );
  model.hidden = !model.options.length;
  model.value = target?.state.modelId || publicConfig.defaultModelId || 'default';
}
async function openMode(mode: 'quote' | 'reply', url?: string) {
  if (!url && target?.state.mode === mode) {
    setHistory(false);
    return;
  }
  requestedMode = mode;
  const source = url || target?.state.post?.url;
  if (!source) {
    el('source-picker-title').textContent = mode === 'reply' ? 'Reply to a post' : 'Quote a post';
    el('source-error').textContent = '';
    el<HTMLDialogElement>('source-picker').showModal();
    return;
  }
  try {
    await rpc({ type: 'panel:mode', windowId: panelWindowId, mode, url: source });
    el<HTMLDialogElement>('source-picker').close();
    setHistory(false);
    await refresh();
  } catch (e) {
    el('source-error').textContent = String(e);
    error(String(e));
  }
}
const sourceDetails = el<HTMLDetailsElement>('source-details');
sourceDetails.addEventListener('toggle', () => {
  sourceDetails.querySelector('.source-show')!.textContent = sourceDetails.open ? 'Hide' : 'Show';
});
el('quote-mode').onclick = () => void openMode('quote');
el('reply-mode').onclick = () => void openMode('reply');
el('compose-mode').onclick = () => {
  if (target?.state.mode !== 'compose') void newTweet();
  else setHistory(false);
};
el('source-cancel').onclick = () => el<HTMLDialogElement>('source-picker').close();
el<HTMLFormElement>('source-form').onsubmit = (event) => {
  event.preventDefault();
  void openMode(requestedMode, el<HTMLInputElement>('source-url').value);
};
el<HTMLSelectElement>('model-choice').onchange = () =>
  void command({ action: 'model', modelId: el<HTMLSelectElement>('model-choice').value });
el('history-back').onclick = () => setHistory(false);
el('history-toggle').onclick = () => {
  setHistory(true);
  const content = el('history-content');
  content.textContent = 'Loading…';
  void rpc<ReturnType<typeof historySessions>>({ type: 'panel:history' })
    .then((sessions) => {
      historyData = sessions;
      content.replaceChildren();
      if (!sessions.length) {
        content.textContent = 'No drafts yet. Your conversations appear here for 24 hours.';
        return;
      }
      for (const session of sessions) {
        const button = document.createElement('button');
        button.className = 'history-item';
        const title = document.createElement('span');
        title.textContent = session.title;
        const meta = document.createElement('span');
        meta.className = 'history-meta';
        meta.textContent = `${session.mode === 'compose' ? 'New post' : session.mode === 'reply' ? 'Reply' : 'Quote'} · ${new Date(session.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
        button.append(title, meta);
        button.onclick = () => showHistorical(session.id);
        content.append(button);
      }
    })
    .catch((e) => {
      content.textContent = String(e);
    });
};
function showHistorical(id: string) {
  const session = historyData.find((s) => s.id === id);
  if (!session) return;
  const content = el('history-content');
  content.replaceChildren();
  const back = document.createElement('button');
  back.className = 'quiet history-list-back';
  back.textContent = '← All conversations';
  back.onclick = () => el('history-toggle').click();
  content.append(back);
  if (session.post) {
    const source = document.createElement('a');
    source.href = session.post.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = session.post.author || 'Source post';
    content.append(source);
  }
  const state: PanelState = {
    composerId: 'history',
    mode: session.mode as PanelState['mode'],
    currentDraft: '',
    prompts: [],
    promptId: '',
    busy: false,
    ready: true,
    status: '',
    turns: session.turns,
    canUndo: false,
  };
  for (const item of conversationItems(session.turns, session.toolCalls))
    content.append(
      item.kind === 'turn'
        ? renderTurn(item.turn, state, true)
        : renderToolHistory(item.traces, expandedTools, `history:${item.jobId}`),
    );
}
el('new-tweet').onclick = () => void newTweet();
el('start-tweet').onclick = () => void newTweet();
el('settings').onclick = () => void rpc({ type: 'settings:open' }).catch((e) => error(String(e)));
prompt.onchange = () => {
  selectedPrompt = prompt.value;
  promptChoices.set(identity, selectedPrompt);
};
el('regenerate').onclick = () => void command({ action: 'regenerate', promptId: prompt.value });
el('stop').onclick = () => void command({ action: 'cancel' });
el('undo').onclick = () => void command({ action: 'undo' });
el('keep').onclick = () => {
  confirmation = undefined;
  el('conflict').hidden = true;
};
el('replace').onclick = () => {
  const c = confirmation;
  if (c && target?.tabId === c.tabId && target.state.composerId === c.composerId)
    void command({ ...c.command, expectedCurrent: c.expectedCurrent } as PanelCommand);
};
request.oninput = () => {
  unsent.set(identity, request.value);
  updateSend();
};
request.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    el<HTMLFormElement>('chat-form').requestSubmit();
  }
};
el<HTMLFormElement>('chat-form').onsubmit = (e) => {
  e.preventDefault();
  if (send.disabled) return;
  const instruction = request.value.trim(),
    captured = target;
  request.value = '';
  unsent.set(identity, '');
  updateSend();
  void command({ action: 'refine', instruction, promptId: prompt.value }, captured).then((ok) => {
    if (!ok && target?.state.composerId === captured?.state.composerId && !request.value) {
      request.value = instruction;
      updateSend();
    }
  });
};
void chrome.windows
  .getCurrent()
  .then((window) => {
    panelWindowId = window.id!;
    void loadPublicSettings().catch((e) => error(String(e)));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) void loadPublicSettings();
    });
    void refresh();
    setInterval(() => void refresh(), 600);
  })
  .catch(() => error('Could not connect to this browser window. Reopen the assistant.'));
