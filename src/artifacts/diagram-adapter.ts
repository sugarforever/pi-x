import type { DiagramDocument } from '../geometry/document';
import type { SceneSpec } from '../geometry/types';
import { emptyArtifacts, selectedArtifact, type ArtifactCollection } from './types';
export function fromDiagram(doc?: DiagramDocument): ArtifactCollection {
  if (!doc) return emptyArtifacts();
  return {
    selectedId: 'diagram',
    items: [
      {
        id: 'diagram',
        kind: 'diagram',
        title: doc.versions.at(-1)?.spec.title || 'Diagram',
        cursor: doc.cursor,
        versions: doc.versions.map((v) => ({
          id: v.id,
          title: v.spec.title || 'Diagram',
          data: v.spec,
          createdAt: v.createdAt,
          view: { labels: v.labels },
        })),
      },
    ],
    operations: (doc.operations || doc.versions.map((v) => v.id)).map((id) => ({
      id,
      artifactId: 'diagram',
      versionId: doc.versions.some((v) => v.id === id) ? id : undefined,
      jobId: id.includes(':') ? id.split(':')[0] : undefined,
    })),
  };
}
export function diagramArtifact(collection: ArtifactCollection, id?: string) {
  if (id) return collection.items.find((a) => a.id === id && a.kind === 'diagram');
  const selected = selectedArtifact(collection);
  return selected?.kind === 'diagram'
    ? selected
    : collection.items.find((a) => a.id === 'diagram' && a.kind === 'diagram') ||
        collection.items.find((a) => a.kind === 'diagram');
}
export function toDiagram(
  collection: ArtifactCollection,
  id?: string,
): DiagramDocument | undefined {
  const artifact = diagramArtifact(collection, id);
  if (!artifact) return undefined;
  return {
    cursor: artifact.cursor,
    operations: collection.operations.filter((o) => o.artifactId === artifact.id).map((o) => o.id),
    versions: artifact.versions.map((v) => ({
      id: v.id,
      spec: v.data as SceneSpec,
      createdAt: v.createdAt,
      labels: v.view?.labels || {},
    })),
  };
}
