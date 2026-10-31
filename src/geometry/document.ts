import type { SceneSpec } from './types';
export interface DiagramVersion {
  id: string;
  spec: SceneSpec;
  createdAt: number;
  labels: Record<string, [number, number]>;
}
export interface DiagramDocument {
  operations?: string[];
  versions: DiagramVersion[];
  cursor: number;
}
export function currentDiagram(doc?: DiagramDocument) {
  return doc?.versions[doc.cursor];
}
