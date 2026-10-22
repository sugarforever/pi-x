import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type { Model, ProviderStreams, TranscriptContext } from '@earendil-works/pi-ai';
import type { Settings } from '../shared/types';
export function configuredModels(settings: Pick<Settings, 'baseUrl' | 'model' | 'apiKey'>) {
  const model: Model<'openai-completions'> = {
    id: settings.model,
    name: settings.model,
    api: 'openai-completions',
    provider: 'configured',
    baseUrl: settings.baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 2048,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens',
    },
  };
  const raw = openAICompletionsApi();
  const check = (context: TranscriptContext) => {
    if (context.messages.filter((m) => m.role === 'assistant').length >= 8)
      throw new Error('Research reached the 8-turn limit. Try a more focused prompt.');
  };
  const api: ProviderStreams = {
    stream(model, context, options) {
      check(context);
      return raw.stream(model, context, { ...options, maxTokens: 2048 });
    },
    streamSimple(model, context, options) {
      check(context);
      return raw.streamSimple(model, context, { ...options, maxTokens: 2048 });
    },
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: 'configured',
      name: 'Configured endpoint',
      models: [model],
      baseUrl: settings.baseUrl,
      auth: {
        apiKey: {
          name: 'User API key',
          resolve: async () => ({ auth: { apiKey: settings.apiKey || 'local-no-key' } }),
        },
      },
      api,
    }),
  );
  return models;
}
