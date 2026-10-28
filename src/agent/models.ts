import { createModels, createProvider } from '@earendil-works/pi-ai/models';
import { chatGPTAuth } from '../background/chatgpt-auth';
import { modelBaseUrl } from '../shared/settings';
import { openAICodexResponsesApi } from '@earendil-works/pi-ai/api/openai-codex-responses.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import type {
  Model,
  ProviderStreams,
  StreamOptions,
  TranscriptContext,
} from '@earendil-works/pi-ai';
import type { Settings } from '../shared/types';
export function configuredModels(
  settings: Pick<Settings, 'provider' | 'baseUrl' | 'model' | 'apiKey'>,
  subscriptionAuth = () => chatGPTAuth.getAuth(),
) {
  const subscription = settings.provider === 'chatgpt';
  const baseUrl = modelBaseUrl(settings);
  const useResponses = subscription || /^gpt-6(?:[.-]|$)/i.test(settings.model);
  const model: Model<'openai-completions' | 'openai-responses' | 'openai-codex-responses'> = {
    id: settings.model,
    name: settings.model,
    api: subscription
      ? 'openai-codex-responses'
      : useResponses
        ? 'openai-responses'
        : 'openai-completions',
    provider: 'configured',
    baseUrl,
    reasoning: useResponses,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32000,
    maxTokens: 2048,
    compat: useResponses
      ? {}
      : {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          // Let Pi select the token-limit field for the configured provider.
        },
  };
  const raw = subscription
    ? openAICodexResponsesApi()
    : useResponses
      ? openAIResponsesApi()
      : openAICompletionsApi();
  const check = (context: TranscriptContext) => {
    const currentTurn = context.messages.slice(
      context.messages.findLastIndex((m) => m.role === 'user') + 1,
    );
    if (currentTurn.filter((m) => m.role === 'assistant').length >= 8)
      throw new Error('Research reached the 8-turn limit. Try a more focused prompt.');
  };
  const requestOptions = (options: StreamOptions | undefined): StreamOptions => ({
    ...options,
    maxTokens: 2048,
    ...(subscription ? { transport: 'sse' as const } : {}),
  });
  const api: ProviderStreams = {
    stream(model, context, options) {
      check(context);
      return raw.stream(model, context, {
        ...requestOptions(options),
        ...(useResponses ? { reasoningEffort: 'low' as const } : {}),
      });
    },
    streamSimple(model, context, options) {
      check(context);
      return (subscription ? raw.stream : raw.streamSimple)(model, context, {
        ...requestOptions(options),
        ...(subscription
          ? { reasoningEffort: 'low' as const }
          : useResponses
            ? { reasoning: 'low' as const }
            : {}),
      });
    },
  };
  const models = createModels();
  models.setProvider(
    createProvider({
      id: 'configured',
      name: subscription ? 'ChatGPT subscription' : 'Configured endpoint',
      models: [model],
      baseUrl,
      auth: {
        apiKey: {
          name: 'User API key',
          resolve: async () => ({
            auth: subscription
              ? await subscriptionAuth()
              : { apiKey: settings.apiKey || 'local-no-key' },
          }),
        },
      },
      api,
    }),
  );
  return models;
}
