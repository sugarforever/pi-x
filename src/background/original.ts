import { ORIGINAL_PROMPT } from '../shared/settings';
import type { Prompt } from '../shared/types';
export function originalInput(
  brief: unknown,
  promptId: unknown,
  prompts: Prompt[],
  initialDraft: unknown = '',
) {
  if (typeof brief !== 'string' || !brief.trim() || brief.length > 4000)
    throw new Error('Describe your tweet in 1–4,000 characters.');
  if (typeof initialDraft !== 'string' || initialDraft.length > 40000)
    throw new Error('The current draft must be at most 40,000 characters.');
  const prompt =
    promptId === ORIGINAL_PROMPT.id ? ORIGINAL_PROMPT : prompts.find((p) => p.id === promptId);
  if (!prompt) throw new Error('Choose an available writing prompt.');
  return { brief: brief.trim(), prompt, initialDraft };
}
