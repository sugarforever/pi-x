import type { ToolName } from '../shared/types';
// Existing intents retain automatic access; explicit preferences can narrow it.
export function sessionTools(enabled?: ToolName[], readContext = true): ToolName[] {
  return (enabled || (['articles', 'context', 'voice', 'search'] as ToolName[])).filter(
    (t) => readContext || t !== 'context',
  );
}
