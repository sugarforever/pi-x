import type { Job, Post } from '../shared/types';
import { xPostUrl } from '../shared/urls';
export async function readConversation(
  job: Job,
  target?: string,
  signal?: AbortSignal,
): Promise<Post[]> {
  const url = xPostUrl(target || job.post.url);
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new Error('Could not open conversation context.');
  const tabId = tab.id;
  try {
    const end = Date.now() + 18000;
    while (Date.now() < end) {
      signal?.throwIfAborted();
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'context:read', url });
        if (result?.ok && Array.isArray(result.posts) && result.posts.length) return result.posts;
      } catch {
        /* X and the isolated content script may still be loading. */
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    throw new Error(
      'Could not read the conversation. X may require login or the post may be unavailable.',
    );
  } finally {
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}
