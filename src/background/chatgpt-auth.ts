import type { ChatGPTStatus } from '../shared/types';

// Browser-safe equivalent of Pi 1.4.0's Codex device flow. Its OAuth helper
// imports a Node callback server, so it cannot run in a Manifest V3 worker.
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTH = 'https://auth.openai.com';
const STORAGE_KEY = 'chatgpt-auth';
export interface AuthState {
  credential?: { access: string; refresh: string; expires: number };
  pending?: {
    deviceId: string;
    userCode: string;
    expiresAt: number;
    interval: number;
    nextPollAt: number;
  };
  error?: string;
}
interface AuthDependencies {
  read(): Promise<AuthState>;
  write(state: AuthState): Promise<void>;
  fetch: typeof fetch;
  now(): number;
  lock<T>(fn: () => Promise<T>): Promise<T>;
}
function accountId(token: string): string | undefined {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const id = payload?.['https://api.openai.com/auth']?.chatgpt_account_id;
    return typeof id === 'string' && id.length > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}
class TokenRejected extends Error {}
export function createChatGPTAuth(deps: AuthDependencies) {
  let loginGeneration = 0;
  const post = (path: string, body: Record<string, string>, form = false) =>
    deps.fetch(`${AUTH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body) : JSON.stringify(body),
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    });
  const token = async (body: Record<string, string>) => {
    const response = await post('/oauth/token', { client_id: CLIENT_ID, ...body }, true);
    if (!response.ok) {
      const value = await response.json().catch(() => ({}));
      const code = typeof value?.error === 'object' ? value.error?.code : value?.error;
      if (
        response.status === 401 ||
        response.status === 403 ||
        code === 'invalid_grant' ||
        code === 'invalid_refresh_token'
      )
        throw new TokenRejected('Token rejected.');
      throw new Error('Token exchange unavailable.');
    }
    const value = await response.json();
    if (
      typeof value.access_token !== 'string' ||
      !accountId(value.access_token) ||
      typeof value.refresh_token !== 'string' ||
      !value.refresh_token ||
      typeof value.expires_in !== 'number' ||
      !Number.isFinite(value.expires_in) ||
      value.expires_in <= 0
    )
      throw new Error('Invalid token response.');
    return {
      access: value.access_token as string,
      refresh: value.refresh_token as string,
      expires: deps.now() + value.expires_in * 1000,
    };
  };
  const statusOf = (state: AuthState): ChatGPTStatus =>
    state.pending
      ? {
          state: 'pending',
          userCode: state.pending.userCode,
          expiresAt: state.pending.expiresAt,
          nextPollAt: state.pending.nextPollAt,
        }
      : {
          state: state.credential ? 'signed-in' : 'signed-out',
          ...(state.error ? { error: state.error } : {}),
        };
  const read = async () => {
    const state = await deps.read();
    if (state.pending && deps.now() >= state.pending.expiresAt) {
      delete state.pending;
      state.error = 'Device code expired. Sign in with ChatGPT again.';
      await deps.write(state);
    }
    return state;
  };
  return {
    status: () => deps.lock(async () => statusOf(await read())),
    start: () =>
      deps.lock(async () => {
        const generation = loginGeneration;
        const state = await read();
        if (state.pending) return statusOf(state);
        try {
          const response = await post('/api/accounts/deviceauth/usercode', {
            client_id: CLIENT_ID,
          });
          if (!response.ok) throw new Error('Device sign-in unavailable.');
          const value = await response.json();
          const interval = Number(value.interval);
          if (
            typeof value.device_auth_id !== 'string' ||
            !value.device_auth_id ||
            typeof value.user_code !== 'string' ||
            !value.user_code ||
            value.user_code.length > 100 ||
            !['string', 'number'].includes(typeof value.interval) ||
            !Number.isFinite(interval) ||
            interval < 0 ||
            interval > 900
          )
            throw new Error('Invalid device response.');
          if (generation !== loginGeneration) return statusOf(await deps.read());
          state.pending = {
            deviceId: value.device_auth_id,
            userCode: value.user_code,
            expiresAt: deps.now() + 15 * 60_000,
            interval: Math.max(5, interval) * 1000,
            nextPollAt: deps.now() + Math.max(5, interval) * 1000,
          };
          delete state.error;
          await deps.write(state);
          return statusOf(state);
        } catch {
          throw new Error(
            'ChatGPT sign-in could not start. Check your connection and enable device-code login in your ChatGPT account or workspace.',
          );
        }
      }),
    poll: () =>
      deps.lock(async () => {
        const generation = loginGeneration;
        const state = await read();
        const pending = state.pending;
        if (!pending || deps.now() < pending.nextPollAt) return statusOf(state);
        // Persist before the request so a restarted worker also respects the interval.
        pending.nextPollAt = deps.now() + pending.interval;
        await deps.write(state);
        try {
          const response = await post('/api/accounts/deviceauth/token', {
            device_auth_id: pending.deviceId,
            user_code: pending.userCode,
          });
          if (!response.ok) {
            const value = await response.json().catch(() => ({}));
            const code = typeof value.error === 'object' ? value.error?.code : value.error;
            if (code === 'slow_down') {
              pending.interval += 5000;
              pending.nextPollAt = deps.now() + pending.interval;
            } else if (
              code !== 'deviceauth_authorization_pending' &&
              response.status !== 403 &&
              response.status !== 404
            ) {
              throw new Error('Device authorization failed.');
            }
          } else {
            const value = await response.json();
            if (
              typeof value.authorization_code !== 'string' ||
              !value.authorization_code ||
              typeof value.code_verifier !== 'string' ||
              !value.code_verifier
            )
              throw new Error('Invalid device authorization.');
            state.credential = await token({
              grant_type: 'authorization_code',
              code: value.authorization_code,
              code_verifier: value.code_verifier,
              redirect_uri: `${AUTH}/deviceauth/callback`,
            });
            delete state.pending;
            delete state.error;
          }
        } catch {
          delete state.pending;
          state.error = 'ChatGPT sign-in failed. Try signing in again.';
        }
        if (generation !== loginGeneration) return statusOf(await deps.read());
        await deps.write(state);
        return statusOf(state);
      }),
    cancel: () => {
      ++loginGeneration;
      return deps.lock(async () => {
        const state = await deps.read();
        delete state.pending;
        delete state.error;
        await deps.write(state);
        return statusOf(state);
      });
    },
    signOut: () => {
      ++loginGeneration;
      return deps.lock(async () => {
        await deps.write({});
        return { state: 'signed-out' as const };
      });
    },
    getAuth: () =>
      deps.lock(async () => {
        const state = await deps.read();
        if (!state.credential) throw new Error('Sign in with ChatGPT in Settings first.');
        if (state.credential.expires <= deps.now() + 60_000) {
          try {
            state.credential = await token({
              grant_type: 'refresh_token',
              refresh_token: state.credential.refresh,
            });
          } catch (error) {
            if (error instanceof TokenRejected) {
              delete state.credential;
              state.error = 'ChatGPT session expired. Sign in again in Settings.';
              await deps.write(state);
              throw new Error(state.error);
            }
            throw new Error(
              'ChatGPT could not refresh the session. Check your connection and try again.',
            );
          }
          delete state.error;
          await deps.write(state);
        }
        return { apiKey: state.credential.access };
      }),
  };
}
export const chatGPTAuth = createChatGPTAuth({
  read: async () => (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || {},
  write: async (state) => {
    await chrome.storage.local.set({ [STORAGE_KEY]: state });
  },
  fetch: (...args) => globalThis.fetch(...args),
  now: () => Date.now(),
  lock: async (fn) => await navigator.locks.request('pi-x-chatgpt-auth', fn),
});
