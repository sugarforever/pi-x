import { rpc } from '../shared/rpc';
import {
  modelBaseUrl,
  modelProfiles,
  behaviorSettings,
  validateSettings,
} from '../shared/settings';
import { originPattern, xPostUrl } from '../shared/urls';
import type { Settings, ToolName, ModelProvider, ChatGPTStatus } from '../shared/types';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
for (const control of document.querySelectorAll<
  HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement
>('input,button,textarea,select'))
  control.disabled = true;
let state: Settings;
let editingModelId = 'default';
let previewJob: string | undefined;
let previewGeneration = 0;
const input = (id: string) => $<HTMLInputElement>(id);
function notify(id: string, message: unknown) {
  $(id).textContent = message instanceof Error ? message.message : String(message);
}
function field(label: string, value: string, multiline = false) {
  const id = crypto.randomUUID();
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;
  const control = multiline ? document.createElement('textarea') : document.createElement('input');
  control.id = id;
  control.value = value;
  if (control instanceof HTMLTextAreaElement) control.rows = 4;
  return { label: l, control };
}
function renderPrompts() {
  const list = $('prompt-list');
  list.replaceChildren();
  for (const p of state.prompts) {
    const card = document.createElement('details');
    card.className = 'prompt-card';
    card.dataset.promptId = p.id;
    card.dataset.default = String(p.id === state.defaultPromptId);
    card.open = p.id === state.defaultPromptId || !p.instructions;
    const summary = document.createElement('summary');
    const summaryName = document.createElement('span');
    summaryName.className = 'row-name';
    summaryName.textContent = p.name;
    const excerpt = document.createElement('span');
    excerpt.className = 'row-excerpt';
    excerpt.textContent = p.instructions;
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = p.id === state.defaultPromptId ? 'Default' : 'Edit';
    summary.append(summaryName, excerpt, badge);
    const head = document.createElement('div');
    head.className = 'prompt-head';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = p.name;
    name.setAttribute('aria-label', 'Prompt name');
    name.maxLength = 80;
    name.oninput = () => {
      p.name = name.value;
      summaryName.textContent = p.name;
      refreshPreviewPrompts();
      dirty();
    };
    const label = document.createElement('label');
    label.className = 'default-label';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'default-prompt';
    radio.checked = p.id === state.defaultPromptId;
    radio.onchange = () => {
      state.defaultPromptId = p.id;
      for (const row of document.querySelectorAll<HTMLElement>('.prompt-card')) {
        const current = row.dataset.promptId === p.id;
        row.dataset.default = String(current);
        const badge = row.querySelector('summary .badge');
        if (badge) badge.textContent = current ? 'Default' : 'Edit';
      }
      dirty();
    };
    label.append(radio, 'Default');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = 'Remove';
    remove.onclick = () => {
      if (state.prompts.length === 1) {
        notify('save-status', 'Keep at least one prompt.');
        return;
      }
      state.prompts = state.prompts.filter((x) => x.id !== p.id);
      if (state.defaultPromptId === p.id) state.defaultPromptId = state.prompts[0].id;
      renderPrompts();
      dirty();
    };
    name.className = 'row-name row-name-input';
    summary.replaceChild(name, summaryName);
    head.append(label, remove);
    const instructions = field('Instructions', p.instructions, true);
    instructions.control.maxLength = 12000;
    instructions.control.oninput = () => {
      p.instructions = instructions.control.value;
      excerpt.textContent = p.instructions;
      dirty();
    };
    const body = document.createElement('div');
    body.className = 'row-body';
    const tools = document.createElement('div');
    tools.className = 'intent-tools';
    const toolLabel = document.createElement('span');
    toolLabel.textContent = 'Tools';
    tools.append(toolLabel);
    const choices: [ToolName, string][] = [
      ['articles', 'read_page'],
      ['context', 'read_context'],
      ['voice', 'match_voice'],
      ['search', 'web_search'],
    ];
    for (const [id, label] of choices) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.textContent = label;
      const selected = () => (p.enabledTools || choices.map(([key]) => key)).includes(id);
      chip.setAttribute('aria-pressed', String(selected()));
      chip.onclick = () => {
        const enabled = new Set(p.enabledTools || choices.map(([key]) => key));
        if (enabled.has(id)) enabled.delete(id);
        else enabled.add(id);
        p.enabledTools = [...enabled];
        chip.setAttribute('aria-pressed', String(selected()));
        dirty();
      };
      tools.append(chip);
    }
    body.append(head, instructions.label, instructions.control, tools);
    card.append(summary, body);
    list.append(card);
  }
  refreshPreviewPrompts();
}
function refreshPreviewPrompts() {
  const select = $<HTMLSelectElement>('preview-prompt');
  const selected = select.value;
  select.replaceChildren();
  for (const p of state.prompts) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    select.append(o);
  }
  select.value = state.prompts.some((p) => p.id === selected) ? selected : state.defaultPromptId;
}
function renderSamples() {
  const list = $('sample-list');
  list.replaceChildren();
  if (!state.samples.length) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent =
      'A few examples go a long way. Add a post, a paragraph, or a piece of writing that sounds like you.';
    list.append(p);
  }
  for (const s of state.samples) {
    const card = document.createElement('details');
    card.className = 'sample-card';
    card.open = !s.text;
    const summary = document.createElement('summary');
    const number = document.createElement('span');
    number.className = 'sample-number';
    number.textContent = String(state.samples.indexOf(s) + 1).padStart(2, '0');
    const excerpt = document.createElement('span');
    excerpt.className = 'row-excerpt';
    excerpt.textContent = s.title || s.text || 'New sample';
    summary.append(number, excerpt);
    const title = field('Title / topic', s.title);
    title.control.oninput = () => {
      s.title = title.control.value;
      excerpt.textContent = s.title || s.text || 'New sample';
      dirty();
    };
    const text = field('Writing sample', s.text, true);
    text.control.maxLength = 12000;
    text.control.oninput = () => {
      s.text = text.control.value;
      excerpt.textContent = s.title || s.text || 'New sample';
      dirty();
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = 'Remove example';
    remove.onclick = () => {
      state.samples = state.samples.filter((x) => x.id !== s.id);
      renderSamples();
      dirty();
    };
    const body = document.createElement('div');
    body.className = 'row-body';
    body.append(title.label, title.control, text.label, text.control, remove);
    card.append(summary, body);
    list.append(card);
  }
}
let saveQueue: Promise<void> = Promise.resolve();
let saveRevision = 0;
function dirty() {
  const revision = ++saveRevision;
  let settings: Settings;
  try {
    settings = collect();
  } catch (error) {
    notify('save-status', `Not saved: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  notify('save-status', 'Saving…');
  // Preserve edit order without replacing the live form state with older snapshots.
  saveQueue = saveQueue.then(async () => {
    try {
      await rpc({ type: 'settings:save', settings });
      if (revision === saveRevision) notify('save-status', 'All changes saved.');
    } catch (error) {
      if (revision === saveRevision)
        notify(
          'save-status',
          `Not saved: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
  });
}
function commitProfile() {
  const profile = state.models?.find((m) => m.id === editingModelId);
  if (!profile) return;
  Object.assign(profile, {
    provider: $<HTMLSelectElement>('provider').value as ModelProvider,
    baseUrl: input('base-url').value,
    apiKey: input('api-key').value,
    model: input('model').value,
  });
  const row = [...document.querySelectorAll<HTMLElement>('.model-row')].find(
    (row) => row.dataset.modelId === profile.id,
  );
  const name = row?.querySelector('.model-id'),
    host = row?.querySelector('.model-host');
  if (name) name.textContent = profile.model || 'Model ID';
  if (host) {
    try {
      host.textContent =
        profile.provider === 'chatgpt' ? 'ChatGPT subscription' : new URL(profile.baseUrl).host;
    } catch {
      host.textContent = profile.baseUrl;
    }
  }
}
function collect(): Settings {
  commitProfile();
  return validateSettings({
    ...state,
    behavior: {
      autoDraft: input('auto-draft').checked,
      readContext: input('read-context').checked,
      language: $<HTMLSelectElement>('draft-language').value,
    },
  });
}
function renderModels() {
  const list = $('model-list');
  const editor = $('model-editor');
  list.replaceChildren();
  for (const profile of state.models!) {
    const row = document.createElement('div');
    row.className = 'model-row';
    row.dataset.modelId = profile.id;
    const heading = document.createElement('div');
    heading.className = 'model-heading';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'default-model';
    radio.checked = profile.id === state.defaultModelId;
    radio.setAttribute('aria-label', `Use ${profile.model || 'unnamed model'} by default`);
    radio.onchange = () => {
      state.defaultModelId = profile.id;
      dirty();
      renderModels();
    };
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'model-edit';
    const name = document.createElement('span');
    name.className = 'model-id';
    name.textContent = profile.model || 'Model ID';
    const host = document.createElement('span');
    host.className = 'model-host';
    try {
      host.textContent =
        profile.provider === 'chatgpt' ? 'ChatGPT subscription' : new URL(profile.baseUrl).host;
    } catch {
      host.textContent = profile.baseUrl;
    }
    edit.append(name, host);
    edit.onclick = () => {
      commitProfile();
      editingModelId = profile.id;
      input('base-url').value = profile.baseUrl;
      input('api-key').value = profile.apiKey;
      input('model').value = profile.model;
      renderModels();
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'delete';
    remove.textContent = 'Remove';
    remove.disabled = state.models!.length === 1;
    remove.onclick = async () => {
      commitProfile();
      if (profile.provider === 'chatgpt') {
        remove.disabled = true;
        try {
          const account = await rpc<ChatGPTStatus>({ type: 'chatgpt:status' });
          if (account.state === 'signed-in') {
            edit.click();
            renderAccount(account);
            notify(
              'connection-status',
              'Sign out of ChatGPT before removing this model. Signing out disconnects all ChatGPT subscription profiles.',
            );
            $('chatgpt-signout').focus();
            return;
          }
        } catch (error) {
          edit.click();
          notify('connection-status', error);
          return;
        } finally {
          remove.disabled = state.models!.length === 1;
        }
      }
      if (state.models!.length === 1) return;
      state.models = state.models!.filter((m) => m.id !== profile.id);
      if (state.defaultModelId === profile.id) state.defaultModelId = state.models[0].id;
      if (editingModelId === profile.id) {
        editingModelId = state.defaultModelId!;
        const m = state.models.find((m) => m.id === editingModelId)!;
        input('base-url').value = m.baseUrl;
        input('api-key').value = m.apiKey;
        input('model').value = m.model;
      }
      renderModels();
      dirty();
    };
    heading.append(radio, edit);
    if (profile.id === state.defaultModelId) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'Default';
      heading.append(badge);
    }
    heading.append(remove);
    row.append(heading);
    list.append(row);
    if (profile.id === editingModelId) row.append(editor);
  }
  const selected = state.models!.find((m) => m.id === editingModelId)!;
  $<HTMLSelectElement>('provider').value = selected.provider || 'openai-compatible';
  renderProvider();
}
function renderProvider() {
  const subscription = $<HTMLSelectElement>('provider').value === 'chatgpt';
  $('compatible-fields').hidden = subscription;
  input('base-url').required = !subscription;
  $('chatgpt-account').hidden = !subscription;
}
$<HTMLSelectElement>('provider').onchange = () => {
  renderProvider();
  dirty();
};
// Poll via short background RPCs. Pending state survives worker suspension and
// resumes when settings is reopened; no long-lived service-worker timer is needed.
let accountTimer: ReturnType<typeof setTimeout> | undefined;
let accountGeneration = 0;
function stopAccountPolling() {
  ++accountGeneration;
  clearTimeout(accountTimer);
}
function renderAccount(status: ChatGPTStatus) {
  const pending = status.state === 'pending';
  const signedIn = status.state === 'signed-in';
  $('chatgpt-signin').hidden = pending || signedIn;
  $('chatgpt-device-signin').hidden = pending || signedIn;
  $('chatgpt-cancel').hidden = !pending;
  $('chatgpt-signout').hidden = !signedIn;
  $('chatgpt-device').hidden = !pending || status.method === 'browser';
  $('chatgpt-code').textContent = status.userCode || '';
  notify(
    'chatgpt-status',
    status.error ||
      (pending
        ? status.method === 'browser'
          ? 'Complete sign-in in the ChatGPT browser tab…'
          : 'Waiting for ChatGPT authorization…'
        : signedIn
          ? 'Signed in with ChatGPT.'
          : 'Signed out.'),
  );
}
async function accountAction(
  action: 'status' | 'browser' | 'start' | 'poll' | 'cancel' | 'signout',
) {
  stopAccountPolling();
  const generation = accountGeneration;
  const buttons = [
    'chatgpt-signin',
    'chatgpt-device-signin',
    'chatgpt-cancel',
    'chatgpt-signout',
  ].map((id) => $<HTMLButtonElement>(id));
  for (const button of buttons) button.disabled = true;
  if (action === 'start' || action === 'browser') notify('chatgpt-status', 'Starting sign-in…');
  try {
    const status = await rpc<ChatGPTStatus>({ type: `chatgpt:${action}` });
    if (generation !== accountGeneration) return;
    renderAccount(status);
    if (status.state === 'pending') {
      accountTimer = setTimeout(
        () => void accountAction('poll'),
        Math.max(1000, (status.nextPollAt || Date.now() + 5000) - Date.now()),
      );
    }
  } catch (error) {
    if (generation === accountGeneration) {
      renderAccount({ state: 'signed-out' });
      notify('chatgpt-status', error);
    }
  } finally {
    if (generation === accountGeneration) for (const button of buttons) button.disabled = false;
  }
}
$('chatgpt-signin').onclick = () => void accountAction('browser');
$('chatgpt-device-signin').onclick = () => void accountAction('start');
$('chatgpt-cancel').onclick = () => void accountAction('cancel');
$('chatgpt-signout').onclick = () => void accountAction('signout');
async function permissions(s: Settings) {
  // Called directly from the user's click/submit gesture, before other asynchronous work.
  const origins = [originPattern(modelBaseUrl(s))];
  origins.push('https://mcp.exa.ai/*');
  if (!(await chrome.permissions.request({ origins })))
    throw new Error('Site access was declined. Grant access to use this connection.');
}
async function initialize() {
  state = await rpc<Settings>({ type: 'settings:get' });
  state.models = modelProfiles(state);
  state.defaultModelId ||= 'default';
  editingModelId = state.defaultModelId;
  const behavior = behaviorSettings(state);
  input('auto-draft').checked = behavior.autoDraft;
  input('read-context').checked = behavior.readContext;
  $<HTMLSelectElement>('draft-language').value = behavior.language;
  input('base-url').value = state.baseUrl;
  input('api-key').value = state.apiKey;
  input('model').value = state.model;
  renderModels();
  renderPrompts();
  renderSamples();
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement
  >('input,button,textarea,select'))
    control.disabled = false;
  renderModels();
  await accountAction('status');
}
document.addEventListener('input', (event) => {
  if (
    event.target instanceof HTMLElement &&
    ['base-url', 'api-key', 'model', 'auto-draft', 'read-context', 'draft-language'].includes(
      event.target.id,
    )
  )
    dirty();
});
$('settings-form').addEventListener('submit', (event) => event.preventDefault());
$('test-connection').onclick = () => {
  void (async () => {
    const b = $<HTMLButtonElement>('test-connection');
    try {
      const s = validateSettings({ ...collect(), defaultModelId: editingModelId });
      const grant = permissions(s);
      b.disabled = true;
      notify('connection-status', 'Connecting…');
      await grant;
      notify('connection-status', await rpc({ type: 'connection:test', settings: s }));
    } catch (e) {
      notify('connection-status', e);
    } finally {
      b.disabled = false;
    }
  })();
};
$('add-model').onclick = () => {
  if (state.models!.length >= 12) return;
  commitProfile();
  const profile = {
    id: crypto.randomUUID(),
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
  };
  state.models!.push(profile);
  editingModelId = profile.id;
  input('base-url').value = profile.baseUrl;
  input('api-key').value = '';
  input('model').value = '';
  renderModels();
  dirty();
  input('model').focus();
};
$('add-prompt').onclick = () => {
  if (state.prompts.length >= 30) {
    notify('save-status', 'You can save up to 30 prompts.');
    return;
  }
  state.prompts.push({ id: crypto.randomUUID(), name: 'New prompt', instructions: '', tools: [] });
  renderPrompts();
  dirty();
};
$('add-sample').onclick = () => {
  if (state.samples.length >= 100) return;
  state.samples.push({ id: crypto.randomUUID(), title: '', text: '' });
  renderSamples();
  dirty();
};
$('clear-data').onclick = () => {
  if (
    !confirm(
      'Delete all API keys, ChatGPT sign-ins, prompts, writing examples, and draft sessions from this extension?',
    )
  )
    return;
  saveRevision++;
  stopAccountPolling();
  void saveQueue
    .then(() => rpc({ type: 'data:clear' }))
    .then(() => initialize())
    .then(
      () => notify('clear-status', ' All extension data cleared.'),
      (e) => notify('clear-status', e),
    );
};
async function cancelPreview() {
  previewGeneration++;
  const id = previewJob;
  previewJob = undefined;
  if (id) await rpc({ type: 'job:cancel', id }).catch(() => {});
  $('preview-cancel').hidden = true;
  $<HTMLButtonElement>('preview-run').disabled = false;
}
$('preview-cancel').onclick = () => {
  void cancelPreview();
  notify('preview-status', 'Cancelled.');
};
$('preview-run').onclick = () => {
  void (async () => {
    await cancelPreview();
    await saveQueue;
    const generation = ++previewGeneration;
    try {
      const text = $<HTMLTextAreaElement>('preview-post').value.trim();
      if (!text) throw new Error('Paste an example post first.');
      const url = input('preview-url').value.trim();
      const valid = url ? xPostUrl(url) : 'https://x.com/preview/status/0';
      const id = valid.match(/\/status\/(\d+)/)![1];
      $<HTMLButtonElement>('preview-run').disabled = true;
      $('preview-cancel').hidden = false;
      notify('preview-status', 'Starting…');
      const result = await rpc<{ id: string }>({
        type: 'job:start',
        composerId: 'playground',
        promptId: $<HTMLSelectElement>('preview-prompt').value,
        post: {
          id,
          url: valid,
          author: 'Preview',
          text,
          links: Array.from(text.matchAll(/https:\/\/[^\s<>]+/g), (m) => m[0]).slice(0, 30),
        },
      });
      if (generation !== previewGeneration) {
        await rpc({ type: 'job:cancel', id: result.id });
        return;
      }
      previewJob = result.id;
      while (generation === previewGeneration) {
        const j = await rpc<{ status: string; progress: string; draft?: string; error?: string }>({
          type: 'job:get',
          id: result.id,
        });
        if (generation !== previewGeneration) return;
        notify('preview-status', j.error || j.progress);
        if (j.status !== 'running') {
          if (j.draft) $<HTMLTextAreaElement>('preview-result').value = j.draft;
          break;
        }
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (e) {
      notify('preview-status', e);
    } finally {
      if (generation === previewGeneration) {
        previewJob = undefined;
        $('preview-cancel').hidden = true;
        $<HTMLButtonElement>('preview-run').disabled = false;
      }
    }
  })();
};
window.addEventListener('pagehide', () => {
  stopAccountPolling();
  void cancelPreview();
});
void initialize().catch((e) => notify('save-status', e));

const links = [...document.querySelectorAll<HTMLAnchorElement>('nav a')];
for (const link of links)
  link.addEventListener('click', () => {
    for (const item of links) item.classList.toggle('active', item === link);
  });
links[0]?.classList.add('active');
if (typeof IntersectionObserver !== 'undefined') {
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible)
        for (const link of links)
          link.classList.toggle('active', link.hash === `#${visible.target.id}`);
    },
    { rootMargin: '-5% 0px -65% 0px' },
  );
  document.querySelectorAll('main section[id]').forEach((section) => observer.observe(section));
}
