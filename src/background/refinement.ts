import type { Job, Refinement } from '../shared/types';
import { ownsJob } from './jobs';
export function refinementJob(
  parent: Job | undefined,
  request: { composerId: unknown; refinement: unknown },
  sender: { tab?: { id?: number }; documentId?: string },
): Pick<Job, 'sessionId' | 'refinement' | 'post' | 'prompt' | 'mode' | 'brief'> {
  if (
    !parent ||
    !ownsJob(parent, sender) ||
    parent.composerId !== request.composerId ||
    parent.status !== 'done'
  )
    throw new Error('The previous draft is unavailable. Generate a new draft first.');
  const r = request.refinement as Refinement | null;
  if (
    !r ||
    typeof r.instruction !== 'string' ||
    !r.instruction.trim() ||
    r.instruction.length > 4000 ||
    typeof r.currentDraft !== 'string' ||
    r.currentDraft.length > 40000
  )
    throw new Error('Enter a request up to 4,000 characters and a draft up to 40,000 characters.');
  return {
    sessionId: parent.sessionId || parent.id,
    post: parent.post,
    mode: parent.mode,
    brief: parent.brief,
    prompt: parent.prompt,
    refinement: { instruction: r.instruction.trim(), currentDraft: r.currentDraft },
  };
}
