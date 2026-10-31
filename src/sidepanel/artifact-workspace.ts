import { artifactTypes } from '../artifacts/registry';
import {
  currentArtifactVersion,
  selectedArtifact,
  type ArtifactCollection,
  type ArtifactKind,
} from '../artifacts/types';
import { artifactRenderers, type ArtifactAction } from './artifact-renderers';
export class ArtifactWorkspace {
  private state?: ArtifactCollection;
  private busy = false;
  private signature = '';
  private identity = '';
  private sourceMode = false;
  private kind?: ArtifactKind;
  private renderer?: ReturnType<(typeof artifactRenderers)['diagram']>;
  private title = document.createElement('strong');
  private picker = document.createElement('select');
  private versions = document.createElement('select');
  private preview = document.createElement('div');
  private source = document.createElement('pre');
  private metadata = document.createElement('span');
  private status = document.createElement('p');
  private undo: HTMLButtonElement;
  private expand?: HTMLButtonElement;
  private remove: HTMLButtonElement;
  private previewButton: HTMLButtonElement;
  private sourceButton: HTMLButtonElement;
  constructor(
    private host: HTMLElement,
    private onAction: ArtifactAction,
    onExpand?: () => void,
  ) {
    host.classList.add('artifact-workspace');
    const heading = document.createElement('div');
    heading.className = 'artifact-heading';
    const controls = document.createElement('div');
    controls.className = 'artifact-toolbar';
    const button = (label: string, text: string, action: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.textContent = text;
      b.className = 'quiet';
      b.onclick = action;
      return b;
    };
    this.picker.setAttribute('aria-label', 'Artifact');
    this.picker.onchange = () =>
      this.emit({ action: 'artifact', operation: 'select', artifactId: this.picker.value });
    this.versions.onchange = () => {
      const a = selectedArtifact(this.state);
      if (a)
        this.emit({
          action: 'artifact',
          operation: 'version',
          artifactId: a.id,
          versionId: this.versions.value || null,
        });
    };
    this.undo = button('Undo artifact', 'Undo', () => {
      const a = selectedArtifact(this.state);
      if (a)
        this.emit({
          action: 'artifact',
          operation: 'version',
          artifactId: a.id,
          versionId: a.versions[a.cursor - 1]?.id ?? null,
        });
    });
    this.remove = button('Remove artifact', 'Remove', () => {
      const a = selectedArtifact(this.state);
      if (
        a &&
        (this.host.ownerDocument.defaultView ?? window).confirm(
          `Remove “${a.title}” and its artifact history?`,
        )
      )
        this.emit({ action: 'artifact', operation: 'remove', artifactId: a.id });
    });
    heading.append(this.title, this.picker, this.versions, this.undo);
    if (onExpand) {
      this.expand = button('Expand artifact', 'Expand', onExpand);
      heading.append(this.expand);
    }
    this.previewButton = button('Artifact preview', 'Preview', () => {
      this.sourceMode = false;
      this.toggleView();
    });
    this.sourceButton = button('Artifact source', 'Source', () => {
      this.sourceMode = true;
      this.toggleView();
    });
    controls.append(
      this.metadata,
      this.previewButton,
      this.sourceButton,
      button('Copy artifact', 'Copy', () => this.copy()),
      button('Download artifact', 'Download', () => this.download()),
      this.remove,
    );
    this.preview.className = 'artifact-preview';
    this.source.className = 'artifact-source';
    this.status.setAttribute('role', 'status');
    this.status.className = 'artifact-status';
    host.replaceChildren(heading, controls, this.preview, this.source, this.status);
  }
  private emit(command: Parameters<ArtifactAction>[0]) {
    Promise.resolve(this.onAction(command)).catch((e) => {
      this.status.textContent = e instanceof Error ? e.message : 'Artifact operation failed.';
    });
  }
  update(state: ArtifactCollection | undefined, busy: boolean) {
    this.state = state;
    this.busy = busy;
    this.host.hidden = !state?.items.length;
    const artifact = selectedArtifact(state),
      version = currentArtifactVersion(artifact);
    const next = JSON.stringify([
      state?.selectedId,
      state?.items.map((a) => [a.id, a.kind, a.title, a.cursor, a.versions.map((v) => v.id)]),
      version,
      busy,
    ]);
    if (next === this.signature) return;
    this.signature = next;
    if (artifact?.id !== this.identity) {
      this.identity = artifact?.id || '';
      this.sourceMode = false;
      this.status.textContent = '';
    }
    this.picker.replaceChildren(
      ...(state?.items.map(
        (a) => new Option(`${artifactTypes[a.kind].label} · ${a.title}`, a.id),
      ) || []),
    );
    this.picker.value = artifact?.id || '';
    this.picker.disabled = busy;
    this.versions.replaceChildren(
      new Option('No version', ''),
      ...(artifact?.versions.map((v, i) => new Option(`v${i + 1} · ${v.title}`, v.id)) || []),
    );
    this.versions.value = version?.id || '';
    this.versions.disabled = busy;
    const drawing = artifact?.kind === 'diagram';
    this.versions.setAttribute('aria-label', drawing ? 'Diagram version' : 'Artifact version');
    this.undo.setAttribute('aria-label', drawing ? 'Undo diagram' : 'Undo artifact');
    this.undo.disabled = busy || !version;
    if (this.expand)
      this.expand.setAttribute('aria-label', drawing ? 'Expand diagram' : 'Expand artifact');
    this.remove.disabled = busy;
    this.title.textContent = version?.title || artifact?.title || 'Artifacts';
    this.metadata.textContent = artifact
      ? `${artifactTypes[artifact.kind].label}${version ? ` · v${artifact.cursor + 1}/${artifact.versions.length}` : ''}`
      : '';
    if (artifact && version) {
      if (this.kind !== artifact.kind) {
        this.preview.replaceChildren();
        this.preview.className = 'artifact-preview';
        this.renderer = artifactRenderers[artifact.kind](this.preview, this.onAction);
        this.kind = artifact.kind;
      }
      this.renderer?.update(artifact, version, busy);
      this.source.textContent = artifactTypes[artifact.kind].source(version.data);
    } else {
      this.preview.replaceChildren();
      this.preview.textContent = 'Choose a retained version to restore this artifact.';
      this.kind = undefined;
      this.renderer = undefined;
      this.source.textContent = '';
    }
    this.toggleView();
  }
  private toggleView() {
    this.preview.hidden = this.sourceMode;
    this.source.hidden = !this.sourceMode;
    this.previewButton.setAttribute('aria-pressed', String(!this.sourceMode));
    this.sourceButton.setAttribute('aria-pressed', String(this.sourceMode));
  }
  private copy() {
    const a = selectedArtifact(this.state),
      v = currentArtifactVersion(a);
    if (a && v)
      void (this.host.ownerDocument.defaultView?.navigator ?? navigator).clipboard
        .writeText(artifactTypes[a.kind].source(v.data))
        .then(
          () => {
            this.status.textContent = 'Copied.';
          },
          () => {
            this.status.textContent = 'Copy is unavailable. Use Source to select the text.';
          },
        );
  }
  private download() {
    const a = selectedArtifact(this.state),
      v = currentArtifactVersion(a);
    if (!a || !v) return;
    const type = artifactTypes[a.kind],
      extensions: Record<string, string> = {
        javascript: 'js',
        typescript: 'ts',
        python: 'py',
        json: 'json',
        html: 'html',
        css: 'css',
        rust: 'rs',
        bash: 'sh',
        shell: 'sh',
        cpp: 'cpp',
      };
    const extension =
      a.kind === 'code'
        ? extensions[(v.data as { language: string }).language] || 'txt'
        : type.extension;
    const url = URL.createObjectURL(new Blob([type.source(v.data)], { type: type.mime })),
      link = document.createElement('a');
    link.href = url;
    link.download = `pi-x-artifact.${extension}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
