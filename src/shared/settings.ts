export const REPLY_PROMPT: import('./types').Prompt = {
  id: 'compose-reply',
  name: 'Thoughtful reply',
  tools: [],
  instructions:
    'Write a concise, natural reply to the source author. Address their specific point; add a useful observation, a focused question, or the perspective requested by the user. Do not merely translate or summarize the source. Do not invent the user’s experiences, agreement, or facts. Follow the configured draft language unless asked otherwise. Return only the editable reply.',
};
export const ORIGINAL_PROMPT = {
  id: 'compose-original',
  name: 'Original post',
  instructions:
    'Write an original tweet from the user’s brief. Follow their language, tone, audience and writing preferences. Keep it concise unless asked otherwise. Do not invent personal experiences, facts or opinions. Use research when requested or needed. Return only the editable tweet, without a preamble or markdown fences.',
  tools: ['voice'] as import('./types').ToolName[],
};
import type { Settings, PublicSettings, Prompt, ModelProfile, Behavior } from './types';
import { providerUrl } from './urls';
export const RETELL_PROMPT: Prompt = {
  id: 'retell-viewpoint',
  name: '转述观点',
  tools: ['context', 'articles'],
  instructions: `Retell the source author's views for a human who is quote-posting someone else's post. Default to natural Chinese unless the user requests another language. This is attributed reporting, not impersonation, endorsement, or an unlabelled first-person translation.
Identify the original author by name or handle from the source. Establish attribution naturally at the start (for example, 作者认为 or 作者介绍), then use concise third-person reporting without repeating the attribution in every sentence. Do not assume the author's gender.
Convert the source author's I, me, my, we and our into references to that author or their team. Keep personal experiences, achievements, affiliations, judgments and predictions attached to the person who expressed them. Never claim that the user built, experienced, owns or believes something merely because the source says so. Do not add user agreement, disagreement or personal commentary unless explicitly requested.
Preserve the central argument, reasoning, material details, qualifications, uncertainty and distinction between opinion, prediction, self-report and independently supported facts. Do not strengthen 'may' into certainty or present a self-reported achievement as verified. Attribute embedded quotations to their own speakers rather than merging their views with the source author. Read the full source and relevant context if needed; never invent missing content.
Example: source 'I built this tool, and I think it may help small teams.' becomes '作者介绍了自己开发的工具，并认为它可能帮助小团队。' It must not become '我开发了一款工具，可以帮助小团队。'
Use a clean, readable quote-post draft with no preamble, headings or analysis. Be concise without flattening the author's reasoning. Return only the editable draft.`,
};
// Available to existing installations without modifying their saved prompts or default.
export function quotePrompts(settings: Pick<Settings, 'prompts'>): Prompt[] {
  return settings.prompts.some((prompt) => prompt.id === RETELL_PROMPT.id)
    ? [...settings.prompts]
    : [...settings.prompts, structuredClone(RETELL_PROMPT)];
}
export function defaultSettings(): Settings {
  return {
    version: 1,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: '',
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
function validateProvider(provider: unknown): 'openai-compatible' | 'chatgpt' {
  if (provider === undefined) return 'openai-compatible';
  if (provider !== 'openai-compatible' && provider !== 'chatgpt')
    throw new Error('Unknown model provider.');
  return provider;
}
export function validateSettings(value: unknown): Settings {
  if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
  const s = structuredClone(value) as Settings;
  if (
    s.version !== 1 ||
    !['baseUrl', 'apiKey', 'model', 'defaultPromptId'].every(
      (k) => typeof (s as unknown as Record<string, unknown>)[k] === 'string',
    )
  )
    throw new Error('Invalid connection settings.');
  s.provider = validateProvider(s.provider);
  s.baseUrl = providerUrl(s.baseUrl).href.replace(/\/$/, '');
  s.apiKey = s.apiKey.trim();
  s.model = s.model.trim();
  // Drop the retired Brave credential when loading or saving older settings.
  delete (s as unknown as Record<string, unknown>).searchKey;
  delete (s as unknown as Record<string, unknown>).articleAccess;
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
  if (s.models !== undefined) {
    if (!Array.isArray(s.models) || !s.models.length || s.models.length > 12)
      throw new Error('Keep between 1 and 12 models.');
    const modelIds = new Set<string>();
    for (const m of s.models) {
      if (
        !m ||
        typeof m.id !== 'string' ||
        !m.id ||
        m.id.length > 100 ||
        modelIds.has(m.id) ||
        typeof m.model !== 'string' ||
        m.model.length > 200 ||
        typeof m.apiKey !== 'string' ||
        typeof m.baseUrl !== 'string'
      )
        throw new Error('Invalid model profile.');
      m.provider = validateProvider(m.provider);
      modelIds.add(m.id);
      m.baseUrl = providerUrl(m.baseUrl).href.replace(/\/$/, '');
      m.model = m.model.trim();
      m.apiKey = m.apiKey.trim();
    }
    if (!modelIds.has(s.defaultModelId || '')) throw new Error('Choose an existing default model.');
    const selected = s.models.find((m) => m.id === s.defaultModelId)!;
    s.provider = selected.provider;
    s.baseUrl = selected.baseUrl;
    s.apiKey = selected.apiKey;
    s.model = selected.model;
  }
  if (
    s.behavior !== undefined &&
    (!s.behavior ||
      typeof s.behavior.autoDraft !== 'boolean' ||
      typeof s.behavior.readContext !== 'boolean' ||
      typeof s.behavior.language !== 'string' ||
      !s.behavior.language.trim() ||
      s.behavior.language.length > 80)
  )
    throw new Error('Invalid behavior settings.');
  for (const p of s.prompts)
    if (
      p.enabledTools !== undefined &&
      (!Array.isArray(p.enabledTools) ||
        p.enabledTools.some((t) => !['articles', 'context', 'voice', 'search'].includes(t)))
    )
      throw new Error('Unknown intent tool.');
  return s;
}
export function modelProfiles(s: Settings): ModelProfile[] {
  return (
    s.models || [
      {
        id: 'default',
        provider: s.provider || 'openai-compatible',
        baseUrl: s.baseUrl,
        apiKey: s.apiKey,
        model: s.model,
      },
    ]
  );
}
export function behaviorSettings(s: Settings): Behavior {
  return s.behavior || { autoDraft: true, readContext: true, language: 'Chinese' };
}
export function modelSettings(s: Settings, id?: string): Settings {
  const selected = modelProfiles(s).find((m) => m.id === (id || s.defaultModelId || 'default'));
  if (!selected) throw new Error('This model was removed. Choose another model.');
  return {
    ...s,
    provider: selected.provider || 'openai-compatible',
    baseUrl: selected.baseUrl,
    apiKey: selected.apiKey,
    model: selected.model,
  };
}
export function publicSettings(s: Settings): PublicSettings {
  return {
    prompts: quotePrompts(s).map(({ id, name }) => ({ id, name })),
    defaultPromptId: s.defaultPromptId,
    configured: !!s.model,
    model: s.model,
    models: modelProfiles(s).map(({ id, model }) => ({ id, model })),
    defaultModelId: s.defaultModelId || 'default',
    behavior: behaviorSettings(s),
  };
}
export async function loadSettings(): Promise<Settings> {
  const { settings } = await chrome.storage.local.get('settings');
  return settings ? validateSettings(settings) : defaultSettings();
}

export function modelBaseUrl(s: Pick<Settings, 'provider' | 'baseUrl'>): string {
  return s.provider === 'chatgpt' ? 'https://chatgpt.com/backend-api' : s.baseUrl;
}
