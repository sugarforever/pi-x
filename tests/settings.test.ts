import { describe, it, expect } from 'vitest';
import { defaultSettings, validateSettings, publicSettings } from '../src/shared/settings';
import { publicWebUrl, providerUrl } from '../src/shared/urls';

describe('settings', () => {
  it('rejects a missing default prompt rather than silently running another intent', () => {
    const s = defaultSettings();
    s.defaultPromptId = 'deleted';
    expect(() => validateSettings(s)).toThrow(/default/i);
  });
  it('keeps credentials and writing samples out of page settings', () => {
    const s = defaultSettings();
    s.apiKey = 'secret';
    s.searchKey = 'search-secret';
    s.samples = [{ id: '1', title: 'Voice', text: 'Private writing' }];
    expect(JSON.stringify(publicSettings(s))).not.toMatch(/secret|Private writing/);
    expect(publicSettings(s).prompts[0].name).toBe('Chinese rewrite');
  });
  it('rejects duplicate prompt IDs and empty instructions', () => {
    const s = defaultSettings();
    s.prompts.push({ ...s.prompts[0] });
    expect(() => validateSettings(s)).toThrow(/unique/i);
    s.prompts.pop();
    s.prompts[0].instructions = ' ';
    expect(() => validateSettings(s)).toThrow(/instruction/i);
  });
});
describe('network URL policy', () => {
  it.each([
    'http://127.0.0.1/a',
    'https://localhost/a',
    'https://192.168.1.2',
    'https://[::1]',
    'https://169.254.169.254',
    'file:///etc/passwd',
    'https://user:pass@example.com',
    'https://[::ffff:7f00:1]',
    'https://service.local',
  ])('rejects untrusted research address %s', (url) => {
    expect(() => publicWebUrl(url)).toThrow();
  });
  it('allows local models only through explicit provider configuration', () => {
    expect(providerUrl('http://localhost:11434/v1/').href).toBe('http://localhost:11434/v1');
    expect(publicWebUrl('https://example.com/article').hostname).toBe('example.com');
  });
});
