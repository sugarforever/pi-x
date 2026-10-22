import { rpc } from '../shared/rpc';
import { validateSettings } from '../shared/settings';
import { originPattern, xPostUrl } from '../shared/urls';
import type { Settings, ToolName } from '../shared/types';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
for (const control of document.querySelectorAll<
  HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement
>('input,button,textarea,select'))
  control.disabled = true;
let state: Settings;
let previewJob: string | undefined;
let previewGeneration = 0;
const input = (id: string) => $<HTMLInputElement>(id);
function notify(id: string, message: unknown) {
  $(id).textContent = message instanceof Error ? message.message : String(message);
}
const tools: Record<ToolName, string> = {
  articles: 'Read articles',
  context: 'Conversation context',
  voice: 'Writing examples',
  search: 'Web search',
};
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
    const card = document.createElement('div');
    card.className = 'prompt-card';
    const head = document.createElement('div');
    head.className = 'prompt-head';
    const name = document.createElement('input');
    name.type = 'text';
    name.value = p.name;
    name.setAttribute('aria-label', 'Prompt name');
    name.maxLength = 80;
    name.oninput = () => {
      p.name = name.value;
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
    head.append(name, label, remove);
    const instructions = field('Instructions', p.instructions, true);
    instructions.control.maxLength = 12000;
    instructions.control.oninput = () => {
      p.instructions = instructions.control.value;
      dirty();
    };
    const row = document.createElement('div');
    row.className = 'tools';
    for (const [tool, title] of Object.entries(tools)) {
      const l = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = p.tools.includes(tool as ToolName);
      check.onchange = () => {
        p.tools = check.checked
          ? [...new Set([...p.tools, tool as ToolName])]
          : p.tools.filter((x) => x !== tool);
        dirty();
      };
      l.append(check, title);
      row.append(l);
    }
    card.append(head, instructions.label, instructions.control, row);
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
    const card = document.createElement('div');
    card.className = 'sample-card';
    const title = field('Title / topic', s.title);
    title.control.oninput = () => {
      s.title = title.control.value;
      dirty();
    };
    const text = field('Writing sample', s.text, true);
    text.control.maxLength = 12000;
    text.control.oninput = () => {
      s.text = text.control.value;
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
    card.append(title.label, title.control, text.label, text.control, remove);
    list.append(card);
  }
}
function dirty() {
  notify('save-status', 'You have unsaved changes.');
}
function collect(): Settings {
  return validateSettings({
    ...state,
    baseUrl: input('base-url').value,
    apiKey: input('api-key').value,
    model: input('model').value,
    searchKey: input('search-key').value,
    articleAccess: input('article-access').checked,
  });
}
async function permissions(s: Settings) {
  // Called directly from the user's click/submit gesture, before other asynchronous work.
  const origins = [originPattern(s.baseUrl)];
  if (s.searchKey) origins.push('https://api.search.brave.com/*');
  if (input('article-access').checked) origins.push('https://*/*');
  if (!(await chrome.permissions.request({ origins })))
    throw new Error('Site access was declined. Grant access to use this connection.');
}
async function initialize() {
  state = await rpc<Settings>({ type: 'settings:get' });
  input('base-url').value = state.baseUrl;
  input('api-key').value = state.apiKey;
  input('model').value = state.model;
  input('search-key').value = state.searchKey;
  input('article-access').checked = state.articleAccess;
  renderPrompts();
  renderSamples();
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement | HTMLSelectElement
  >('input,button,textarea,select'))
    control.disabled = false;
}
$('settings-form').addEventListener('input', dirty);
$('settings-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    try {
      const s = collect();
      await permissions(s);
      await rpc({ type: 'settings:save', settings: s });
      state = s;
      notify('save-status', 'Settings saved. You’re ready to quote.');
    } catch (e) {
      notify('save-status', e);
    }
  })();
});
$('test-connection').onclick = () => {
  void (async () => {
    const b = $<HTMLButtonElement>('test-connection');
    try {
      const s = collect();
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
      'Delete all API keys, prompts, writing examples, and draft sessions from this extension?',
    )
  )
    return;
  void rpc({ type: 'data:clear' })
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
  void cancelPreview();
});
void initialize().catch((e) => notify('save-status', e));
