import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const page = await browser.newPage();
  const css = await readFile('src/sidepanel/sidepanel.css', 'utf8');
  for (const [width, height] of [
    [860, 720],
    [340, 850],
    [860, 480],
  ]) {
    await page.setViewportSize({ width, height });
    await page.setContent(
      `<style>${css}</style><figure class="inline-drawing"><figcaption>Drawing · Complete circle</figcaption><svg viewBox="0 0 500 500" role="img" aria-label="Complete circle"><circle cx="250" cy="250" r="220" fill="none" stroke="#285e57" stroke-width="2" /></svg><button>Open preview ↗</button></figure>`,
    );
    const svg = await page.locator('.inline-drawing > svg').boundingBox();
    assert(
      svg.height <= Math.min(360, height * 0.45) + 1,
      `Drawing must fit a compact height at ${width}x${height}; got ${svg.height}`,
    );
    assert(
      await page.locator('.inline-drawing').evaluate((el) => el.scrollWidth <= el.clientWidth),
      'No horizontal overflow',
    );
    const circle = await page.locator('svg circle').boundingBox();
    assert(
      circle.x >= svg.x &&
        circle.y >= svg.y &&
        circle.x + circle.width <= svg.x + svg.width &&
        circle.y + circle.height <= svg.y + svg.height,
      'The whole drawing stays inside the SVG viewport',
    );
  }
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/inline-drawing-compact.png' });
  console.log('Inline drawing layout passed: wide, narrow and short windows.');
} finally {
  await browser.close();
}
