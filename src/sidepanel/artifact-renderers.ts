import { renderMarkdown } from './markdown';
import type { Artifact, ArtifactKind, ArtifactVersion } from '../artifacts/types';
import { toDiagram } from '../artifacts/diagram-adapter';
import { DiagramViewer } from './diagram-view';
import type { PanelCommand } from '../shared/panel';
interface Renderer {
  update(artifact: Artifact, version: ArtifactVersion, busy: boolean): void;
}
export type ArtifactAction = (command: PanelCommand) => unknown;
export const artifactRenderers: Record<
  ArtifactKind,
  (host: HTMLElement, onAction: ArtifactAction) => Renderer
> = {
  diagram: (host, onAction) => {
    const child = document.createElement('section');
    host.append(child);
    let id = 'diagram';
    const viewer = new DiagramViewer(child, (command) =>
      command.operation === 'label'
        ? onAction({
            action: 'artifact',
            operation: 'label',
            artifactId: id,
            versionId: command.versionId,
            point: command.point,
            offset: command.offset,
          })
        : onAction({
            action: 'artifact',
            operation: 'version',
            artifactId: id,
            versionId: command.versionId ?? null,
          }),
    );
    return {
      update: (artifact, _version, busy) => {
        id = artifact.id;
        viewer.update(
          toDiagram({ items: [artifact], selectedId: artifact.id, operations: [] }, artifact.id),
          busy,
        );
      },
    };
  },
  document: (host) => {
    host.classList.add('artifact-document');
    return {
      update: (_artifact, version) =>
        renderMarkdown(host, (version.data as { markdown: string }).markdown),
    };
  },
  code: (host) => {
    host.classList.add('artifact-code');
    return {
      update: (_artifact, version) => {
        const pre = document.createElement('pre'),
          code = document.createElement('code');
        const data = version.data as { code: string; language: string };
        code.textContent = data.code;
        code.dataset.language = data.language;
        pre.append(code);
        host.replaceChildren(pre);
      },
    };
  },
};
