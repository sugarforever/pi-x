import type { Post, PublicSettings, Refinement } from '../shared/types';
import type { PanelCommand, PanelResult, PanelState, PanelTurn } from '../shared/panel';
import { rpc, RpcTransportError } from '../shared/rpc';
import { editorText, insertDraft } from './dom';
import { ORIGINAL_PROMPT, RETELL_PROMPT, REPLY_PROMPT } from '../shared/settings';

// This controller owns the X editor. All conversational UI lives in an extension page,
// outside X's modal focus trap. Only the launcher is added to the native dialog.
export class Composer {
  readonly id = crypto.randomUUID();
  private host = document.createElement('div');
  private state: PanelState;
  private proposals = new Map<string, { draft: string; baseline: string }>();
  private undoState?: { before: string; after: string; turnId: string };
  private generation = 0;
  private jobId?: string;
  private completedJobId?: string;
  private initialBrief?: string;
  private disposed = false;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    readonly dialog: HTMLElement,
    private editor: HTMLElement,
    private post?: Post,
    private onActivate?: () => void,
    mode?: 'quote' | 'compose' | 'reply',
    private restoredDraft?: string,
  ) {
    this.state = {
      composerId: this.id,
      mode: mode || (post ? 'quote' : 'compose'),
      post,
      currentDraft: '',
      prompts: [],
      promptId: '',
      busy: false,
      ready: false,
      status: 'Connecting…',
      turns: [],
      canUndo: false,
    };
    this.host.dataset.piXComposer = this.id;
    editor.dataset.piXBound = this.id;
    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent =
      ':host{display:flex;justify-content:flex-end;width:100%;margin:0 0 6px}:host([data-pi-x-inline]){width:auto;margin:0 0 0 auto;flex-shrink:0}button{font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d9bf0;background:transparent;border:1px solid #1d9bf044;border-radius:999px;padding:5px 10px;cursor:pointer}button:hover{background:#1d9bf014}button:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}';
    const launch = document.createElement('button');
    launch.type = 'button';
    launch.textContent = 'Open pi-x';
    launch.setAttribute('aria-label', 'Open pi-x');
    launch.onclick = () => {
      this.onActivate?.();
      void rpc({ type: 'panel:open' }).catch((e) => {
        launch.textContent = 'Couldn’t open · Try again';
        this.message(e);
      });
    };
    shadow.append(style, launch);
    this.ensureLauncher();
    void this.initialize();
  }
  ensureLauncher() {
    if (!this.connected) return;
    const audience = this.dialog.querySelector<HTMLElement>(
      '[data-testid="tweetAudienceDropdown"],button[aria-label="Choose audience"]',
    );
    const row = audience?.parentElement;
    if (row && !row.contains(this.editor)) {
      row.dataset.piXAudienceRow = 'true';
      this.host.dataset.piXInline = 'true';
      if (!document.getElementById('pi-x-audience-layout')) {
        const layout = document.createElement('style');
        layout.id = 'pi-x-audience-layout';
        layout.textContent =
          '[data-pi-x-audience-row]:has(> [data-pi-x-composer]){display:flex!important;flex-direction:row!important;align-items:center!important;justify-content:space-between!important;gap:8px;width:100%;min-width:0}';
        document.head.append(layout);
      }
      if (this.host.parentElement !== row) row.append(this.host);
    } else if (!this.host.isConnected || this.host.dataset.piXInline) {
      delete this.host.dataset.piXInline;
      const container =
        this.editor.closest('[data-testid="tweetTextarea_0RichTextInputContainer"]') || this.editor;
      container.before(this.host);
    }
  }
  get connected() {
    return !this.disposed && this.dialog.isConnected && this.editor.isConnected;
  }
  snapshot(): PanelState {
    return structuredClone({
      ...this.state,
      currentDraft: editorText(this.editor),
      canUndo: !!this.undoState,
    });
  }
  private message(value: unknown) {
    this.state.status = value instanceof Error ? value.message : String(value);
  }
  private turn(role: PanelTurn['role'], text: string, status?: PanelTurn['status']) {
    const t = {
      id: crypto.randomUUID(),
      role,
      text,
      ...(this.jobId ? { jobId: this.jobId } : {}),
      ...(status ? { status } : {}),
    };
    this.state.turns.push(t);
    return t;
  }
  private propose(draft: string, baseline: string) {
    for (const t of this.state.turns) if (t.status === 'proposal') t.status = 'dismissed';
    this.proposals.clear();
    const turn = this.turn('agent', draft, 'proposal');
    this.proposals.set(turn.id, { draft, baseline });
  }
  private async initialize() {
    try {
      const settings = await rpc<PublicSettings>({ type: 'settings:public' });
      if (this.disposed) return;
      this.state.modelId = settings.defaultModelId || 'default';
      this.state.prompts = this.post
        ? settings.prompts
        : [
            { id: ORIGINAL_PROMPT.id, name: ORIGINAL_PROMPT.name },
            ...settings.prompts.filter((p) => p.id !== RETELL_PROMPT.id),
          ];
      if (this.state.mode === 'reply')
        this.state.prompts.unshift({ id: REPLY_PROMPT.id, name: REPLY_PROMPT.name });
      this.state.promptId =
        this.state.mode === 'reply'
          ? REPLY_PROMPT.id
          : this.post
            ? settings.defaultPromptId
            : ORIGINAL_PROMPT.id;
      if (!settings.configured) {
        this.message('Connect a model in Settings to start.');
        return;
      }
      if (this.post && settings.behavior?.autoDraft !== false) await this.generate();
      else {
        this.state.ready = true;
        if (this.restoredDraft) this.propose(this.restoredDraft, editorText(this.editor));
        this.message('What would you like to say? Start with an idea, a link, or a few notes.');
      }
    } catch (e) {
      this.message(e);
    }
  }
  async command(command: PanelCommand): Promise<PanelResult> {
    if (!this.connected)
      throw new Error('This quote dialog has closed. Open Pi Quote on a post to continue.');
    if (command.action === 'model') {
      if (this.state.busy) throw new Error('Stop the current request before changing models.');
      const settings = await rpc<PublicSettings>({ type: 'settings:public' });
      if (!settings.models?.some((m) => m.id === command.modelId && m.model))
        throw new Error('Choose a configured model.');
      this.state.modelId = command.modelId;
      return {};
    }
    if (command.action === 'cancel') {
      await this.cancel();
      this.message('Stopped. Your draft is unchanged.');
      return {};
    }
    if (command.action === 'refine') {
      if (this.state.busy) throw new Error('Wait for the current request, or stop it first.');
      if (
        typeof command.instruction !== 'string' ||
        !command.instruction.trim() ||
        command.instruction.length > 4000
      )
        throw new Error('Enter a request up to 4,000 characters.');
      const instruction = command.instruction.trim();
      if (!this.completedJobId) {
        // Manual drafting starts with the selected source when auto-draft is off.
        if (command.promptId) {
          if (!this.state.prompts.some((p) => p.id === command.promptId))
            throw new Error('Choose an available writing prompt.');
          this.state.promptId = command.promptId;
        }
        this.initialBrief = instruction;
        void this.generate(undefined, instruction);
        return {};
      }
      const current = editorText(this.editor);
      const latest = [...this.proposals.values()].at(-1);
      // Until applied, continue refining the proposal if the X editor hasn't changed.
      const workingDraft = latest && current === latest.baseline ? latest.draft : current;
      this.turn('user', instruction);
      void this.generate({ instruction, currentDraft: workingDraft });
      return {};
    }
    if (command.action === 'regenerate') {
      if (this.state.busy) throw new Error('Stop the current request first.');
      if (!this.state.prompts.some((p) => p.id === command.promptId))
        throw new Error('Choose an available prompt.');
      this.state.promptId = command.promptId;
      if (!this.post && !this.initialBrief) {
        this.message('Describe your idea below to create the first draft.');
        return {};
      }
      void this.generate(undefined, this.initialBrief);
      return {};
    }
    if (command.action === 'dismiss') {
      const t = this.state.turns.find((t) => t.id === command.turnId);
      if (t?.status === 'proposal') {
        t.status = 'dismissed';
        this.proposals.delete(t.id);
      }
      return {};
    }
    if (command.action === 'apply') {
      if (this.state.busy) throw new Error('Wait for the revision to finish first.');
      const turn = this.state.turns.find((t) => t.id === command.turnId);
      const reusable = turn?.status === 'applied' || turn?.status === 'reverted';
      const proposal =
        this.proposals.get(command.turnId) ??
        (reusable && turn?.role === 'agent' ? { draft: turn.text, baseline: '' } : undefined);
      if (!proposal) throw new Error('This revision is no longer available.');
      const current = editorText(this.editor);
      if (current === proposal.draft) {
        turn!.status = 'applied';
        this.proposals.delete(command.turnId);
        return {};
      }
      if (
        current !== proposal.baseline &&
        !(reusable && !current.trim()) &&
        command.expectedCurrent !== current
      )
        return { conflict: true, currentDraft: current };
      this.write(proposal.draft);
      this.undoState = { before: current, after: proposal.draft, turnId: command.turnId };
      this.state.turns.find((t) => t.id === command.turnId)!.status = 'applied';
      this.proposals.delete(command.turnId);
      this.message('Applied to X · Review your draft before posting.');
      return {};
    }
    if (command.action === 'undo') {
      const undo = this.undoState;
      if (!undo) throw new Error('There is no applied revision to undo.');
      const current = editorText(this.editor);
      if (current !== undo.after && command.expectedCurrent !== current)
        return { conflict: true, currentDraft: current };
      this.write(undo.before);
      const turn = this.state.turns.find((t) => t.id === undo.turnId);
      if (turn) turn.status = 'reverted';
      this.undoState = undefined;
      this.message('Previous draft restored.');
      return {};
    }
    throw new Error('Unknown assistant action.');
  }
  private write(text: string) {
    if (!this.editor.isConnected || !insertDraft(this.editor, text))
      throw new Error(
        'X could not accept the text. Copy the revision from the assistant and paste it into your draft.',
      );
  }
  async cancel() {
    this.generation++;
    clearTimeout(this.timer);
    const id = this.jobId;
    this.jobId = undefined;
    this.state.busy = false;
    if (id) await rpc({ type: 'job:cancel', id }).catch(() => {});
  }
  private async generate(refinement?: Refinement, brief?: string) {
    // Set the busy flag before yielding so two rapid sends cannot start duplicate work.
    this.state.busy = true;
    const generation = ++this.generation;
    if (!refinement) {
      this.completedJobId = undefined;
      this.state.ready = !this.post;
      this.state.turns = [];
      this.state.jobIds = [];
      if (brief) this.turn('user', brief);
      this.proposals.clear();
      this.undoState = undefined;
    }
    const baseline = editorText(this.editor);
    this.message('Writing a revision…');
    try {
      const result = await rpc<{ id: string }>(
        refinement
          ? {
              type: 'job:refine',
              composerId: this.id,
              previousJobId: this.completedJobId!,
              refinement,
              modelId: this.state.modelId,
            }
          : {
              type: 'job:start',
              composerId: this.id,
              post: this.post,
              mode: this.state.mode,
              modelId: this.state.modelId,
              initialDraft: baseline || this.restoredDraft,
              brief,
              promptId: this.state.promptId,
            },
      );
      if (this.disposed || generation !== this.generation) {
        await rpc({ type: 'job:cancel', id: result.id });
        return;
      }
      this.jobId = result.id;
      const requestTurn = this.state.turns.at(-1);
      if (requestTurn?.role === 'user' && !requestTurn.jobId) requestTurn.jobId = result.id;
      this.state.jobIds = [...(this.state.jobIds || []), result.id].slice(-64);
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
            this.timer = setTimeout(() => void poll(), 800);
            return;
          }
          this.state.busy = false;
          if (j.status === 'done' && j.draft) {
            this.completedJobId = result.id;
            this.state.ready = true;
            this.propose(j.draft, baseline);
            this.message('Revision ready · Apply it when you’re happy.');
          } else {
            const error = j.error || 'Request stopped. Try again.';
            this.turn('agent', error, 'error');
            this.message(error);
          }
          this.jobId = undefined;
        } catch (e) {
          if (this.disposed || generation !== this.generation) return;
          if (e instanceof RpcTransportError && failures++ < 5) {
            this.message('Reconnecting to your saved conversation…');
            this.timer = setTimeout(() => void poll(), Math.min(800 * 2 ** failures, 5000));
            return;
          }
          void rpc({ type: 'job:cancel', id: result.id }).catch(() => {});
          this.state.busy = false;
          this.message(e);
          this.turn('agent', this.state.status, 'error');
          this.jobId = undefined;
        }
      };
      await poll();
    } catch (e) {
      if (!this.disposed && generation === this.generation) {
        this.state.busy = false;
        this.message(e);
        this.turn('agent', this.state.status, 'error');
        this.jobId = undefined;
      }
    }
  }
  dispose() {
    this.disposed = true;
    void this.cancel();
    this.host.remove();
    if (this.editor.dataset.piXBound === this.id) delete this.editor.dataset.piXBound;
  }
}
