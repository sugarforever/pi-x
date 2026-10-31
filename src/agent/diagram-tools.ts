import { defineTool } from '@earendil-works/pi-durable';
import { Type } from '@earendil-works/pi-ai';
import { calculate } from '../geometry/calculate';
import { currentDiagram, type DiagramDocument } from '../geometry/document';
export interface DiagramAccess {
  get(): Promise<DiagramDocument | undefined>;
  draw(spec: unknown, operationId: string): Promise<DiagramDocument>;
}
export function diagramTools(
  access: DiagramAccess,
  signal?: AbortSignal,
  progress = (_text: string) => {},
) {
  const out = (data: unknown) => ({
    output: [{ type: 'text' as const, text: JSON.stringify(data) }],
  });
  const failure = (error: unknown) => ({
    ...out({ saved: false, error: error instanceof Error ? error.message : 'Invalid geometry.' }),
    isError: true,
  });
  return [
    defineTool({
      name: 'calculate',
      description:
        'Evaluate bounded arithmetic to compute geometry coordinates accurately. Trig uses degrees. Supports sqrt, abs, sin, cos, tan, asin, acos, atan, atan2, hypot, min, max, pi, e, + - * / ^ and named earlier results in the same batch. No executable code.',
      replay: 'safe',
      parameters: Type.Object({
        calculations: Type.Array(
          Type.Object({
            name: Type.String({ maxLength: 32 }),
            expression: Type.String({ maxLength: 1200 }),
          }),
          { minItems: 1, maxItems: 50 },
        ),
      }),
      execute: async ({ calculations }) => {
        try {
          signal?.throwIfAborted();
          return out({ values: calculate(calculations) });
        } catch (error) {
          return failure(error);
        }
      },
    }),
    defineTool({
      name: 'get_diagram',
      description:
        'Read the current authoritative diagram, including manual undo and version selection. Null means no drawing is currently shown.',
      replay: 'safe',
      parameters: Type.Object({}),
      execute: async () => {
        signal?.throwIfAborted();
        const version = currentDiagram(await access.get());
        return out({ scene: version?.spec ?? null, versionId: version?.id ?? null });
      },
    }),
    defineTool({
      name: 'draw_diagram',
      description:
        'Validate and display a complete replacement geometry SceneSpec. Preserve unchanged objects, stable IDs and all given constraints. Invalid edits preserve the last valid diagram. Supply JSON data, never SVG, HTML or executable code.',
      replay: 'safe',
      parameters: Type.Object({ sceneJson: Type.String({ minLength: 1, maxLength: 64000 }) }),
      execute: async ({ sceneJson }, api) => {
        try {
          signal?.throwIfAborted();
          progress('Drawing diagram…');
          const doc = await access.draw(JSON.parse(sceneJson), String(api.taskId));
          const version = currentDiagram(doc);
          return out({ saved: true, versionId: version?.id, scene: version?.spec });
        } catch (error) {
          return failure(error);
        }
      },
    }),
  ];
}
