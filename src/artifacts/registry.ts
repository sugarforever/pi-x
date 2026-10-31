import { resolveScene } from '../geometry/kernel';
import type { ArtifactData, ArtifactKind } from './types';
interface ArtifactType {
  label: string;
  extension: string;
  mime: string;
  validate(data: unknown): ArtifactData;
  source(data: ArtifactData): string;
}
function stringField(data: unknown, field: string) {
  if (
    !data ||
    typeof data !== 'object' ||
    typeof (data as Record<string, unknown>)[field] !== 'string'
  )
    throw new Error(`Artifact requires ${field} text.`);
  return (data as Record<string, string>)[field];
}
export const artifactTypes: Record<ArtifactKind, ArtifactType> = {
  diagram: {
    label: 'Drawing',
    extension: 'json',
    mime: 'application/json',
    validate: (data) => resolveScene(data).spec,
    source: (data) => JSON.stringify(data, null, 2),
  },
  document: {
    label: 'Document',
    extension: 'md',
    mime: 'text/markdown',
    validate: (data) => ({ markdown: stringField(data, 'markdown') }),
    source: (data) => (data as { markdown: string }).markdown,
  },
  code: {
    label: 'Code',
    extension: 'txt',
    mime: 'text/plain',
    validate: (data) => {
      const code = stringField(data, 'code'),
        language = stringField(data, 'language');
      if (!/^[a-zA-Z0-9_+#.-]{1,40}$/.test(language))
        throw new Error('Use a plain code language identifier.');
      return { code, language };
    },
    source: (data) => (data as { code: string }).code,
  },
};
export function validateArtifactData(kind: ArtifactKind, data: unknown): ArtifactData {
  if (!Object.hasOwn(artifactTypes, kind)) throw new Error('Unsupported artifact type.');
  const serialized = JSON.stringify(data);
  if (!serialized || serialized.length > 64000)
    throw new Error('Artifact content exceeds 64,000 characters or is missing.');
  return artifactTypes[kind].validate(data);
}
