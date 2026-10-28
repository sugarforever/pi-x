import { expect, it } from 'vitest';
import {
  defaultSettings,
  validateSettings,
  modelSettings,
  modelProfiles,
  publicSettings,
} from '../src/shared/settings';
it('migrates a legacy connection into a selectable profile without exposing keys', () => {
  const s = defaultSettings();
  s.model = 'legacy';
  s.apiKey = 'secret';
  expect(modelProfiles(s)[0].model).toBe('legacy');
  expect(JSON.stringify(publicSettings(s))).not.toContain('secret');
});
it('validates profiles, selects the default and resolves an explicit model', () => {
  const s = validateSettings({
    ...defaultSettings(),
    models: [
      { id: 'a', baseUrl: 'https://example.com/v1', apiKey: 'key-a', model: 'alpha' },
      { id: 'b', baseUrl: 'http://localhost:11434/v1', apiKey: '', model: 'beta' },
    ],
    defaultModelId: 'b',
  });
  expect(s.model).toBe('beta');
  expect(modelSettings(s, 'a').model).toBe('alpha');
  expect(() => modelSettings(s, 'missing')).toThrow();
  expect(() => validateSettings({ ...s, models: [s.models![0], s.models![0]] })).toThrow();
});
it('keeps behavior defaults compatible and rejects invalid choices', () => {
  expect(publicSettings(defaultSettings()).behavior).toEqual({
    autoDraft: true,
    readContext: true,
    language: 'Chinese',
  });
  expect(() =>
    validateSettings({
      ...defaultSettings(),
      behavior: { autoDraft: 'yes', readContext: true, language: 'Chinese' },
    }),
  ).toThrow();
});
it('resolves each provider independently while preserving legacy endpoints', () => {
  const s = validateSettings({
    ...defaultSettings(),
    models: [
      { id: 'api', baseUrl: 'https://proxy.example/v1', apiKey: 'custom-key', model: 'custom' },
      {
        id: 'sub',
        provider: 'chatgpt',
        baseUrl: 'https://proxy.example/v1',
        apiKey: 'unused',
        model: 'gpt-5.2',
      },
    ],
    defaultModelId: 'sub',
  });
  expect(s.provider).toBe('chatgpt');
  expect(modelSettings(s, 'api').provider).toBe('openai-compatible');
  expect(modelSettings(s, 'api').apiKey).toBe('custom-key');
  expect(modelProfiles(defaultSettings())[0].provider).toBe('openai-compatible');
  expect(() => validateSettings({ ...s, provider: 'unknown', models: undefined })).toThrow(
    /provider/i,
  );
  expect(() =>
    validateSettings({ ...s, models: [{ ...s.models![0], provider: 'unknown' }] }),
  ).toThrow(/provider/i);
});
