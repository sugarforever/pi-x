import type { PanelTurn } from '../shared/panel';
import type { ToolTrace } from '../shared/types';
export type ConversationItem =
  { kind: 'turn'; turn: PanelTurn } | { kind: 'tools'; jobId: string; traces: ToolTrace[] };
export function conversationItems(turns: PanelTurn[], traces: ToolTrace[]): ConversationItem[] {
  const groups = new Map<string, ToolTrace[]>();
  for (const trace of traces) {
    const jobId = trace.jobId || trace.id.split(':')[0];
    groups.set(jobId, [...(groups.get(jobId) || []), trace]);
  }
  const items: ConversationItem[] = [];
  const emit = (jobId?: string) => {
    if (!jobId || !groups.has(jobId)) return;
    items.push({ kind: 'tools', jobId, traces: groups.get(jobId)! });
    groups.delete(jobId);
  };
  for (const turn of turns) {
    if (turn.role === 'agent') emit(turn.jobId);
    items.push({ kind: 'turn', turn });
    if (turn.role === 'user') emit(turn.jobId);
  }
  for (const jobId of [...groups.keys()]) emit(jobId);
  return items;
}
