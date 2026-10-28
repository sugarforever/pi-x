import type { Job, Post } from '../shared/types';
import { xPostUrl } from '../shared/urls';
export async function readConversation(
  job: Pick<Job, 'post'>,
  target?: string,
  signal?: AbortSignal,
): Promise<Post[]> {
  if (!target && !job.post)
    throw new Error('Provide an X post URL to read conversation context for an original tweet.');
  const url = xPostUrl(target || job.post!.url);
  const tab = await chrome.tabs.create({ url, active: false });
  if (tab.id === undefined) throw new Error('Could not open conversation context.');
  const tabId = tab.id;
  try {
    const end = Date.now() + 18000;
    while (Date.now() < end) {
      signal?.throwIfAborted();
      try {
        const result = await chrome.tabs.sendMessage(tabId, { type: 'context:read', url });
        if (
          result?.ok &&
          Array.isArray(result.posts) &&
          result.posts.length &&
          result.posts.some((p: Post) => p.url === url && !p.truncated)
        )
          return result.posts;
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

export async function resolveSourcePost(
  job: Pick<Job, 'post'>,
  signal?: AbortSignal,
): Promise<Post | undefined> {
  const post = job.post;
  if (!post || (!post.truncated && !/(?:…|\.\.\.)\s*$/.test(post.text))) return post;
  const posts = await readConversation(job, post.url, signal);
  const full = posts.find((candidate) => candidate.id === post.id && !candidate.truncated);
  if (!full || (post.truncated && full.text === post.text))
    throw new Error(
      'Could not read the full source post. Open its permalink in Chrome, expand Show more, then retry Pi Quote.',
    );
  return full;
}
