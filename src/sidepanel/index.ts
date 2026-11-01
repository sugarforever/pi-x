import { renderMarkdown } from './markdown';
import { inlineDrawing } from './inline-drawing';
import { PinnedArtifactPreview } from './pinned-artifact';
import { ArtifactWorkspace } from './artifact-workspace';
import { fromDiagram } from '../artifacts/diagram-adapter';
import { selectedArtifact } from '../artifacts/types';
import type { historySessions } from '../background/history';
import type { PublicSettings } from '../shared/types';
import { draftParts } from './draft-parts';
import { conversationItems } from './conversation-items';
import { renderToolHistory } from './tool-history';
import type { PanelCommand, PanelResult, PanelState, PanelTurn } from '../shared/panel';
const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const request = el<HTMLTextAreaElement>('request'),
  send = el<HTMLButtonElement>('send'),
  prompt = el<HTMLSelectElement>('prompt');
let target: { tabId: number; state: PanelState } | null = null;
const previewFragment = new URLSearchParams(location.hash.slice(1));
const detachedPreview = ['tab', 'window'].includes(previewFragment.get('preview') || '');
const dockedChats = new Set<string>();
let previewHostUpdates = Promise.resolve();
const pinnedPreview = new PinnedArtifactPreview(
  (action) => command(action),
  undefined,
  (visible) => {
    // Only minimize standalone owners, never the browser containing a preview tab.
    if (previewFragment.get('preview') !== 'window') return;
    // Preserve ordering if the floating preview closes before minimization finishes.
    previewHostUpdates = previewHostUpdates
      .then(() => chrome.windows.update(panelWindowId, { state: visible ? 'minimized' : 'normal' }))
      .then(() => {})
      .catch(() => {});
  },
);
if (detachedPreview) {
  document.body.classList.add('artifact-window');
  document.title = 'pi-x · Artifact preview';
}
async function openArtifactWindow() {
  if (!target || target.state.mode !== 'chat') return;
  const chatId = target.state.composerId;
  if (dockedChats.delete(chatId)) render();
  try {
    // PiP needs a click in its live owner document. Open a separate window
    // by default so the original page stays active in the chat browser.
    if (detachedPreview) {
      try {
        if (
          await pinnedPreview.open(
            chatId,
            target.state.artifacts ?? fromDiagram(target.state.diagram),
            target.state.busy,
          )
        )
          return;
        previewStatus('Keep on top is unavailable. Use this tab or open a separate window.');
      } catch {
        pinnedPreview.close();
        previewStatus('Could not pin the preview. Use this tab or open a separate window.');
      }
      return;
    }
    await rpc({ type: 'preview:open', chatId, mode: 'window' });
  } catch (e) {
    error(e instanceof Error ? e.message : 'Could not open artifact preview.');
  }
}
function previewStatus(message: string) {
  el('preview-help').textContent = message;
}
const pageOptions = el<HTMLDetailsElement>('page-details');
document.addEventListener('click', (event) => {
  if (!pageOptions.contains(event.target as Node)) pageOptions.open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') pageOptions.open = false;
});
el('preview-artifact').onclick = () => void openArtifactWindow();
el('pin-preview').hidden = !detachedPreview;
el('pin-preview').onclick = () => void openArtifactWindow();
el('preview-help').hidden = !detachedPreview;
el('open-preview-window').hidden = !detachedPreview || previewFragment.get('preview') === 'window';
el('open-preview-window').onclick = () => {
  if (!target) return;
  void rpc({ type: 'preview:open', chatId: target.state.composerId, mode: 'window' }).catch((e) =>
    previewStatus(String(e)),
  );
};
el('dock-artifact').onclick = () => {
  if (!target) return;
  const id = target.state.composerId;
  if (dockedChats.has(id)) dockedChats.delete(id);
  else dockedChats.add(id);
  render();
};
const expandedDiagram = el<HTMLDialogElement>('diagram-expanded');
const expandedViewer = new ArtifactWorkspace(el('expanded-diagram-view'), (action) =>
  command(action),
);
const diagramViewer = new ArtifactWorkspace(
  el('diagram-panel'),
  (action) => command(action),
  () => {
    expandedViewer.update(
      target?.state.artifacts ?? fromDiagram(target?.state.diagram),
      !!target?.state.busy,
    );
    expandedDiagram.showModal();
  },
);
el('close-diagram').onclick = () => (detachedPreview ? window.close() : expandedDiagram.close());
expandedDiagram.addEventListener('cancel', () => {
  if (detachedPreview) window.close();
});
el('open-diagram-tab').onclick = () => {
  if (!target || target.state.mode !== 'chat') return;
  void rpc({ type: 'preview:open', chatId: target.state.composerId, mode: 'tab' }).catch((e) =>
    error(String(e)),
  );
};

