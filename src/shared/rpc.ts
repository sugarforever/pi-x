import type { Reply } from './types';
export class RpcTransportError extends Error {}
export async function rpc<T>(message: unknown): Promise<T> {
  let reply: Reply<T>;
  try {
    reply = await chrome.runtime.sendMessage(message);
  } catch {
    throw new RpcTransportError(
      'Extension connection lost. Refresh this page after reloading the extension.',
    );
  }
  if (!reply?.ok) throw new Error(reply?.error || 'Extension request failed.');
  return reply.value as T;
}
