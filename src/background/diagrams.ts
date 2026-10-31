import { currentArtifactVersion } from '../artifacts/types';
import { fromDiagram, toDiagram, diagramArtifact } from '../artifacts/diagram-adapter';
import type { DiagramDocument } from '../geometry/document';
import {
  ArtifactStore,
  createArtifact,
  reviseArtifact,
  selectArtifact,
  labelArtifact,
} from './artifacts';
import type { SceneSpec } from '../geometry/types';

// Compatibility adapter: drawing uses the same identity, revision and receipt engine as all artifacts.
export function commitDiagram(
  previous: DiagramDocument | undefined,
  input: unknown,
  operationId: string,
): DiagramDocument {
  const state = fromDiagram(previous),
    artifact = diagramArtifact(state);
  const title = (input as SceneSpec)?.title || 'Diagram';
  const next = artifact
    ? reviseArtifact(
        state,
        artifact.id,
        currentArtifactVersion(artifact)?.id ?? null,
        input,
        operationId,
        title,
      )
    : createArtifact(state, { kind: 'diagram', title, data: input }, operationId, 'diagram');
  return toDiagram(next)!;
}
export function selectDiagram(doc: DiagramDocument, cursor: number): DiagramDocument {
  if (!Number.isInteger(cursor) || cursor < -1 || cursor >= doc.versions.length)
    throw new Error('Invalid diagram version.');
  return toDiagram(
    selectArtifact(fromDiagram(doc), 'diagram', cursor < 0 ? null : doc.versions[cursor].id),
  )!;
}
export function moveLabel(doc: DiagramDocument, point: string, offset: number[]): DiagramDocument {
  const state = fromDiagram(doc),
    version = currentArtifactVersion(state.items[0]);
  if (!version) throw new Error('No diagram is selected.');
  return toDiagram(labelArtifact(state, 'diagram', version.id, point, offset))!;
}
export class DiagramStore {
  constructor(private artifacts = new ArtifactStore()) {}
  async get(chat: string, id?: string) {
    return toDiagram(await this.artifacts.get(chat), id);
  }
  async draw(
    chat: string,
    spec: unknown,
    operation: string,
    id?: string,
    base?: string | null,
    jobId?: string,
  ) {
    return toDiagram(await this.artifacts.draw(chat, spec, operation, id, base, jobId), id)!;
  }
  async select(chat: string, cursor: number) {
    const state = await this.artifacts.get(chat),
      artifact = diagramArtifact(state);
    if (!artifact || !Number.isInteger(cursor) || cursor < -1 || cursor >= artifact.versions.length)
      throw new Error('Invalid diagram version.');
    return toDiagram(
      await this.artifacts.select(
        chat,
        artifact.id,
        cursor < 0 ? null : artifact.versions[cursor].id,
      ),
      artifact.id,
    )!;
  }
  async label(chat: string, point: string, offset: number[]) {
    const state = await this.artifacts.get(chat),
      artifact = diagramArtifact(state),
      version = currentArtifactVersion(artifact);
    if (!artifact || !version) throw new Error('No diagram is selected.');
    return toDiagram(
      await this.artifacts.label(chat, artifact.id, version.id, point, offset),
      artifact.id,
    )!;
  }
  delete(chat: string) {
    return this.artifacts.deleteConversation(chat);
  }
}
