import { researchUrl } from '../shared/urls';
import { waitForPage } from './browser-page';

export interface ScreenshotArea {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface ScreenshotRequest {
  tabId?: number;
  url?: string;
  selector?: string;
  area?: ScreenshotArea;
}
export interface ScreenshotResult {
  url: string;
  title: string;
  width: number;
  height: number;
  area: ScreenshotArea;
  data: string;
  mimeType: 'image/png';
}
export function cropBounds(area: ScreenshotArea, vw: number, vh: number, iw: number, ih: number) {
  if (
    ![area.x, area.y, area.width, area.height, vw, vh, iw, ih].every(Number.isFinite) ||
    area.width <= 0 ||
    area.height <= 0 ||
    vw <= 0 ||
    vh <= 0 ||
    iw <= 0 ||
    ih <= 0
  )
    throw new Error('Invalid screenshot area.');
  const x = Math.max(0, Math.floor((area.x * iw) / vw));
  const y = Math.max(0, Math.floor((area.y * ih) / vh));
  const right = Math.min(iw, Math.ceil(((area.x + area.width) * iw) / vw));
  const bottom = Math.min(ih, Math.ceil(((area.y + area.height) * ih) / vh));
  if (right <= x || bottom <= y)
    throw new Error('Screenshot area is outside the visible viewport.');
  return { x, y, width: right - x, height: bottom - y };
}

export async function captureScreenshot(
  request: ScreenshotRequest,
  defaultTabId?: number,
  signal?: AbortSignal,
): Promise<ScreenshotResult> {
  if (request.url && request.tabId !== undefined)
    throw new Error('Specify a URL or tab ID, not both.');
  if (request.selector && request.area)
    throw new Error('Specify a selector or rectangle, not both.');
  signal?.throwIfAborted();
  let ownedTabId: number | undefined;
  let tabId: number | undefined;
  let previousId: number | undefined;
  let windowId: number | undefined;
  const close = () => {
    if (ownedTabId !== undefined) void chrome.tabs.remove(ownedTabId).catch(() => {});
  };
  try {
    if (request.url) {
      const url = researchUrl(request.url);
      const tab = await chrome.tabs.create({ url: url.href, active: false });
      ownedTabId = tab.id;
      if (ownedTabId === undefined) throw new Error('Could not open screenshot tab.');
      signal?.addEventListener('abort', close, { once: true });
      await waitForPage(ownedTabId, signal);
      tabId = ownedTabId;
    } else {
      tabId =
        request.tabId ??
        (defaultTabId !== undefined && defaultTabId >= 0 ? defaultTabId : undefined);
      if (tabId === undefined)
        tabId = (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
    }
    if (tabId === undefined) throw new Error('No page is available to capture.');
    const tab = await chrome.tabs.get(tabId);
    researchUrl(tab.url || '');
    windowId = tab.windowId;
    previousId = (await chrome.tabs.query({ active: true, windowId }))[0]?.id;
    await chrome.tabs.update(tabId, { active: true });
    signal?.throwIfAborted();
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      args: [request.selector || '', request.area || null],
      func: async (selector: string, area: ScreenshotArea | null) => {
        let element: Element | null = null;
        if (selector) {
          element = document.querySelector(selector);
          if (!element) throw new Error('No element matches the screenshot selector.');
          element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        }
        // Allow the selected tab and any scrolled element to paint before capture.
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 1500);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              clearTimeout(timeout);
              resolve();
            }),
          );
        });
        const bounds = element?.getBoundingClientRect();
        const rect =
          area ||
          (bounds
            ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
            : { x: 0, y: 0, width: innerWidth, height: innerHeight });
        return {
          url: location.href,
          title: document.title,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          rect,
        };
      },
    });
    const page = results[0]?.result;
    if (!page) throw new Error('Could not measure the screenshot area.');
    researchUrl(page.url);
    const verifyTarget = async () => {
      signal?.throwIfAborted();
      const current = (await chrome.tabs.query({ active: true, windowId }))[0];
      const target = await chrome.tabs.get(tabId!);
      if (current?.id !== tabId || target.url !== page.url)
        throw new Error('The tab changed during capture. Retry the screenshot.');
    };
    await verifyTarget();
    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    await verifyTarget();
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    try {
      const crop = cropBounds(
        page.rect,
        page.viewportWidth,
        page.viewportHeight,
        bitmap.width,
        bitmap.height,
      );
      const scale = Math.min(1, 1600 / Math.max(crop.width, crop.height));
      const width = Math.max(1, Math.round(crop.width * scale));
      const height = Math.max(1, Math.round(crop.height * scale));
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Screenshot cropping is unavailable.');
      context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer(),
      );
      let binary = '';
      for (let i = 0; i < bytes.length; i += 8192)
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      signal?.throwIfAborted();
      return {
        url: page.url,
        title: page.title,
        width,
        height,
        area: page.rect,
        mimeType: 'image/png',
        data: btoa(binary),
      };
    } finally {
      bitmap.close();
    }
  } finally {
    signal?.removeEventListener('abort', close);
    if (windowId !== undefined && previousId !== undefined && previousId !== tabId) {
      const active = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
      if (active[0]?.id === tabId)
        await chrome.tabs.update(previousId, { active: true }).catch(() => {});
    }
    if (ownedTabId !== undefined) await chrome.tabs.remove(ownedTabId).catch(() => {});
  }
}
