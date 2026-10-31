import { artifactTypes, validateArtifactData } from '../artifacts/registry';
import {
  currentArtifactVersion,
  emptyArtifacts,
  type ArtifactCollection,
  type ArtifactInput,
} from '../artifacts/types';
import { fromDiagram, diagramArtifact } from '../artifacts/diagram-adapter';
import type { DiagramDocument } from '../geometry/document';
import { resolveScene } from '../geometry/kernel';
import type { SceneSpec } from '../geometry/types';
function title(value: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 200)
    throw new Error('Artifact title must contain 1–200 characters.');
  return value.trim();
}
function receipt(state: ArtifactCollection, id: string) {
  return state.operations.some((o) => o.id === id);
}
function bounded(state: ArtifactCollection) {
  if (state.operations.length > 1000)
    throw new Error('This chat reached its 1,000 artifact-operation limit. Start a new chat.');
  if (state.items.length > 12)
    throw new Error('A chat can hold up to 12 artifacts. Remove an artifact first.');
  if (JSON.stringify(state).length > 2_000_000)
    throw new Error(
      'Artifact storage for this chat is full. Remove an artifact or start a new chat.',
    );
  return state;
}
export function createArtifact(
  state: ArtifactCollection,
  input: ArtifactInput,
  operation: string,
  id: string,
  jobId?: string,
): ArtifactCollection {
  if (receipt(state, operation)) return state;
  if (typeof id !== 'string' || !id || id.length > 100 || state.items.some((a) => a.id === id))
    throw new Error('Artifact ID already exists or is invalid.');
  const name = title(input.title),
    data = validateArtifactData(input.kind, input.data);
  return bounded({
    ...state,
    selectedId: id,
    items: [
      ...state.items,
      {
        id,
        kind: input.kind,
        title: name,
        cursor: 0,
        versions: [{ id: operation, title: name, data, createdAt: Date.now() }],
      },
    ],
    operations: [
      ...state.operations,
      { id: operation, artifactId: id, versionId: operation, jobId },
    ],
  });
}
export function reviseArtifact(
  state: ArtifactCollection,
  id: string,
  baseVersionId: string | null,
  data: unknown,
  operation: string,
  name?: string,
  jobId?: string,
): ArtifactCollection {
  if (receipt(state, operation)) return state;
  const artifact = state.items.find((a) => a.id === id);
  if (!artifact) throw new Error('Artifact is unavailable.');
  const current = currentArtifactVersion(artifact);
  if ((current?.id ?? null) !== baseVersionId)
    throw new Error(
      `Artifact changed; read it again before editing. Current version: ${current?.id || 'none'}.`,
    );
  const validated = validateArtifactData(artifact.kind, data),
    nextTitle = title(name || current?.title || artifact.title);
  const unchanged =
    current &&
    JSON.stringify(current.data) === JSON.stringify(validated) &&
    current.title === nextTitle;
  const versions = unchanged
    ? artifact.versions
    : [
        ...artifact.versions,
        { id: operation, title: nextTitle, data: validated, createdAt: Date.now() },
      ].slice(-24);
  return bounded({
    ...state,
    selectedId: id,
    items: state.items.map((a) =>
      a.id === id
        ? { ...a, title: nextTitle, versions, cursor: unchanged ? a.cursor : versions.length - 1 }
        : a,
    ),
    operations: [
      ...state.operations,
      { id: operation, artifactId: id, versionId: unchanged ? current.id : operation, jobId },
    ],
  });
}
export function selectArtifact(
  state: ArtifactCollection,
  id: string,
  versionId?: string | null,
): ArtifactCollection {
  const artifact = state.items.find((a) => a.id === id);
  if (!artifact) throw new Error('Artifact is unavailable.');
  const cursor =
    versionId === undefined
      ? artifact.cursor
      : !versionId
        ? -1
        : artifact.versions.findIndex((v) => v.id === versionId);
  if (versionId && cursor < 0) throw new Error('Artifact version is unavailable.');
  return {
    ...state,
    selectedId: id,
    items: state.items.map((a) => (a.id === id ? { ...a, cursor } : a)),
  };
}
export function removeArtifact(state: ArtifactCollection, id: string): ArtifactCollection {
  const items = state.items.filter((a) => a.id !== id);
  return {
    ...state,
    items,
    selectedId: state.selectedId === id ? items.at(-1)?.id : state.selectedId,
  };
}
export function labelArtifact(
  state: ArtifactCollection,
  id: string,
  versionId: string,
  point: string,
  offset: number[],
): ArtifactCollection {
  const artifact = state.items.find((a) => a.id === id && a.kind === 'diagram'),
    version = currentArtifactVersion(artifact);
  if (!artifact || !version || version.id !== versionId)
    throw new Error('The diagram changed. Try moving the label again.');
  if (!Object.hasOwn(resolveScene(version.data).points, point))
    throw new Error('Unknown diagram point.');
  if (
    !Array.isArray(offset) ||
    offset.length !== 2 ||
    offset.some((n) => !Number.isFinite(n) || Math.abs(n) > 300)
  )
    throw new Error('Label offsets must be finite and within ±300.');
  return bounded({
    ...state,
    items: state.items.map((a) =>
      a.id === id
        ? {
            ...a,
            versions: a.versions.map((v) =>
              v.id === versionId
                ? {
                    ...v,
                    view: { labels: { ...v.view?.labels, [point]: offset as [number, number] } },
                  }
                : v,
            ),
          }
        : a,
    ),
  });
}
const key = (id: string) => `artifacts:${id}`;
export class ArtifactStore {
  async get(id: string): Promise<ArtifactCollection> {
    const collection = (await chrome.storage.local.get(key(id)))[key(id)] as
      ArtifactCollection | undefined;
    if (collection) return collection;
    const legacy = (await chrome.storage.local.get(`diagram:${id}`))[`diagram:${id}`] as
      DiagramDocument | undefined;
    return legacy ? fromDiagram(legacy) : emptyArtifacts();
  }
  private async change(id: string, update: (state: ArtifactCollection) => ArtifactCollection) {
    return navigator.locks.request(`pi-x-artifacts:${id}`, async () => {
      const next = bounded(update(await this.get(id)));
      await chrome.storage.local.set({ [key(id)]: next });
      await chrome.storage.local.remove(`diagram:${id}`);
      return next;
    });
  }
  create(
    chat: string,
    input: ArtifactInput,
    operation: string,
    id: string = crypto.randomUUID(),
    jobId?: string,
  ) {
    return this.change(chat, (state) => createArtifact(state, input, operation, id, jobId));
  }
  revise(
    chat: string,
    id: string,
    base: string | null,
    data: unknown,
    operation: string,
    name?: string,
    jobId?: string,
  ) {
    return this.change(chat, (state) =>
      reviseArtifact(state, id, base, data, operation, name, jobId),
    );
  }
  select(chat: string, id: string, versionId?: string | null) {
    return this.change(chat, (state) => selectArtifact(state, id, versionId));
  }
  remove(chat: string, id: string) {
    return this.change(chat, (state) => removeArtifact(state, id));
  }
  label(chat: string, id: string, version: string, point: string, offset: number[]) {
    return this.change(chat, (state) => labelArtifact(state, id, version, point, offset));
  }
  draw(
    chat: string,
    input: unknown,
    operation: string,
    id?: string,
    base?: string | null,
    jobId?: string,
  ) {
    return this.change(chat, (state) => {
      if (receipt(state, operation)) return state;
      const artifact = diagramArtifact(state, id);
      if (id && !artifact) throw new Error('Drawing artifact is unavailable.');
      const scene = input as SceneSpec;
      return artifact
        ? reviseArtifact(
            state,
            artifact.id,
            base === undefined ? (currentArtifactVersion(artifact)?.id ?? null) : base,
            input,
            operation,
            scene?.title || artifact.title,
            jobId,
          )
        : createArtifact(
            state,
            { kind: 'diagram', title: scene?.title || artifactTypes.diagram.label, data: input },
            operation,
            'diagram',
            jobId,
          );
    });
  }
  async deleteConversation(id: string) {
    await navigator.locks.request(`pi-x-artifacts:${id}`, async () => {
      await chrome.storage.local.remove(key(id));
      await chrome.storage.local.remove(`diagram:${id}`);
    });
  }
}
