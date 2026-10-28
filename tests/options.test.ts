// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultSettings } from '../src/shared/settings';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('../src/shared/rpc', () => ({ rpc }));
afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  vi.useRealTimers();
  vi.resetModules();
  vi.clearAllMocks();
  document.body.replaceChildren();
});
async function setup() {
  document.documentElement.innerHTML = readFileSync('src/options/options.html', 'utf8');
  rpc.mockImplementation(async (message) =>
    message.type === 'settings:get' ? defaultSettings() : {},
  );
  await import('../src/options/index');
  await vi.waitFor(() =>
    expect((document.getElementById('model') as HTMLInputElement).disabled).toBe(false),
  );
}
it('automatically saves connection edits without a Save button', async () => {
  await setup();
  const model = document.getElementById('model') as HTMLInputElement;
  model.value = 'my-model';
  model.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings:save',
        settings: expect.objectContaining({ model: 'my-model' }),
      }),
    ),
  );
  expect(document.getElementById('save')).toBeNull();
  expect(document.getElementById('save-status')?.textContent).toBe('All changes saved.');
});
it('shows invalid changes and saves them once corrected', async () => {
  await setup();
  const base = document.getElementById('base-url') as HTMLInputElement;
  base.value = 'not a url';
  base.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('save-status')?.textContent).toContain('Not saved:'),
  );
  expect(rpc.mock.calls.filter(([m]) => m.type === 'settings:save')).toHaveLength(0);
  base.value = 'https://example.com/v1';
  base.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('save-status')?.textContent).toBe('All changes saved.'),
  );
});
it('preserves rapid edit order while an earlier save is still pending', async () => {
  await setup();
  let release!: () => void;
  let stored = '';
  rpc.mockImplementation(async (message) => {
    if (message.type !== 'settings:save') return {};
    if (message.settings.model === 'first')
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    stored = message.settings.model;
    return {};
  });
  const model = document.getElementById('model') as HTMLInputElement;
  model.value = 'first';
  model.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  model.value = 'latest';
  model.dispatchEvent(new Event('input', { bubbles: true }));
  release();
  await vi.waitFor(() => expect(stored).toBe('latest'));
  expect(document.getElementById('save-status')?.textContent).toBe('All changes saved.');
});
it('automatically saves prompt edits and removals', async () => {
  await setup();
  const name = document.querySelector('[aria-label="Prompt name"]') as HTMLInputElement;
  name.value = 'My prompt';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() =>
    expect(rpc).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings:save',
        settings: expect.objectContaining({
          prompts: expect.arrayContaining([expect.objectContaining({ name: 'My prompt' })]),
        }),
      }),
    ),
  );
  (document.querySelector('#prompt-list button.delete') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'settings:save',
        settings: expect.objectContaining({ prompts: expect.any(Array) }),
      }),
    ),
  );
  const saved = rpc.mock.calls.filter(([m]) => m.type === 'settings:save').at(-1)![0];
  expect(saved.settings.prompts).toHaveLength(3);
});

it('adds a second model and persists behavior preferences independently', async () => {
  await setup();
  (document.getElementById('add-model') as HTMLButtonElement).click();
  const model = document.getElementById('model') as HTMLInputElement;
  model.value = 'second';
  model.dispatchEvent(new Event('input', { bubbles: true }));
  const auto = document.getElementById('auto-draft') as HTMLInputElement;
  auto.checked = false;
  auto.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() =>
    expect(document.getElementById('save-status')?.textContent).toBe('All changes saved.'),
  );
  const saved = rpc.mock.calls.filter(([m]) => m.type === 'settings:save').at(-1)![0].settings;
  expect(saved.models).toHaveLength(2);
  expect(saved.models[1].model).toBe('second');
  expect(saved.behavior.autoDraft).toBe(false);
  expect(saved.defaultModelId).toBe('default');
});
it('saves explicit intent tool choices', async () => {
  await setup();
  const chip = document.querySelector('#prompt-list .intent-tools button') as HTMLButtonElement;
  expect(chip.getAttribute('aria-pressed')).toBe('true');
  chip.click();
  await vi.waitFor(() =>
    expect(document.getElementById('save-status')?.textContent).toBe('All changes saved.'),
  );
  const saved = rpc.mock.calls.filter(([m]) => m.type === 'settings:save').at(-1)![0].settings;
  expect(saved.prompts[0].enabledTools).not.toContain('articles');
});
it('switches providers, preserves custom connection fields and shows device sign-in', async () => {
  await setup();
  const base = document.getElementById('base-url') as HTMLInputElement;
  base.value = 'https://custom.example/v1';
  base.dispatchEvent(new Event('input', { bubbles: true }));
  const provider = document.getElementById('provider') as HTMLSelectElement;
  expect(provider).not.toBeNull();
  provider.value = 'chatgpt';
  provider.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.getElementById('compatible-fields')!.hidden).toBe(true);
  expect(document.getElementById('chatgpt-account')!.hidden).toBe(false);
  await vi.waitFor(() =>
    expect(document.getElementById('save-status')?.textContent).toBe('All changes saved.'),
  );
  const saved = rpc.mock.calls.filter(([m]) => m.type === 'settings:save').at(-1)![0].settings;
  expect(saved.models[0].provider).toBe('chatgpt');
  expect(saved.models[0].baseUrl).toBe('https://custom.example/v1');
  provider.value = 'openai-compatible';
  provider.dispatchEvent(new Event('change', { bubbles: true }));
  expect(base.value).toBe('https://custom.example/v1');
  expect(document.getElementById('compatible-fields')!.hidden).toBe(false);
});
it('shows the device code, completes polling, and signs out without storing tokens in settings', async () => {
  await setup();
  vi.useFakeTimers();
  rpc.mockImplementation(async (message) => {
    if (message.type === 'chatgpt:start')
      return {
        state: 'pending',
        userCode: 'ABCD-EFGH',
        nextPollAt: Date.now() + 5000,
        expiresAt: Date.now() + 900000,
      };
    if (message.type === 'chatgpt:poll') return { state: 'signed-in' };
    if (message.type === 'chatgpt:signout') return { state: 'signed-out' };
    return {};
  });
  const provider = document.getElementById('provider') as HTMLSelectElement;
  provider.value = 'chatgpt';
  provider.dispatchEvent(new Event('change', { bubbles: true }));
  (document.getElementById('chatgpt-signin') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.getElementById('chatgpt-code')!.textContent).toBe('ABCD-EFGH'),
  );
  expect(document.getElementById('chatgpt-device')!.hidden).toBe(false);
  await vi.advanceTimersByTimeAsync(5000);
  expect(document.getElementById('chatgpt-status')!.textContent).toContain('Signed in');
  expect(document.getElementById('chatgpt-device')!.hidden).toBe(true);
  (document.getElementById('chatgpt-signout') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.getElementById('chatgpt-status')!.textContent).toContain('Signed out'),
  );
  vi.useRealTimers();
});
