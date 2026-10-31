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
it('opens browser OAuth with PKCE and exchanges only the matching callback after a restart', async () => {
  const f = setup();
  let opened = '';
  const options = {
    ...f.options,
    createTab: async () => 42,
    navigateTab: async (_id: number, url: string) => {
      opened = url;
    },
  };
  const auth = createChatGPTAuth(options);
  const status = await auth.startBrowser();
  expect(status).toMatchObject({ state: 'pending', method: 'browser' });
  const url = new URL(opened);
  expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toHaveLength(43);
  const state = url.searchParams.get('state')!;
  const restarted = createChatGPTAuth(options);
  expect(
    await restarted.completeBrowser(
      99,
      `http://localhost:1455/auth/callback?code=secret-code&state=${state}`,
    ),
  ).toBe(false);
  expect(
    await restarted.completeBrowser(
      42,
      `https://evil.example/auth/callback?code=secret-code&state=${state}`,
    ),
  ).toBe(false);
  expect(
    await restarted.completeBrowser(
      42,
      'http://localhost:1455/auth/callback?code=secret-code&state=wrong',
    ),
  ).toBe(false);
  expect(f.fetcher).not.toHaveBeenCalled();
  f.fetcher.mockResolvedValueOnce(tokens());
  expect(
    await restarted.completeBrowser(
      42,
      `http://localhost:1455/auth/callback?code=secret-code&state=${state}`,
    ),
  ).toBe(true);
  expect((await restarted.status()).state).toBe('signed-in');
  const params = new URLSearchParams(String(f.fetcher.mock.calls[0][1]?.body));
  expect(params.get('code')).toBe('secret-code');
  expect(params.get('code_verifier')).toHaveLength(43);
  expect(params.get('redirect_uri')).toBe('http://localhost:1455/auth/callback');
  const challenge = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(params.get('code_verifier')!)),
  );
  expect(
    btoa(String.fromCharCode(...challenge))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, ''),
  ).toBe(url.searchParams.get('code_challenge'));
  expect(JSON.stringify(await restarted.status())).not.toMatch(/secret-code|signature|verifier/);
  expect(
    await restarted.completeBrowser(
      42,
      `http://localhost:1455/auth/callback?code=secret-code&state=${state}`,
    ),
  ).toBe(false);
});
it('expires or cancels browser sign-in and ignores late callbacks', async () => {
  const f = setup();
  let opened = '';
  const auth = createChatGPTAuth({
    ...f.options,
    createTab: async () => 42,
    navigateTab: async (_id, url) => {
      opened = url;
    },
  });
  await auth.startBrowser();
  const state = new URL(opened).searchParams.get('state');
  f.advance(15 * 60_000);
  expect(
    await auth.completeBrowser(
      42,
      `http://localhost:1455/auth/callback?code=secret-code&state=${state}`,
    ),
  ).toBe(false);
  expect((await auth.status()).state).toBe('signed-out');
  await auth.startBrowser();
  await auth.cancel();
  expect(
    await auth.completeBrowser(
      42,
      `http://localhost:1455/auth/callback?code=secret-code&state=${new URL(opened).searchParams.get('state')}`,
    ),
  ).toBe(false);
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('clears browser authorization when the sign-in tab closes or authorization is declined', async () => {
  const f = setup();
  let opened = '';
  const auth = createChatGPTAuth({
    ...f.options,
    createTab: async () => 42,
    navigateTab: async (_id, url) => {
      opened = url;
    },
  });
  await auth.startBrowser();
  await auth.closeBrowser(99);
  expect((await auth.status()).state).toBe('pending');
  await auth.closeBrowser(42);
  expect(await auth.status()).toMatchObject({
    state: 'signed-out',
    error: expect.stringMatching(/closed/i),
  });
  await auth.startBrowser();
  const state = new URL(opened).searchParams.get('state');
  expect(
    await auth.completeBrowser(
      42,
      `http://localhost:1455/auth/callback?state=${state}&error=access_denied&error_description=private-data`,
    ),
  ).toBe(true);
  expect(await auth.status()).toMatchObject({
    state: 'signed-out',
    error: expect.stringMatching(/failed/i),
  });
  expect(JSON.stringify(await auth.status())).not.toContain('private-data');
  expect(f.fetcher).not.toHaveBeenCalled();
});
it('does not retain a browser credential when cancelled during token exchange', async () => {
  const f = setup();
  let opened = '';
  const auth = createChatGPTAuth({
    ...f.options,
    createTab: async () => 42,
    navigateTab: async (_id, url) => {
      opened = url;
    },
  });
  await auth.startBrowser();
  let release!: (response: Response) => void;
  f.fetcher.mockImplementationOnce(
    async () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const callback = auth.completeBrowser(
    42,
    `http://localhost:1455/auth/callback?state=${new URL(opened).searchParams.get('state')}&code=private-code`,
  );
  await vi.waitFor(() => expect(release).toBeTypeOf('function'));
  const cancel = auth.cancel();
  release(tokens());
  await Promise.all([callback, cancel]);
  expect((await auth.status()).state).toBe('signed-out');
  expect(f.state().credential).toBeUndefined();
});
