import type { Artifact, ArtifactVersion } from '../artifacts/types';
import type { SceneSpec } from '../geometry/types';
import { resolveScene } from '../geometry/kernel';
import { defaultDiagramView, drawScene } from './diagram-svg';

/** A receipt-bound snapshot: never consult the artifact's current cursor. */
export function inlineDrawing(
  artifact: Artifact,
  version: ArtifactVersion | undefined,
  busy: boolean,
  open: () => Promise<unknown>,
): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'inline-drawing';
  figure.dataset.artifactId = artifact.id;
  figure.dataset.versionId = version?.id || '';
  const caption = document.createElement('figcaption');
  caption.textContent = `Drawing · ${version?.title || artifact.title}`;
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet';
  button.textContent = 'Open preview ↗';
  button.setAttribute(
    'aria-label',
    `Open drawing ${version?.title || artifact.title} in preview window`,
  );
  button.disabled = busy || !version;
  button.onclick = () => {
    button.disabled = true;
    void open()
      .catch((e) => {
        status.textContent = e instanceof Error ? e.message : 'Could not open drawing preview.';
      })
      .finally(() => {
        button.disabled = busy || !version;
      });
  };
  figure.append(caption);
  if (version) {
    try {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      drawScene(
        svg,
        resolveScene(version.data as SceneSpec),
        defaultDiagramView(),
        version.view?.labels || {},
        false,
      );
      figure.append(svg);
    } catch {
      status.textContent =
        'Drawing preview is unavailable. Open the preview window to inspect this version.';
    }
  } else {
    status.textContent =
      'Drawing version is no longer available. It may have been removed from retained history.';
  }
  figure.append(button, status);
  return figure;
}
