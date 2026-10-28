import { expect, it, vi } from 'vitest';
import { createChatGPTAuth, type AuthState } from '../src/background/chatgpt-auth';
const jwt = (id = 'acct-test') =>
  `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: id } }))}.signature`;
function setup() {
  let state: AuthState = {};
  let now = 100_000;
  let queue = Promise.resolve();
  const fetcher = vi.fn<typeof fetch>();
  const options = {
    read: async () => structuredClone(state),
    write: async (value: AuthState) => {
      state = structuredClone(value);
    },
    now: () => now,
    fetch: fetcher,
    lock: <T>(fn: () => Promise<T>): Promise<T> => {
      const result = queue.then(fn);
      queue = result.then(
        () => {},
        () => {},
      );
      return result;
    },
  };
  const auth = createChatGPTAuth(options);
  return {
    auth,
    options,
    fetcher,
    state: () => state,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const device = () =>
  Response.json({ device_auth_id: 'private-device-id', user_code: 'ABCD-EFGH', interval: '5' });
const tokens = (access = jwt()) =>
  Response.json({ access_token: access, refresh_token: 'private-refresh', expires_in: 3600 });
it('persists pending sign-in across worker restarts and exposes only the user code', async () => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(device());
  expect(await f.auth.start()).toMatchObject({ state: 'pending', userCode: 'ABCD-EFGH' });
  const restarted = createChatGPTAuth(f.options);
  expect(await restarted.status()).toMatchObject({ state: 'pending', userCode: 'ABCD-EFGH' });
  expect(JSON.stringify(await restarted.status())).not.toContain('private-device-id');
  f.advance(5000);
  f.fetcher.mockResolvedValueOnce(Response.json({}, { status: 403 }));
  expect((await restarted.poll()).state).toBe('pending');
  f.advance(5000);
  f.fetcher
    .mockResolvedValueOnce(
      Response.json({ authorization_code: 'private-code', code_verifier: 'private-verifier' }),
    )
    .mockResolvedValueOnce(tokens());
  expect((await restarted.poll()).state).toBe('signed-in');
  expect(await restarted.getAuth()).toEqual({ apiKey: jwt() });
  expect(JSON.stringify(await restarted.status())).not.toMatch(/private-|signature/);
  const request = f.fetcher.mock.calls.at(-1)!;
  expect(request[0]).toBe('https://auth.openai.com/oauth/token');
  expect(new URLSearchParams(String(request[1]?.body)).get('redirect_uri')).toBe(
    'https://auth.openai.com/deviceauth/callback',
  );
});
it('enforces polling intervals, slows down when asked, and expires pending codes', async () => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(device());
  await f.auth.start();
  await f.auth.poll();
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  f.advance(5000);
  f.fetcher.mockResolvedValueOnce(Response.json({ error: 'slow_down' }, { status: 429 }));
  expect((await f.auth.poll()).state).toBe('pending');
  f.advance(5000);
  await f.auth.poll();
  expect(f.fetcher).toHaveBeenCalledTimes(2);
  f.advance(15 * 60_000);
  expect(await f.auth.poll()).toMatchObject({
    state: 'signed-out',
    error: expect.stringMatching(/expired/i),
  });
  expect(f.fetcher).toHaveBeenCalledTimes(2);
});
it.each([
  Response.json({ error: { code: 'access_denied', message: 'private-secret' } }, { status: 400 }),
  Response.json({ authorization_code: 'private-code' }),
])('clears failed authorization without exposing response bodies', async (response) => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(device());
  await f.auth.start();
  f.advance(5000);
  f.fetcher.mockResolvedValueOnce(response);
  expect(await f.auth.poll()).toMatchObject({ state: 'signed-out', error: expect.any(String) });
  expect(JSON.stringify(await f.auth.status())).not.toMatch(/private-/);
  expect(f.state().pending).toBeUndefined();
});
it('cancel and sign-out prevent pending authorization from completing', async () => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(device());
  await f.auth.start();
  await f.auth.cancel();
  f.advance(5000);
  expect((await f.auth.poll()).state).toBe('signed-out');
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  await f.options.write({
    credential: { access: jwt(), refresh: 'private-refresh', expires: 9_000_000 },
  });
  await f.auth.signOut();
  await expect(f.auth.getAuth()).rejects.toThrow(/sign in/i);
});
it('serializes refresh and persists the rotated token once for concurrent requests', async () => {
  const f = setup();
  await f.options.write({ credential: { access: jwt('old'), refresh: 'old-refresh', expires: 0 } });
  f.fetcher.mockResolvedValueOnce(tokens());
  expect(await Promise.all([f.auth.getAuth(), f.auth.getAuth()])).toEqual([
    { apiKey: jwt() },
    { apiKey: jwt() },
  ]);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.state().credential?.refresh).toBe('private-refresh');
  expect(new URLSearchParams(String(f.fetcher.mock.calls[0][1]?.body)).get('refresh_token')).toBe(
    'old-refresh',
  );
});
it('requires sign-in again after failed refresh without returning raw server errors', async () => {
  const f = setup();
  await f.options.write({ credential: { access: jwt(), refresh: 'private-refresh', expires: 0 } });
  f.fetcher.mockResolvedValueOnce(Response.json({ error: 'private-refresh' }, { status: 401 }));
  await expect(f.auth.getAuth()).rejects.toThrow(/sign in/i);
  expect(f.state().credential).toBeUndefined();
  expect(JSON.stringify(await f.auth.status())).not.toContain('private-refresh');
});
it.each([
  { device_auth_id: 'private-id', user_code: 'CODE', interval: 'no' },
  { access_token: 'private-token' },
])('rejects malformed device data without leaking it', async (payload) => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(Response.json(payload));
  await expect(f.auth.start()).rejects.toThrow(/sign-in/i);
  expect((await f.auth.status()).state).toBe('signed-out');
});
it('cancels an in-flight exchange without publishing a late signed-in account', async () => {
  const f = setup();
  f.fetcher.mockResolvedValueOnce(device());
  await f.auth.start();
  f.advance(5000);
  let release!: (response: Response) => void;
  f.fetcher.mockResolvedValueOnce(
    Response.json({ authorization_code: 'private-code', code_verifier: 'private-verifier' }),
  );
  f.fetcher.mockImplementationOnce(
    async () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const poll = f.auth.poll();
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const cancel = f.auth.cancel();
  release(tokens());
  await Promise.all([poll, cancel]);
  expect((await f.auth.status()).state).toBe('signed-out');
  expect(f.state().credential).toBeUndefined();
});
it.each(['offline', 'rate-limit', 'server-error'])(
  'preserves credentials after a transient %s refresh failure and retries later',
  async (failure) => {
    const f = setup();
    await f.options.write({
      credential: { access: jwt('old'), refresh: 'still-valid-refresh', expires: 0 },
    });
    if (failure === 'offline') f.fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else
      f.fetcher.mockResolvedValueOnce(
        Response.json({ error: 'unavailable' }, { status: failure === 'rate-limit' ? 429 : 500 }),
      );
    await expect(f.auth.getAuth()).rejects.toThrow(/try again/i);
    expect(f.state().credential?.refresh).toBe('still-valid-refresh');
    f.fetcher.mockResolvedValueOnce(tokens());
    expect(await f.auth.getAuth()).toEqual({ apiKey: jwt() });
  },
);
