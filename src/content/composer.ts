import type { Post, PublicSettings } from '../shared/types';
import { rpc, RpcTransportError } from '../shared/rpc';
import { canAutoInsert, editorText, insertDraft } from './dom';
const STYLE = `:host{display:block;margin:12px 0;color:inherit;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}.bar{border:1px solid #53647166;border-radius:12px;padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;background:light-dark(#f7f9f9,#16181c);color:light-dark(#0f1419,#eff3f4);color-scheme:light dark}button,select{font:inherit;border:1px solid #53647180;border-radius:8px;padding:6px 9px;color:inherit;background:transparent;cursor:pointer}button:hover{background:#1d9bf020}button:disabled{opacity:.5;cursor:default}select{max-width:180px}select option{background:Canvas;color:CanvasText}.name{font-weight:700}.status{flex-basis:100%;line-height:1.5;white-space:pre-wrap}.preview{width:100%;min-height:110px;resize:vertical;font:inherit;border-radius:8px;padding:8px;background:Canvas;color:CanvasText;border:1px solid #53647180}[hidden]{display:none!important}a{color:#1d9bf0}`;
export class Composer {
  readonly id = crypto.randomUUID();
  private host = document.createElement('div');
  private shadow = this.host.attachShadow({ mode: 'open' });
  private status = document.createElement('div');
  private select = document.createElement('select');
  private regenerate = document.createElement('button');
  private cancelButton = document.createElement('button');
  private preview = document.createElement('textarea');
  private insert = document.createElement('button');
  private copy = document.createElement('button');
  private generation = 0;
  private revision = 0;
  private jobId?: string;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly dialog: HTMLElement,
    private editor: HTMLElement,
    private post: Post,
  ) {
    this.host.dataset.piXComposer = this.id;
    const style = document.createElement('style');
    style.textContent = STYLE;
    const bar = document.createElement('div');
    bar.className = 'bar';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = '✦ AI Quote';
    this.select.setAttribute('aria-label', 'Draft prompt');
    this.regenerate.textContent = 'Regenerate';
    this.cancelButton.textContent = 'Cancel';
    this.status.className = 'status';
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    const settings = document.createElement('button');
    settings.textContent = 'Settings';
    settings.onclick = () => {
      void rpc({ type: 'settings:open' }).catch((e) => this.message(e));
    };
    this.preview.className = 'preview';
    this.preview.readOnly = true;
    this.preview.setAttribute('aria-label', 'Generated draft');
    this.preview.hidden = true;
    this.insert.textContent = 'Insert draft';
    this.insert.hidden = true;
    this.copy.textContent = 'Copy draft';
    this.copy.hidden = true;
    this.insert.onclick = () => {
      if (
        editorText(this.editor).trim() &&
        !confirm('Replace the current editor text with this AI draft?')
      )
        return;
      this.apply(this.preview.value);
    };
    this.copy.onclick = () => {
      void navigator.clipboard.writeText(this.preview.value).then(
        () => this.message('Draft copied.'),
        () => this.message('Select and copy the draft text below.'),
      );
    };
    this.regenerate.onclick = () => {
      void this.generate();
    };
    this.cancelButton.onclick = () => {
      void this.cancel();
      this.message('Cancelled.');
    };
    bar.append(
      name,
      this.select,
      this.regenerate,
      this.cancelButton,
      settings,
      this.status,
      this.preview,
      this.insert,
      this.copy,
    );
    this.shadow.append(style, bar);
    const container =
      editor.closest<HTMLElement>('[data-testid="tweetTextarea_0RichTextInputContainer"]') ||
      editor;
    container.before(this.host);
    editor.addEventListener('input', this.onInput);
    this.regenerate.disabled = true;
    this.cancelButton.hidden = true;
    void this.initialize();
  }
  private onInput = () => {
    this.revision++;
  };
  private message(text: unknown) {
    this.status.textContent = text instanceof Error ? text.message : String(text);
  }
  private async initialize() {
    try {
      const s = await rpc<PublicSettings>({ type: 'settings:public' });
      if (this.disposed) return;
      for (const p of s.prompts) {
        const o = document.createElement('option');
        o.value = p.id;
        o.textContent = p.name;
        this.select.append(o);
      }
      this.select.value = s.defaultPromptId;
      this.regenerate.disabled = false;
      if (!s.configured) {
        this.message('Choose your model in Settings, then click Regenerate.');
        return;
      }
      await this.generate();
    } catch (e) {
      this.message(e);
    }
  }
  async cancel() {
    this.generation++;
    clearTimeout(this.timer);
    const id = this.jobId;
    this.jobId = undefined;
    this.cancelButton.hidden = true;
    this.regenerate.disabled = false;
    if (id) await rpc({ type: 'job:cancel', id }).catch(() => {});
  }
  private apply(draft: string) {
    try {
      if (!this.editor.isConnected || !insertDraft(this.editor, draft))
        throw new Error(
          'Automatic insertion is unavailable. Copy the draft below into X’s editor.',
        );
      this.preview.hidden = true;
      this.insert.hidden = true;
      this.copy.hidden = true;
      this.message('Draft inserted. Review and edit before posting.');
    } catch (e) {
      this.preview.value = draft;
      this.preview.hidden = false;
      this.insert.hidden = false;
      this.copy.hidden = false;
      this.message(e);
    }
  }
  private async generate() {
    await this.cancel();
    if (this.disposed || !this.dialog.isConnected) return;
    const generation = ++this.generation;
    const revision = this.revision;
    const baseline = editorText(this.editor);
    this.regenerate.disabled = true;
    this.cancelButton.hidden = false;
    this.message('Starting…');
    this.preview.hidden = true;
    this.insert.hidden = true;
    this.copy.hidden = true;
    try {
      const result = await rpc<{ id: string }>({
        type: 'job:start',
        composerId: this.id,
        post: this.post,
        promptId: this.select.value,
      });
      if (this.disposed || generation !== this.generation) {
        await rpc({ type: 'job:cancel', id: result.id });
        return;
      }
      this.jobId = result.id;
      let failures = 0;
      const poll = async () => {
        if (this.disposed || generation !== this.generation) return;
        try {
          const j = await rpc<{ status: string; progress: string; draft?: string; error?: string }>(
            { type: 'job:get', id: result.id },
          );
          if (this.disposed || generation !== this.generation) return;
          failures = 0;
          this.message(j.progress);
          if (j.status === 'running') {
            this.timer = setTimeout(() => {
              void poll();
            }, 800);
            return;
          }
          this.regenerate.disabled = false;
          this.cancelButton.hidden = true;
          this.jobId = undefined;
          if (j.status === 'error') {
            this.message(j.error || 'Generation failed. Open Settings or try Regenerate.');
            return;
          }
          if (j.status === 'done' && j.draft) {
            this.preview.value = j.draft;
            if (
              canAutoInsert({
                generation,
                currentGeneration: this.generation,
                baseline,
                currentText: editorText(this.editor),
                revision,
                currentRevision: this.revision,
                connected: this.dialog.isConnected,
              }) &&
              !baseline.trim()
            )
              this.apply(j.draft);
            else {
              this.preview.hidden = false;
              this.insert.hidden = false;
              this.copy.hidden = false;
              this.message('Draft ready. Your editor text has been preserved.');
            }
          }
        } catch (e) {
          if (this.disposed || generation !== this.generation) return;
          if (e instanceof RpcTransportError && failures++ < 5) {
            this.message('Reconnecting to your saved draft…');
            this.timer = setTimeout(
              () => {
                void poll();
              },
              Math.min(800 * 2 ** failures, 5000),
            );
            return;
          }
          void rpc({ type: 'job:cancel', id: result.id }).catch(() => {});
          this.jobId = undefined;
          this.regenerate.disabled = false;
          this.cancelButton.hidden = true;
          this.message(e);
        }
      };
      await poll();
    } catch (e) {
      if (generation === this.generation) {
        this.regenerate.disabled = false;
        this.cancelButton.hidden = true;
        this.message(e);
      }
    }
  }
  dispose() {
    this.disposed = true;
    this.editor.removeEventListener('input', this.onInput);
    void this.cancel();
    this.host.remove();
  }
}