let signature = '';
const expandedTools = new Set<string>();
const expandedRevisions = new Set<string>();
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
  const state = target?.state;
  const latest = state?.turns.findLast((t) => t.role === 'agent' && t.status !== 'error');
  const changed = !!state && prompt.value !== (latest?.promptId || state.promptId);
  const chatting = state?.mode === 'chat';
  const label = state?.busy
    ? 'Stop generating'
    : chatting
      ? 'Send message'
      : !latest
        ? 'Generate draft'
        : changed || request.value.trim()
          ? 'Generate new version'
          : 'Generate again';
  send.innerHTML = state?.busy
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>';
  send.setAttribute('aria-label', label);
  send.title = `${label} · Enter (Shift + Enter for a new line)`;
  send.disabled =
    acting ||
    !state ||
    (!state.busy &&
      (!state.ready ||
        (chatting ? !request.value.trim() : !state.post && !latest && !request.value.trim())));
  const status = el('intent-status');
  status.textContent =
    !chatting && changed ? `“${prompt.selectedOptions[0]?.text}” selected. Generate to apply.` : '';
  status.hidden = chatting || !changed || !!state?.busy;
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
  if (turn.role === 'agent') renderMarkdown(text, turn.text);
  else text.textContent = turn.text;
  article.append(text);
  if (state.mode === 'chat') {
    const artifacts = state.artifacts ?? fromDiagram(state.diagram);
    if (turn.role === 'agent' && turn.jobId) {
      const cards = document.createElement('div');
      cards.className = 'artifact-cards';
      const seen = new Set<string>();
      for (const receipt of artifacts.operations.filter((r) => r.jobId === turn.jobId).reverse()) {
        if (seen.has(receipt.artifactId)) continue;
        const artifact = artifacts.items.find((a) => a.id === receipt.artifactId);
        if (!artifact) continue;
        seen.add(artifact.id);
        if (artifact.kind === 'diagram') {
          const version = artifact.versions.find((v) => v.id === receipt.versionId);
          cards.append(
            inlineDrawing(artifact, version, state.busy, async () => {
              await rpc({
                type: 'preview:open',
                chatId: state.composerId,
                mode: 'window',
                artifactId: artifact.id,
                versionId: receipt.versionId,
              });
            }),
          );
          continue;
        }
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'artifact-card';
        card.textContent = `${artifact.kind === 'code' ? 'Code' : 'Document'} · ${artifact.title}`;
        card.setAttribute('aria-label', `Open artifact ${artifact.title}`);
        card.disabled = state.busy || !artifact.versions.some((v) => v.id === receipt.versionId);
        card.onclick = async () => {
          const chatId = target?.state.composerId;
          const ok = await command({
            action: 'artifact',
            operation: 'version',
            artifactId: artifact.id,
            versionId: receipt.versionId,
          });
          if (ok && chatId === target?.state.composerId) await openArtifactWindow();
        };
        cards.append(card);
      }
      if (cards.childElementCount) article.append(cards);
    }
    if (turn.role === 'agent' && turn.status !== 'error') {
      const actions = document.createElement('div');
      actions.className = 'revision-actions';
      const copy = document.createElement('button');
      copy.className = 'quiet';
      copy.textContent = 'Copy';
      copy.onclick = () =>
        void navigator.clipboard
          .writeText(turn.text)
          .catch(() => error('Select the response text to copy it.'));
      const write = document.createElement('button');
      write.className = 'quiet';
      write.textContent = 'Write on X';
      write.onclick = () => void newTweet(turn.id);
      actions.append(copy, write);
      article.append(actions);
    }
    return article;
  }
  if (turn.role === 'agent' && turn.status !== 'error') {
    const sources = document.createElement('div');
    sources.className = 'source-chips';
    const seen = new Set<string>();
    const appendDraft = (node: HTMLElement, value: string) => {
      let offset = 0;
      for (const match of value.matchAll(/https:\/\/[^\s<>"）)]+/g)) {
        node.append(value.slice(offset, match.index));
        if (!URL.canParse(match[0])) {
          node.append(match[0]);
          offset = match.index! + match[0].length;
          continue;
        }
        if (!seen.has(match[0])) {
          seen.add(match[0]);
          const link = document.createElement('a');
          link.href = match[0];
          link.textContent = new URL(match[0]).hostname;
          link.className = 'source-chip';
          link.title = match[0];
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          sources.append(link);
        }
        offset = match.index! + match[0].length;
      }
      node.append(value.slice(offset));
      node.textContent = node.textContent?.trimEnd() || '';
    };
    text.replaceChildren();
    const parts = draftParts(turn.text);
    if (parts) {
      text.classList.add('thread-draft');
      parts.forEach((part, index) => {
        const post = document.createElement('div');
        post.className = 'thread-post';
        const body = document.createElement('div');
        appendDraft(body, part);
        const count = document.createElement('div');
        count.className = 'thread-count';
        count.textContent = `${index + 1}/${parts.length} · ${Array.from(part).length}`;
        post.append(body, count);
        text.append(post);
      });
    } else appendDraft(text, turn.text);
    if (sources.childElementCount) article.append(sources);
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
    meta.textContent = `v${version}${turn.promptName ? ` · ${turn.promptName}` : ''} · ${Array.from(turn.text).length} chars`;
    actions.append(meta, copy);

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
  const revisions = state.turns.filter((t) => t.role === 'agent' && t.status !== 'error');
  if (
    !historical &&
    turn.role === 'agent' &&
    turn.status !== 'error' &&
    revisions.at(-1)?.id !== turn.id
  ) {
    const details = document.createElement('details');
    details.className = 'earlier-revision';
    if (turn.jobId) details.dataset.jobId = turn.jobId;
    details.open = expandedRevisions.has(turn.id);
    const summary = document.createElement('summary');
    const index = state.turns.indexOf(turn);
    const instruction = state.turns.slice(0, index).findLast((t) => t.role === 'user')?.text;
    summary.textContent = `v${revisions.indexOf(turn) + 1} · ${Array.from(turn.text).length} chars${instruction ? ` · “${instruction.slice(0, 60)}”` : ''}`;
    details.append(summary, article);
    details.addEventListener('toggle', () => {
      if (details.open) expandedRevisions.add(turn.id);
      else expandedRevisions.delete(turn.id);
    });
    return details;
  }
  return article;
}
function render() {
  const logBeforeLayout = el('conversation');
  const followBottom =
    logBeforeLayout.scrollHeight - logBeforeLayout.scrollTop - logBeforeLayout.clientHeight < 80;
  const diagram =
    target?.state.mode === 'chat'
      ? (target.state.artifacts ?? fromDiagram(target.state.diagram))
      : undefined;
  pinnedPreview.update(
    target?.state.mode === 'chat' ? target.state.composerId : undefined,
    diagram,
    !!target?.state.busy,
  );
  el('page-context').hidden = target?.state.mode !== 'chat' || detachedPreview;
  const optionsChat = target?.state.composerId || '';
  if (pageOptions.dataset.chat !== optionsChat) {
    pageOptions.open = false;
    pageOptions.dataset.chat = optionsChat;
  }
  const docked = !!target && dockedChats.has(target.state.composerId) && !detachedPreview;
  el('artifact-chip').hidden = !diagram?.items.length || detachedPreview;
  el('preview-artifact').textContent = diagram?.items.length
    ? `${selectedArtifact(diagram)?.title || 'Artifacts'}${diagram.items.length > 1 ? ` · ${diagram.items.length} artifacts` : ''} ↗`
    : 'Artifacts ↗';
  el('dock-artifact').textContent = docked ? 'Hide preview' : 'Dock preview';
  el('dock-artifact').setAttribute('aria-pressed', String(docked));
  el('workspace').classList.toggle('has-diagram', docked && !!diagram?.items.length);
  el('workspace').classList.toggle('has-artifact', !!diagram?.items.length);
  const artifactKind = selectedArtifact(diagram)?.kind;
  expandedDiagram.setAttribute(
    'aria-label',
    artifactKind === 'diagram' ? 'Expanded diagram' : 'Expanded artifact',
  );
  el('close-diagram').textContent = detachedPreview
    ? 'Close preview'
    : artifactKind === 'diagram'
      ? 'Close diagram'
      : 'Close artifact';
  diagramViewer.update(docked ? diagram : undefined, !!target?.state.busy);
  if (expandedDiagram.open) expandedViewer.update(diagram, !!target?.state.busy);
  el('empty').hidden = !!target || historyOpen;
  el('workspace').hidden = !target || historyOpen;
  prompt.hidden = !target || target.state.mode === 'chat';
  const nextIdentity = target
    ? `${detachedPreview ? 'artifact' : target.tabId}:${target.state.composerId}`
    : '';
  if (nextIdentity !== identity) {
    if (expandedDiagram.open) expandedDiagram.close();
    unsent.set(identity, request.value);
    identity = nextIdentity;
    selectedPrompt = promptChoices.get(identity) || '';
    request.value = unsent.get(identity) || '';
    confirmation = undefined;
    el('conflict').hidden = true;
    error('');
    signature = '';
    expandedTools.clear();
    expandedRevisions.clear();
    el<HTMLInputElement>('allow-screenshot').checked = false;
    if (target) el('new-status').textContent = '';
  }
  if (!target) {
    updateSend();
    return;
  }
  const state = target.state;
  const composing = state.mode === 'compose';
  const chatting = state.mode === 'chat';
  el('chat-mode').classList.toggle('active', chatting);
  if (chatting) renderPageContext(state);
  el('mode-label').textContent = chatting
    ? 'Page chat'
    : composing
      ? 'New post'
      : state.mode === 'reply'
        ? 'Reply'
        : 'Quote';
  el('source-details').hidden = composing || chatting;
  el('source-text').textContent = state.post?.text || '';
  el('draft-details').hidden = !state.currentDraft.trim();
  el('context-row').hidden = !state.canUndo;
  request.placeholder = chatting
    ? 'Ask about this page…'
    : composing && !state.turns.length
      ? 'What do you want to say?'
      : 'Additional instructions (optional)';
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
  const nextSignature = JSON.stringify([
    state.mode,
    state.turns,
    state.busy,
    state.toolCalls,
    state.artifacts ?? state.diagram,
  ]);
  if (signature !== nextSignature) {
    const log = el('conversation');
    const nearBottom = followBottom;
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
  if (followBottom) logBeforeLayout.scrollTop = logBeforeLayout.scrollHeight;
}
function renderPageContext(state: PanelState) {
  const page = state.pageContext;
  el('page-title').textContent = page?.title || 'No page attached';
  const link = el<HTMLAnchorElement>('page-url');
  link.textContent = page?.url || '';
  link.removeAttribute('href');
  if (page && /^https?:\/\//i.test(page.url)) link.href = page.url;
  el('page-metadata').textContent = page
    ? [
        page.siteName,
        page.author,
        page.description,
        page.language,
        page.publishedAt && `Published: ${page.publishedAt}`,
        page.updatedAt && `Updated: ${page.updatedAt}`,
        page.canonicalUrl && `Canonical: ${page.canonicalUrl}`,
        `Captured: ${new Date(page.capturedAt).toLocaleString()}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : '';
  el('page-limitations').textContent = page?.limitations.join(' ') || '';
  el('page-selection').textContent = page?.selection ? `Selected text: ${page.selection}` : '';
  el('page-text').textContent = page?.text || '';
  el('page-notice').textContent = state.pageChanged
    ? `You’re viewing ${state.activePageTitle || 'another page'}. This chat keeps its attached snapshot. Use current page to update it.`
    : page
      ? 'Refresh captures the current page for future messages.'
      : 'No page attached. Earlier messages may still contain previous context.';
  for (const id of ['refresh-page', 'remove-page', 'delete-chat'])
    el<HTMLButtonElement>(id).disabled = acting;
}
async function pageAction(action: 'new' | 'refresh' | 'remove' | 'resume' | 'delete', id?: string) {
  acting = true;
  updateSend();
  try {
    await rpc({ type: 'panel:chat', windowId: panelWindowId, ...(id ? { id } : {}), action });
    setHistory(false);
    await refresh();
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not update page context.';
    error(message);
    el('new-status').textContent = message;
  } finally {
    acting = false;
    render();
  }
}
async function refresh() {
  if (polling) return;
  polling = true;
  try {
    target = await rpc<typeof target>({ type: 'panel:get', windowId: panelWindowId });
    if (detachedPreview && !target) {
      window.close();
      return;
    }
    render();
  } catch {
    if (detachedPreview) previewStatus('Reconnecting to the conversation…');
    else {
      target = null;
      render();
    }
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
el('mode-menu').addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('button'))
    el<HTMLDetailsElement>('mode-menu').open = false;
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') el<HTMLDetailsElement>('mode-menu').open = false;
});
document.addEventListener('click', (event) => {
  if (!el('mode-menu').contains(event.target as Node))
    el<HTMLDetailsElement>('mode-menu').open = false;
});
el('chat-mode').onclick = () => void pageAction('new');
el('start-chat').onclick = () => void pageAction('new');
el('refresh-page').onclick = () => void pageAction('refresh', target?.state.composerId);
el('remove-page').onclick = () => void pageAction('remove', target?.state.composerId);
el('delete-chat').onclick = () => {
  if (confirm('Delete this conversation and its saved context?'))
    void pageAction('delete', target?.state.composerId);
};
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
        content.textContent =
          'No conversations yet. Chats are kept locally for 24 hours after their latest activity.';
        return;
      }
      for (const session of sessions) {
        const button = document.createElement('button');
        button.className = 'history-item';
        const title = document.createElement('span');
        title.textContent = session.title;
        const meta = document.createElement('span');
        meta.className = 'history-meta';
        meta.textContent = `${session.mode === 'chat' ? 'Page chat' : session.mode === 'compose' ? 'New post' : session.mode === 'reply' ? 'Reply' : 'Quote'} · ${new Date(session.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
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
  if (session.mode === 'chat') {
    const resume = document.createElement('button');
    resume.textContent = 'Continue chat';
    resume.className = 'primary';
    resume.onclick = () => void pageAction('resume', session.id);
    content.append(resume);
  }
  if (session.post) {
    const source = document.createElement('a');
    source.href = session.post.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    source.textContent = session.post.author || 'Source post';
    content.append(source);
  }
  const state: PanelState = {
    composerId: session.id,
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
  const turns = document.createElement('div');
  content.append(turns);
  const renderHistory = () =>
    turns.replaceChildren(
      ...conversationItems(session.turns, session.toolCalls).map((item) =>
        item.kind === 'turn'
          ? renderTurn(item.turn, state, true)
          : renderToolHistory(item.traces, expandedTools, `history:${item.jobId}`),
      ),
    );
  renderHistory();
  if (session.mode === 'chat') {
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Loading drawings…';
    turns.before(status);
    void rpc<NonNullable<PanelState['artifacts']>>({
      type: 'panel:artifact-history',
      chatId: session.id,
    })
      .then((artifacts) => {
        if (!turns.isConnected) return;
        state.artifacts = {
          ...artifacts,
          items: artifacts.items.filter((a) => a.kind === 'diagram'),
        };
        renderHistory();
        status.remove();
      })
      .catch(() => {
        if (turns.isConnected)
          status.textContent = 'Could not load saved drawings. Continue this chat to try again.';
      });
  }
}
el('new-tweet').setAttribute('aria-label', 'New chat');
el('new-tweet').title = 'New chat';
el('new-tweet').onclick = () => void pageAction('new');
el('start-tweet').onclick = () => void newTweet();
el('settings').onclick = () => void rpc({ type: 'settings:open' }).catch((e) => error(String(e)));
prompt.onchange = () => {
  selectedPrompt = prompt.value;
  promptChoices.set(identity, selectedPrompt);
  updateSend();
};
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
  if (target?.state.busy) {
    void command({ action: 'cancel' });
    return;
  }
  if (!request.value.trim()) {
    void command({ action: 'regenerate', promptId: prompt.value });
    return;
  }
  const instruction = request.value.trim(),
    captured = target;
  request.value = '';
  unsent.set(identity, '');
  updateSend();
  void command(
    target?.state.mode === 'chat'
      ? {
          action: 'refine',
          instruction,
          ...(el<HTMLInputElement>('allow-screenshot').checked ? { allowScreenshot: true } : {}),
        }
      : { action: 'refine', instruction, promptId: prompt.value },
    captured,
  ).then((ok) => {
    if (!ok && target?.state.composerId === captured?.state.composerId && !request.value) {
      request.value = instruction;
      unsent.set(identity, instruction);
      updateSend();
    }
  });
};
void chrome.windows
  .getCurrent()
  .then(async (window) => {
    panelWindowId = window.id!;
    void loadPublicSettings().catch((e) => error(String(e)));
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) void loadPublicSettings();
    });
    const fragment = previewFragment;
    const diagramChat = fragment.get('artifact') || fragment.get('diagram');
    if (!detachedPreview && diagramChat && diagramChat.length <= 100)
      await rpc({ type: 'panel:chat', windowId: panelWindowId, action: 'resume', id: diagramChat });
    await refresh();
    if (diagramChat && target?.state.mode === 'chat') {
      expandedViewer.update(
        target.state.artifacts ?? fromDiagram(target.state.diagram),
        target.state.busy,
      );
      expandedDiagram.showModal();
    }
    setInterval(() => void refresh(), 600);
  })
  .catch(() => error('Could not connect to this browser window. Reopen the assistant.'));
