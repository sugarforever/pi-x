import { afterEach, expect, it, vi } from 'vitest';
import { captureScreenshot, cropBounds } from '../src/background/screenshot';
afterEach(() => vi.unstubAllGlobals());
it('converts viewport CSS coordinates to image pixels and clips to the viewport', () => {
  expect(cropBounds({ x: 80, y: 10, width: 50, height: 20 }, 100, 60, 200, 120)).toEqual({
    x: 160,
    y: 20,
    width: 40,
    height: 40,
  });
  expect(() => cropBounds({ x: 120, y: 0, width: 10, height: 10 }, 100, 60, 200, 120)).toThrow(
    'outside',
  );
  expect(() => cropBounds({ x: 0, y: 0, width: -1, height: 10 }, 100, 60, 200, 120)).toThrow();
});
it('rejects restricted pages before capturing', async () => {
  vi.stubGlobal('chrome', {
    tabs: { get: async () => ({ id: 5, url: 'chrome://settings', windowId: 1 }) },
  });
  await expect(captureScreenshot({ tabId: 5 })).rejects.toThrow();
});
it('restores the previous tab after capture fails without closing user tabs', async () => {
  let active = 9;
  const remove = vi.fn();
  const update = vi.fn(async (id) => {
    active = id;
  });
  vi.stubGlobal('chrome', {
    tabs: {
      get: async () => ({ id: 5, url: 'https://example.com/', windowId: 1 }),
      query: async () => [{ id: active }],
      update,
      remove,
      captureVisibleTab: async () => {
        throw new Error('Capture denied');
      },
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            url: 'https://example.com/',
            title: 'Example',
            viewportWidth: 100,
            viewportHeight: 100,
            rect: { x: 0, y: 0, width: 100, height: 100 },
          },
        },
      ],
    },
  });
  await expect(captureScreenshot({ tabId: 5 })).rejects.toThrow('Capture denied');
  expect(active).toBe(9);
  expect(remove).not.toHaveBeenCalled();
});
it('closes a temporary URL tab on failure and restores the prior active tab', async () => {
  let active = 9;
  const remove = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('chrome', {
    tabs: {
      create: async () => ({ id: 5 }),
      get: async () => ({ id: 5, url: 'https://example.com/', status: 'complete', windowId: 1 }),
      query: async () => [{ id: active }],
      update: async (id: number) => {
        active = id;
      },
      remove,
      captureVisibleTab: async () => {
        throw new Error('Capture denied');
      },
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            url: 'https://example.com/',
            title: 'Example',
            viewportWidth: 100,
            viewportHeight: 100,
            rect: { x: 0, y: 0, width: 100, height: 100 },
          },
        },
      ],
    },
  });
  await expect(captureScreenshot({ url: 'https://example.com/' })).rejects.toThrow(
    'Capture denied',
  );
  expect(active).toBe(9);
  expect(remove).toHaveBeenCalledWith(5);
});
it('discards captures when the user switches tabs', async () => {
  let queries = 0;
  const capture = vi.fn().mockResolvedValue('data:image/png;base64,unused');
  vi.stubGlobal('chrome', {
    tabs: {
      get: async () => ({ id: 5, url: 'https://example.com/', windowId: 1 }),
      query: async () => [{ id: ++queries <= 2 ? (queries === 1 ? 9 : 5) : 10 }],
      update: async () => {},
      captureVisibleTab: capture,
    },
    scripting: {
      executeScript: async () => [
        {
          result: {
            url: 'https://example.com/',
            title: 'Example',
            viewportWidth: 100,
            viewportHeight: 100,
            rect: { x: 0, y: 0, width: 100, height: 100 },
          },
        },
      ],
    },
  });
  await expect(captureScreenshot({ tabId: 5 })).rejects.toThrow('tab changed');
  expect(capture).toHaveBeenCalledOnce();
});
