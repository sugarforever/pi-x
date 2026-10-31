import type { DiagramDocument } from '../geometry/document';
import { currentDiagram } from '../geometry/document';
import { resolveScene } from '../geometry/kernel';
import { drawScene, defaultDiagramView } from './diagram-svg';
import type { PanelCommand } from '../shared/panel';
export type DiagramCommand = Extract<PanelCommand, { action: 'diagram' }>;
export class DiagramViewer {
  private doc?: DiagramDocument;
  private busy = false;
  private signature = '';
  private version = '';
  private view = defaultDiagramView();
  private labels: Record<string, [number, number]> = {};
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private title = document.createElement('strong');
  private versions = document.createElement('select');
  private undo: HTMLButtonElement;
  private note = document.createElement('p');
  private status = document.createElement('p');
  private rotations: HTMLButtonElement[] = [];
  private drag?: {
    pointer: number;
    versionId: string;
    point?: string;
    x: number;
    y: number;
    offset: [number, number];
  };
  constructor(
    private host: HTMLElement,
    private onAction: (command: DiagramCommand) => unknown,
    expand?: () => void,
  ) {
    host.classList.add('diagram-viewer');
    const header = document.createElement('div');
    header.className = 'diagram-heading';
    const controls = document.createElement('div');
    controls.className = 'diagram-controls';
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
    this.versions.setAttribute('aria-label', 'Diagram version');
    this.versions.onchange = () =>
      this.emit({ action: 'diagram', operation: 'select', versionId: this.versions.value });
    this.undo = button('Undo diagram', 'Undo', () => {
      if (!this.doc) return;
      const prior = this.doc.versions[this.doc.cursor - 1];
      this.emit({ action: 'diagram', operation: 'select', versionId: prior?.id });
    });
    header.append(this.title, this.versions, this.undo);
    if (expand) header.append(button('Expand diagram', 'Expand', expand));
    controls.append(
      button('Zoom out', '−', () => {
        this.view.zoom = Math.max(0.4, this.view.zoom / 1.2);
        this.draw();
      }),
      button('Zoom in', '+', () => {
        this.view.zoom = Math.min(4, this.view.zoom * 1.2);
        this.draw();
      }),
      button('Reset diagram view', 'Reset', () => {
        this.view = defaultDiagramView();
        this.draw();
      }),
    );
    for (const [label, icon, yaw, pitch] of [
      ['Rotate left', '↶', -0.2, 0],
      ['Rotate right', '↷', 0.2, 0],
      ['Rotate up', '↑', 0, 0.2],
      ['Rotate down', '↓', 0, -0.2],
    ] as const) {
      const b = button(label, icon, () => {
        this.view.yaw += yaw;
        this.view.pitch += pitch;
        this.draw();
      });
      this.rotations.push(b);
      controls.append(b);
    }
    controls.append(
      button('Download diagram SVG', 'SVG', () => this.download('svg')),
      button('Download diagram PNG', 'PNG', () => this.download('png')),
    );
    this.note.className = 'diagram-note';
    this.status.setAttribute('role', 'status');
    host.replaceChildren(header, this.svg, controls, this.note, this.status);
    this.svg.addEventListener('keydown', (event) => {
      const id = (event.target as Element).closest<SVGElement>('[data-point]')?.dataset.point;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-4, 0],
        ArrowRight: [4, 0],
        ArrowUp: [0, -4],
        ArrowDown: [0, 4],
      };
      if (!id || !delta[event.key] || this.busy) return;
      event.preventDefault();
      const old = this.labels[id] || [12, -12],
        d = delta[event.key];
      const offset: [number, number] = [old[0] + d[0], old[1] + d[1]];
      this.labels[id] = offset;
      this.draw();
      this.emit({
        action: 'diagram',
        operation: 'label',
        versionId: this.version,
        point: id,
        offset,
      });
    });
    this.svg.addEventListener('pointerdown', (event) => {
      const id = (event.target as Element).closest<SVGElement>('[data-point]')?.dataset.point;
      if ((id && this.busy) || event.button !== 0) return;
      if (!id && this.host.dataset.dimension !== '3') return;
      this.drag = {
        pointer: event.pointerId,
        versionId: this.version,
        point: id,
        x: event.clientX,
        y: event.clientY,
        offset: id ? this.labels[id] || [12, -12] : [this.view.yaw, this.view.pitch],
      };
      this.svg.setPointerCapture(event.pointerId);
      event.preventDefault();
    });
    this.svg.addEventListener('pointermove', (event) => {
      const d = this.drag;
      if (!d || event.pointerId !== d.pointer) return;
      if (d.point) {
        const matrix = this.svg.getScreenCTM()?.inverse();
        const from = new DOMPoint(d.x, d.y).matrixTransform(matrix),
          to = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix);
        this.labels[d.point] = [
          Math.max(-300, Math.min(300, d.offset[0] + to.x - from.x)),
          Math.max(-300, Math.min(300, d.offset[1] + to.y - from.y)),
        ];
      } else {
        this.view.yaw = d.offset[0] + (event.clientX - d.x) * 0.01;
        this.view.pitch = d.offset[1] + (event.clientY - d.y) * 0.01;
      }
      this.draw();
    });
    const finish = (event: PointerEvent) => {
      const d = this.drag;
      if (!d || event.pointerId !== d.pointer) return;
      this.drag = undefined;
      if (d.versionId !== this.version) return;
      if (d.point)
        this.emit({
          action: 'diagram',
          operation: 'label',
          versionId: this.version,
          point: d.point,
          offset: this.labels[d.point] || d.offset,
        });
    };
    this.svg.addEventListener('pointerup', finish);
    this.svg.addEventListener('pointercancel', () => {
      this.drag = undefined;
      this.labels = { ...currentDiagram(this.doc)?.labels };
      this.draw();
    });
  }
  private emit(command: DiagramCommand) {
    Promise.resolve(this.onAction(command)).catch((e) => {
      this.status.textContent = e instanceof Error ? e.message : 'Could not update diagram.';
    });
  }
  update(doc: DiagramDocument | undefined, busy: boolean) {
    const signature = JSON.stringify([doc, busy]);
    if (signature === this.signature) return;
    this.signature = signature;
    this.doc = doc;
    this.busy = busy;
    this.svg.dataset.busy = String(busy);
    if (busy) this.drag = undefined;
    this.host.hidden = !doc?.versions.length;
    const current = currentDiagram(doc);
    if (this.version !== (current?.id || '')) {
      this.drag = undefined;
      this.version = current?.id || '';
      this.view = defaultDiagramView();
    }
    if (!this.drag) this.labels = { ...current?.labels };
    this.versions.replaceChildren(
      new Option('No drawing', ''),
      ...(doc?.versions.map(
        (v, i) => new Option(`v${i + 1} · ${v.spec.title || 'Diagram'}`, v.id),
      ) || []),
    );
    this.versions.value = current?.id || '';
    this.versions.disabled = busy;
    this.undo.disabled = busy || !current;
    this.title.textContent = current?.spec.title || 'Diagram';
    this.svg.toggleAttribute('hidden', !current);
    this.host.dataset.dimension = String(current?.spec.dimension || '');
    this.rotations.forEach((b) => (b.hidden = current?.spec.dimension !== 3));
    this.note.textContent = current
      ? [
          ...(current.spec.assumptions || []),
          current.spec.dimension === 3 ? '3D wireframe · drag the canvas to rotate.' : '',
          busy
            ? 'Finish generating before moving point-name labels.'
            : 'Drag point-name labels (A, B, …), or focus one and use arrow keys. Geometry and values stay fixed.',
        ].join(' ')
      : 'No diagram selected. Choose a version to restore it.';
    this.draw();
  }
  private draw() {
    const v = currentDiagram(this.doc);
    if (v) {
      const focus = (this.svg.ownerDocument.activeElement as SVGElement | null)?.dataset?.point;
      drawScene(this.svg, resolveScene(v.spec), this.view, this.labels);
      if (focus)
        Array.from(this.svg.querySelectorAll<SVGElement>('[data-point]'))
          .find((el) => el.dataset.point === focus)
          ?.focus();
    }
  }
  svgText() {
    const copy = this.svg.cloneNode(true) as SVGSVGElement;
    copy.setAttribute('width', '1600');
    copy.setAttribute('height', '1000');
    copy.querySelectorAll('[data-label-hit]').forEach((n) => n.remove());
    copy.querySelectorAll('[tabindex]').forEach((n) => {
      n.removeAttribute('tabindex');
      n.removeAttribute('role');
    });
    return new XMLSerializer().serializeToString(copy);
  }
  private download(kind: 'svg' | 'png') {
    if (!currentDiagram(this.doc)) return;
    const save = (blob: Blob, extension: string) => {
      const url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `pi-x-diagram.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const svg = new Blob([this.svgText()], { type: 'image/svg+xml' });
    if (kind === 'svg') {
      save(svg, 'svg');
      return;
    }
    const url = URL.createObjectURL(svg),
      image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 1600;
        canvas.height = 1000;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable.');
        context.drawImage(image, 0, 0, 1600, 1000);
        canvas.toBlob((blob) => {
          if (blob) save(blob, 'png');
          else this.status.textContent = 'PNG export failed.';
        }, 'image/png');
      } catch {
        this.status.textContent = 'PNG export failed. Use SVG instead.';
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      this.status.textContent = 'Image export failed.';
    };
    image.src = url;
  }
}
