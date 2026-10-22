import type { Settings, PublicSettings } from './types';
import { providerUrl } from './urls';
export function defaultSettings(): Settings {
  return {
    version: 1,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
    searchKey: '',
    articleAccess: false,
    defaultPromptId: 'chinese-rewrite',
    samples: [],
    prompts: [
      {
        id: 'chinese-rewrite',
        name: 'Chinese rewrite',
        tools: [],
        instructions:
          'Translate the selected post into natural Chinese and rewrite it clearly and concisely. Preserve the author’s meaning and uncertainty. Do not add opinions or facts. Return only the draft.',
      },
      {
        id: 'in-my-voice',
        name: 'In my voice',
        tools: ['voice'],
        instructions:
          'Rewrite the selected post in Chinese using my writing examples as style references. Preserve the original meaning; do not copy facts or opinions from the examples. Return only the draft.',
      },
      {
        id: 'in-context',
        name: 'Read in context',
        tools: ['articles', 'context'],
        instructions:
          'Read the conversation context and any linked articles that matter. Write a concise Chinese quote comment explaining the central point. Clearly distinguish what is known from interpretation. Return only the draft.',
      },
      {
        id: 'check-claim',
        name: 'Research the claim',
        tools: ['search', 'articles'],
        instructions:
          'Research the central factual claim using web search and reliable primary sources. Read relevant sources. Draft a concise Chinese comment with appropriate uncertainty and source URLs. Do not claim verification if evidence is unavailable. Return only the draft.',
      },
    ],
  };
}
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const s = structuredClone(value) as Settings;
  if (
    s.version !== 1 ||
    !['baseUrl', 'apiKey', 'model', 'searchKey', 'defaultPromptId'].every(
      (k) => typeof (s as unknown as Record<string, unknown>)[k] === 'string',
    )
  )
    throw new Error('Invalid connection settings.');
  if (typeof s.articleAccess !== 'boolean') throw new Error('Invalid article access preference.');
  s.baseUrl = providerUrl(s.baseUrl).href.replace(/\/$/, '');
  s.apiKey = s.apiKey.trim();
  s.model = s.model.trim();
  s.searchKey = s.searchKey.trim();
  if (!Array.isArray(s.prompts) || !s.prompts.length || s.prompts.length > 30)
    throw new Error('Create between 1 and 30 prompts.');
  const ids = new Set<string>();
  for (const p of s.prompts) {
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id))
      throw new Error('Prompt IDs must be unique.');
    ids.add(p.id);
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80)
      throw new Error('Each prompt needs a name (up to 80 characters).');
    if (
      typeof p.instructions !== 'string' ||
      !p.instructions.trim() ||
      p.instructions.length > 12000
    )
      throw new Error('Each prompt needs instructions (up to 12,000 characters).');
    if (
      !Array.isArray(p.tools) ||
      p.tools.some((t) => !['articles', 'context', 'voice', 'search'].includes(t))
    )
      throw new Error('Unknown prompt tool.');
  }
  if (!ids.has(s.defaultPromptId)) throw new Error('Choose an existing default prompt.');
  if (
    !Array.isArray(s.samples) ||
    s.samples.length > 100 ||
    s.samples.some(
      (x) =>
        !x ||
        typeof x.id !== 'string' ||
        typeof x.title !== 'string' ||
        typeof x.text !== 'string' ||
        !x.text.trim() ||
        x.text.length > 12000,
    )
  )
    throw new Error(
      'Writing samples need text, up to 12,000 characters each (100 samples maximum).',
    );
  return s;
}
export function publicSettings(s: Settings): PublicSettings {
  return {
    prompts: s.prompts.map(({ id, name }) => ({ id, name })),
    defaultPromptId: s.defaultPromptId,
    configured: !!s.model,
  };
}
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ? validateSettings(settings) : defaultSettings();
}
