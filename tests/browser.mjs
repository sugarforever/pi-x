import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { unzipSync } from 'fflate';

const executablePath = process.env.CHROMIUM_PATH;
const root = await mkdtemp(join(tmpdir(), 'pi-x-browser-'));
const extension = join(root, 'extension');
if (process.argv.includes('--release')) {
  const { version } = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
  const entries = unzipSync(await readFile(resolve('release', `pi-x-v${version}.zip`)));
  await mkdir(extension, { recursive: true });
  for (const [name, bytes] of Object.entries(entries)) {
    assert(
      !name.includes('/') && !name.includes('\\') && name !== '.' && name !== '..',
      'Release assets must be at the archive root',
    );
    await writeFile(join(extension, name), bytes);
  }
} else await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions.push('http://127.0.0.1/*', 'https://*/*');
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
let requests = [];
let delay = 0;
const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(404).end();
    return;
  }
  let body = '';
  for await (const data of req) body += data;
  const data = JSON.parse(body);
  requests.push(data);
  if (delay) await new Promise((r) => setTimeout(r, delay));
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const last = data.messages.at(-1);
  const tool = data.tools?.find((t) => t.function.name === 'writing_examples');
  const call = (name, args) => ({
    content: null,
    tool_calls: [
      {
        index: 0,
        id: 'tool-' + name,
        type: 'function',
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  });
  const names = (data.tools || []).map((t) => t.function.name);
  let payload;
  if (tool)
    payload =
      last.role !== 'tool'
        ? call('writing_examples', { query: 'coding' })
        : { content: '用自己的语气写作。' };
  else if (names.includes('conversation_context')) {
    payload =
      last.role !== 'tool'
        ? call('conversation_context', {})
        : last.tool_call_id === 'tool-conversation_context'
          ? call('read_article', { url: 'https://evidence.example.org/article' })
          : { content: 'Contextual draft' };
  } else if (names.includes('web_search')) {
    payload =
      last.role !== 'tool'
        ? call('web_search', { query: 'primary evidence' })
        : last.tool_call_id === 'tool-web_search'
          ? call('read_article', { url: 'https://evidence.example.org/article' })
          : { content: 'Research draft' };
  } else payload = { content: '这是一段中文草稿。' };
  res.end(
    `data: ${JSON.stringify({ id: 'response', model: 'fixture-model', choices: [{ index: 0, delta: { role: 'assistant', ...payload }, finish_reason: payload.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`,
  );
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
const context = await chromium.launchPersistentContext(join(root, 'profile'), {
  headless: true,
  ...(executablePath ? { executablePath } : { channel: 'chromium' }),
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
context.setDefaultTimeout(12000);
const errors = [];
context.on('weberror', (e) => errors.push(e.error().message));
try {
  let worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const id = new URL(worker.url()).host;
  const options = await context.newPage();
  await options.goto(`chrome-extension://${id}/options.html`);
  await options.getByLabel('Base URL', { exact: true }).waitFor();
  console.log('Options opened');
  await options.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await options.getByLabel('Model ID', { exact: true }).fill('fixture-model');
  await options.getByRole('button', { name: 'Save settings' }).click();
  await options.getByText('Settings saved. You’re ready to quote.').waitFor();
  console.log('Settings saved');
  await options.getByRole('button', { name: 'Test connection' }).click();
  await options.getByText('Connection successful.').waitFor();
  console.log('Connection tested');
  await options.locator('nav a[href="#voice"]').click();
  await options.getByRole('button', { name: '+ Add example' }).click();
  await options.getByLabel('Title / topic').fill('Coding');
  await options
    .getByLabel('Writing sample', { exact: true })
    .fill('A private sample about coding.');
  await options.getByRole('button', { name: 'Save settings' }).click();
  await options.getByText('Settings saved. You’re ready to quote.').waitFor();
  await options.screenshot({ path: resolve('test-results/options.png'), fullPage: true });
  await options.setViewportSize({ width: 390, height: 844 });
  assert(
    await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Options must fit mobile width',
  );
  await options.screenshot({ path: resolve('test-results/options-mobile.png'), fullPage: true });
  const fixture = `<!doctype html><html><head><style>body{font:16px system-ui;margin:50px}article{padding:20px;border:1px solid #ddd;width:500px}[role=menu]{padding:10px;background:#eee;width:200px}[role=menuitem]{display:block;padding:15px}[role=dialog]{position:fixed;inset:60px 20%;padding:30px;background:white;border:1px solid #ccc;border-radius:20px}[contenteditable]{min-height:80px;padding:15px;border:1px solid #ddd}</style></head><body><article data-testid="tweet"><div data-testid="User-Name">Author @author</div><a href="/author/status/123"><time>Today</time></a><div data-testid="tweetText">Coding is fun.</div><button data-testid="retweet">Repost menu</button></article><script>
  document.querySelector('[data-testid=retweet]').onclick=()=>{const existing=document.querySelector('[role=menu]');if(existing){existing.hidden=false;return;}const m=document.createElement('div');m.setAttribute('role','menu');m.innerHTML='<button role="menuitem">Repost</button><a role="menuitem" href="/compose/post">Quote</a>';m.querySelector('a').onclick=e=>{e.preventDefault();m.hidden=true;const d=document.createElement('div');d.setAttribute('role','dialog');d.innerHTML='<button id="close">Close</button><h2>Quote</h2><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div><p>Quoted: Coding is fun.</p><button id="post">Post</button>';d.querySelector('#close').onclick=()=>d.remove();document.body.append(d);};document.body.append(m);};</script></body></html>`;
  await context.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const page = await context.newPage();
  await page.goto('https://x.com/home');
  const open = async () => {
    await page.getByRole('button', { name: 'Repost menu' }).click();
    await page.getByRole('menuitem', { name: 'AI Quote' }).click();
    await page.locator('[data-pi-x-composer]').waitFor();
  };
  await open();
  console.log('AI Quote opened');
  const editor = page.getByTestId('tweetTextarea_0');
  await editor.filter({ hasText: '这是一段中文草稿。' }).waitFor();
  assert.equal(await editor.innerText(), '这是一段中文草稿。');
  assert.equal(await page.locator('#post').count(), 1);
  await page.getByLabel('Draft prompt').selectOption('in-my-voice');
  await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await page.getByText('Draft ready. Your editor text has been preserved.').waitFor();
  console.log('Regenerated');
  assert.equal(await editor.innerText(), '这是一段中文草稿。');
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Insert draft', exact: true }).click();
  assert.equal(await editor.innerText(), '用自己的语气写作。');
  await page.screenshot({ path: resolve('test-results/composer.png') });
  await page.locator('#close').click();
  delay = 900;
  await open();
  await editor.fill('My own words');
  await page.waitForTimeout(1800);
  assert.equal(await editor.innerText(), 'My own words');
  await page.locator('#close').click();
  delay = 0;
  // Reuse the same native menu for another post; the model must receive the new source.
  await page.evaluate(() => {
    document.querySelector('time').closest('a').href = '/author/status/456';
    document.querySelector('[data-testid=tweetText]').textContent = 'A different source post.';
  });
  await open();
  await editor.filter({ hasText: '这是一段中文草稿。' }).waitFor();
  assert(
    requests
      .at(-1)
      .messages.some((m) => m.role === 'user' && m.content.includes('A different source post.')),
  );
  await page.locator('#close').click();
  await page.evaluate(() => {
    document.querySelector('time').closest('a').href = '/author/status/123';
    document.querySelector('[data-testid=tweetText]').textContent = 'Coding is fun.';
  });
  // Verify the page cannot read credentials through chrome.storage or privileged RPC.
  const leak = await page.evaluate(() => ({
    storage: typeof chrome.storage,
    rpc: typeof chrome.runtime?.sendMessage,
  }));
  assert.equal(leak.storage, 'undefined');
  assert.equal(leak.rpc, 'undefined');
  // Preview runs through the same durable pipeline, including the writing example tool.
  await options.setViewportSize({ width: 1280, height: 900 });
  await options.getByLabel('Example post', { exact: true }).fill('Coding is fun.');
  await options.getByLabel('Preview prompt', { exact: true }).selectOption('in-my-voice');
  await options.getByRole('button', { name: 'Generate preview' }).click();
  await options.getByText('Draft ready', { exact: true }).waitFor();
  assert.equal(
    await options.getByLabel('Your draft', { exact: true }).inputValue(),
    '用自己的语气写作。',
  );
  assert(
    requests.some((r) =>
      r.messages.some(
        (m) => m.role === 'tool' && m.content.includes('A private sample about coding.'),
      ),
    ),
  );
  // Exercise article extraction in the service worker, conversation tab cleanup, and Brave search.
  // Chrome-created tabs can navigate before Playwright attaches its network fixture.
  // Reload after attachment so this test always supplies the controlled X document.
  context.on('page', async (p) => {
    try {
      await p.waitForLoadState('domcontentloaded', { timeout: 5000 });
      await p.goto('https://x.com/author/status/123');
    } catch {}
  });
  await context.route('https://evidence.example.org/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<html><head><title>Primary evidence</title></head><body><article><h1>Primary evidence</h1><p>' +
        'A controlled study found a measurable improvement. '.repeat(30) +
        '</p></article></body></html>',
    }),
  );
  await context.route('https://api.search.brave.com/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        web: {
          results: [
            {
              title: 'Primary evidence',
              url: 'https://evidence.example.org/article',
              description: 'A controlled study',
            },
          ],
        },
      }),
    }),
  );
  await options.getByText('Research access', { exact: true }).click();
  await options.getByLabel('Allow article reading on HTTPS sites').check();
  await options.getByLabel('Brave Search API key', { exact: true }).fill('fixture-search-key');
  await options.getByRole('button', { name: 'Save settings' }).click();
  await options.getByText('Settings saved. You’re ready to quote.').waitFor();
  await options.getByLabel('X post URL', { exact: false }).fill('https://x.com/author/status/123');
  await options.getByLabel('Preview prompt', { exact: true }).selectOption('in-context');
  await options.getByRole('button', { name: 'Generate preview' }).click();
  await options.waitForFunction(
    () => document.querySelector('#preview-result').value === 'Contextual draft',
  );
  assert.equal(
    context.pages().filter((p) => p.url() === 'https://x.com/author/status/123').length,
    0,
    'Context tab must close',
  );
  assert(
    requests.some((r) =>
      r.messages.some((m) => m.role === 'tool' && m.content.includes('Coding is fun.')),
    ),
  );
  await options.getByLabel('Preview prompt', { exact: true }).selectOption('check-claim');
  await options.getByRole('button', { name: 'Generate preview' }).click();
  await options.waitForFunction(
    () => document.querySelector('#preview-result').value === 'Research draft',
  );
  assert(
    requests.some((r) =>
      r.messages.some((m) => m.role === 'tool' && m.content.includes('measurable improvement')),
    ),
  );
  // Turning article access off must be enforced even though Chrome still holds its permission grant.
  await options.getByLabel('Allow article reading on HTTPS sites').uncheck();
  await options.getByRole('button', { name: 'Save settings' }).click();
  await options.getByText('Settings saved. You’re ready to quote.').waitFor();
  await options.getByRole('button', { name: 'Generate preview' }).click();
  await options
    .getByText('Enable article access in settings for this prompt.', { exact: true })
    .waitFor();
  // A cancelled dialog must not receive a late completion.
  delay = 1200;
  await open();
  await page.locator('#close').click();
  await page.waitForTimeout(1600);
  delay = 0;
  assert.equal(await page.locator('[data-pi-x-composer]').count(), 0);
  const jobs = await worker.evaluate(async () =>
    Object.values(await chrome.storage.local.get(null)).filter(
      (v) => v && typeof v === 'object' && 'status' in v,
    ),
  );
  assert(jobs.some((j) => j.status === 'cancelled'));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    `Browser checks passed: settings, connection, responsive layout, AI Quote menu/dialog/insertion, edit preservation, credential boundary, all four research tools, article-access preference, dialog cancellation. ${requests.length} API requests.`,
  );
} catch (error) {
  for (const p of context.pages())
    console.error(
      'Page diagnostic',
      p.url(),
      await p
        .evaluate(() => ({
          save: document.querySelector('#save-status')?.textContent,
          connection: document.querySelector('#connection-status')?.textContent,
          status: document.querySelector('[data-pi-x-composer]')?.shadowRoot?.textContent,
          preview: document.querySelector('#preview-status')?.textContent,
        }))
        .catch(() => ''),
    );
  throw error;
} finally {
  await context.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
