import { afterEach, expect, it, vi } from 'vitest';
import { resolveSourcePost } from '../src/background/context';
afterEach(() => vi.unstubAllGlobals());
it('replaces a collapsed source with its detail-page full text before writing', async () => {
  const post = {
    id: '123',
    url: 'https://x.com/author/status/123',
    author: 'author',
    text: 'Beginning…',
    links: [],
    truncated: true,
  };
  const full = { ...post, text: 'Beginning and the full final paragraph.', truncated: false };
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      create: async () => ({ id: 9 }),
      sendMessage: async () => ({ ok: true, posts: [full] }),
      remove,
    },
  });
  expect(await resolveSourcePost({ post })).toEqual(full);
  expect(remove).toHaveBeenCalledWith(9);
});
it('does not accept a still-collapsed source as the full post', async () => {
  vi.useFakeTimers();
  const post = {
    id: '123',
    url: 'https://x.com/author/status/123',
    author: 'author',
    text: 'Beginning…',
    links: [],
    truncated: true,
  };
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      create: async () => ({ id: 9 }),
      sendMessage: async () => ({ ok: true, posts: [post] }),
      remove,
    },
  });
  const rejected = expect(resolveSourcePost({ post })).rejects.toThrow('Could not read');
  await vi.runAllTimersAsync();
  await rejected;
  expect(remove).toHaveBeenCalledWith(9);
  vi.useRealTimers();
});
