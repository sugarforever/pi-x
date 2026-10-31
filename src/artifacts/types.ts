import type { SceneSpec } from '../geometry/types';
export type ArtifactKind = 'diagram' | 'document' | 'code';
export type ArtifactData = SceneSpec | { markdown: string } | { code: string; language: string };
export interface ArtifactVersion {
  id: string;
  title: string;
  data: ArtifactData;
  createdAt: number;
  view?: { labels: Record<string, [number, number]> };
}
export interface Artifact {
  id: string;
  kind: ArtifactKind;
  title: string;
  versions: ArtifactVersion[];
  cursor: number;
}
export interface ArtifactReceipt {
  id: string;
  artifactId: string;
  versionId?: string;
  jobId?: string;
}
export interface ArtifactCollection {
  items: Artifact[];
  selectedId?: string;
  operations: ArtifactReceipt[];
}
export interface ArtifactInput {
  kind: ArtifactKind;
  title: string;
  data: unknown;
}
export const emptyArtifacts = (): ArtifactCollection => ({ items: [], operations: [] });
export const currentArtifactVersion = (artifact?: Artifact) => artifact?.versions[artifact.cursor];
export const selectedArtifact = (collection?: ArtifactCollection) =>
  collection?.items.find((a) => a.id === collection.selectedId);
