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
let toolPageUrl = 'https://x.com/author/status/123';
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
  const call = (name, args) => {
    if (name === 'conversation_context') toolPageUrl = 'https://x.com/author/status/123';
    if (name === 'read_article') toolPageUrl = args.url;
    return {
      content: null,
      tool_calls: [
        {
          index: 0,
          id: 'tool-' + name,
          type: 'function',
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    };
  };
  const names = (data.tools || []).map((t) => t.function.name);
  let payload;
  const policy = data.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const researchRequest = data.messages.some(
    (m) => m.role === 'user' && m.content.includes('Search the web for evidence'),
  );
  const screenshotRequest = data.messages.some(
    (m) =>
      m.role === 'user' &&
      typeof m.content === 'string' &&
      m.content.includes('Inspect a screenshot'),
  );
  if (screenshotRequest) {
    payload = data.messages.some(
      (m) => m.role === 'tool' && m.tool_call_id === 'tool-capture_screenshot',
    )
      ? { content: 'Screenshot draft' }
      : call('capture_screenshot', { selector: '[data-testid="tweetText"]' });
  } else if (
    tool &&
    !researchRequest &&
    (policy.includes('using my writing examples') ||
      policy.includes('Write an original tweet from the user'))
  )
    payload =
      last.role !== 'tool'
        ? call('writing_examples', { query: 'coding' })
        : { content: '用自己的语气写作。' };
  else if (
    names.includes('conversation_context') &&
    policy.includes('Read the conversation context')
  ) {
    payload =
      last.role !== 'tool'
        ? call('conversation_context', {})
        : last.tool_call_id === 'tool-conversation_context'
          ? call('read_article', { url: 'https://evidence.example.org/article' })
          : { content: 'Contextual draft' };
  } else if (
    names.includes('web_search') &&
    (researchRequest || policy.includes('Research the central factual claim'))
  ) {
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
  await options.getByText('All changes saved.').waitFor();
  console.log('Settings saved');
  await options.getByRole('button', { name: 'Test connection' }).click();
  await options.getByText('Connection successful.').waitFor();
  console.log('Connection tested');
  // Exercise subscription UI and the real Codex adapter without a live account.
  await worker.evaluate(() => {
    const original = globalThis.fetch;
    globalThis.__subscriptionFetch = original;
    globalThis.__subscriptionRequests = [];
    const access = `eyJhbGciOiJub25lIn0.${btoa(JSON.stringify({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-browser' } }))}.fixture`;
    globalThis.fetch = async (url, init) => {
      const href = String(url);
      if (
        !href.startsWith('https://auth.openai.com/') &&
        !href.startsWith('https://chatgpt.com/backend-api/')
      )
        return original(url, init);
      globalThis.__subscriptionRequests.push(href);
      if (href.endsWith('/deviceauth/usercode'))
        return Response.json({
          device_auth_id: 'fixture-device',
          user_code: 'TEST-CODE',
          interval: '5',
        });
      if (href.endsWith('/deviceauth/token'))
        return Response.json({
          authorization_code: 'fixture-code',
          code_verifier: 'fixture-verifier',
        });
      if (href.endsWith('/oauth/token'))
        return Response.json({
          access_token: access,
          refresh_token: 'fixture-refresh',
          expires_in: 3600,
        });
      if (href.endsWith('/codex/responses')) {
        if (new Headers(init.headers).get('authorization') !== `Bearer ${access}`)
          throw new Error('Missing subscription auth');
        return new Response(
          `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'resp-browser', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } })}\n\n`,
          { headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      throw new Error('Unexpected subscription endpoint');
    };
  });
  await options.getByLabel('Provider', { exact: true }).selectOption('chatgpt');
  assert.equal(await options.getByLabel('Base URL', { exact: true }).isVisible(), false);
  await options.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click();
  await options.getByText('TEST-CODE', { exact: true }).waitFor();
  await options.reload();
  await options.getByText('TEST-CODE', { exact: true }).waitFor();
  await options.getByText('Signed in with ChatGPT.', { exact: true }).waitFor();
  await options.getByRole('button', { name: 'Test connection', exact: true }).click();
  await options.getByText('Connection successful.', { exact: true }).waitFor();
  assert(
    (await worker.evaluate(() => globalThis.__subscriptionRequests)).includes(
      'https://chatgpt.com/backend-api/codex/responses',
    ),
  );
  const account = await options.evaluate(() =>
    chrome.runtime.sendMessage({ type: 'chatgpt:status' }),
  );
  assert.deepEqual(account.value, { state: 'signed-in' });
  await options.getByRole('button', { name: 'Sign out', exact: true }).click();
  await options.getByText('Signed out.', { exact: true }).waitFor();
  await options.getByLabel('Provider', { exact: true }).selectOption('openai-compatible');
  assert.equal(await options.getByLabel('Base URL', { exact: true }).inputValue(), baseUrl);
  await options.getByText('All changes saved.').waitFor();
  await worker.evaluate(() => {
    globalThis.fetch = globalThis.__subscriptionFetch;
  });
  console.log('Subscription sign-in, reload recovery, connection and sign-out tested');

  await options.locator('nav a[href="#voice"]').click();
  await options.getByRole('button', { name: 'Add sample' }).click();
  await options.getByLabel('Title / topic').fill('Coding');
  await options
    .getByLabel('Writing sample', { exact: true })
    .fill('A private sample about coding.');
  await options.getByText('All changes saved.').waitFor();
  await options.screenshot({ path: resolve('test-results/options.png'), fullPage: true });
  await options.setViewportSize({ width: 390, height: 844 });
  assert(
    await options.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    'Options must fit mobile width',
  );
  await options.screenshot({ path: resolve('test-results/options-mobile.png'), fullPage: true });
  const fixture = `<!doctype html><html><head><style>body{font:16px system-ui;margin:50px}article{padding:20px;border:1px solid #ddd;width:500px}[role=menu]{padding:10px;background:#eee;width:200px}[role=menuitem]{display:block;padding:15px}[role=dialog]{position:fixed;inset:60px 20%;overflow-y:auto;padding:30px;background:white;border:1px solid #ccc;border-radius:20px}[contenteditable]{min-height:80px;padding:15px;border:1px solid #ddd}</style></head><body><main><section id="home-composer"><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div><button data-testid="tweetButtonInline">Post</button></section></main><article data-testid="tweet"><div data-testid="User-Name">Author @author</div><a href="/author/status/123"><time>Today</time></a><div data-testid="tweetText">Coding is fun.</div><button data-testid="retweet">Repost menu</button><button data-testid="reply">Reply</button></article><script>
  document.querySelector('[data-testid=reply]').onclick=()=>{
    const d=document.createElement('div');d.setAttribute('role','dialog');
    d.innerHTML='<button id="close">Close</button><div data-testid="replyingTo">Replying to @author</div><div><button aria-label="Choose audience">Everyone</button></div><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div><button id="post">Reply</button>';
    d.querySelector('#close').onclick=()=>d.remove();document.body.append(d);
  };
  document.querySelector('[data-testid=retweet]').onclick=()=>{
    const existing=document.querySelector('[role=menu]');if(existing){existing.hidden=false;return;}
    const m=document.createElement('div');m.setAttribute('role','menu');
    m.innerHTML='<div data-testid="Dropdown"><button role="menuitem">Repost</button><a role="menuitem" href="/compose/post">Quote</a></div>';
    document.body.append(m);
  };
  // React delegates native actions to its root; a detached link no longer reaches that handler.
  document.body.addEventListener('click',e=>{
    const quote=e.target.closest('a[role=menuitem]');if(!quote)return;
    e.preventDefault();quote.closest('[role=menu]').hidden=true;
    const d=document.createElement('div');d.setAttribute('role','dialog');
    d.innerHTML='<button id="close">Close</button><h2>Quote</h2><div><button aria-label="Choose audience">Everyone</button></div><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div><div data-testid="attachments"><div data-testid="User-Name">Author @author</div><div data-testid="tweetText"></div></div><button id="post">Post</button>';
    const articleTitle=document.querySelector('article [data-testid="twitter-article-title"]');
    if(articleTitle){
      d.querySelector('[data-testid="User-Name"]').textContent=document.querySelector('article[data-testid="tweet"] [data-testid="User-Name"]').textContent;
      d.querySelector('[data-testid=tweetText]').remove();
      const cover=document.createElement('div');cover.dataset.testid='article-cover-image';
      d.querySelector('[data-testid=attachments]').append(cover,articleTitle.textContent);
    }else d.querySelector('[data-testid=tweetText]').textContent=document.querySelector('article [data-testid=tweetText]').textContent;
    d.querySelector('#close').onclick=()=>d.remove();document.body.append(d);
  });
  // X can replace its Quote link after the extension adds Pi Quote.
  new MutationObserver(()=>{
    const ai=document.querySelector('[data-pi-x=quote]');
    const quote=ai?.closest('[role=menu]')?.querySelector('a[role=menuitem]');
    if(quote&&!quote.dataset.replaced){const next=quote.cloneNode(true);next.dataset.replaced='true';quote.replaceWith(next);}
  }).observe(document.body,{childList:true,subtree:true});
  if(location.pathname==='/compose/post'){
    const d=document.createElement('div');d.setAttribute('role','dialog');
    d.innerHTML='<button id="close">Close</button><h2>New post</h2><div data-testid="tweetTextarea_0" role="textbox" contenteditable="true"></div><button id="post">Post</button>';
    d.querySelector('#close').onclick=()=>d.remove();document.body.append(d);
  }
  </script></body></html>`;
  await context.route('https://x.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: fixture }),
  );
  const page = await context.newPage();
  await page.goto('https://x.com/home');
  const feedEditor = page.locator('#home-composer').getByTestId('tweetTextarea_0');
  await page.getByRole('button', { name: 'Write with AI', exact: true }).waitFor();
  const beforeFeed = requests.length;
  await feedEditor.fill('My rough notes from building an extension');
  await page.getByRole('button', { name: 'Write with AI', exact: true }).click();
  const feedPanel = await context.newPage();
  await feedPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await feedPanel.locator('#workspace').waitFor();
  assert.equal(
    requests.length,
    beforeFeed,
    'Launcher must not call model before user sends a brief',
  );
  assert.equal(page.url(), 'https://x.com/home');
  await feedPanel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Turn my notes into a short tweet');
  await feedPanel.getByRole('button', { name: 'Send message' }).click();
  await feedPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await feedEditor.innerText(), 'My rough notes from building an extension');
  assert(
    requests.some((r) =>
      r.messages.some(
        (m) => m.role === 'user' && m.content.includes('My rough notes from building an extension'),
      ),
    ),
  );
  await feedPanel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(await feedEditor.innerText(), '用自己的语气写作。');
  const reapply = feedPanel.getByRole('button', { name: 'Apply again to draft', exact: true });
  await reapply.waitFor();
  assert.equal(await reapply.innerText(), '✓ Inserted');
  await reapply.click();
  await feedEditor.fill('');
  await reapply.click();
  assert.equal(await feedEditor.innerText(), '用自己的语气写作。');
  await feedPanel.getByRole('button', { name: 'History', exact: true }).click();
  await feedPanel.locator('.history-item').first().waitFor();
  await feedPanel.locator('.history-item').first().click();
  await feedPanel.getByRole('button', { name: 'Use draft', exact: true }).waitFor();
  const restoredPageEvent = context.waitForEvent('page');
  await feedPanel.getByRole('button', { name: 'Use draft', exact: true }).click();
  const restoredPage = await restoredPageEvent;
  await restoredPage.waitForURL('https://x.com/compose/post');
  await feedPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await restoredPage.locator('[role=dialog] [contenteditable]').innerText(), '');
  await feedPanel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(
    await restoredPage.locator('[role=dialog] [contenteditable]').innerText(),
    '用自己的语气写作。',
  );
  await restoredPage.close();
  await page.bringToFront();
  console.log('History inspection and reuse verified');
  await page.screenshot({ path: resolve('test-results/feed-composer.png') });
  await feedPanel.close();
  await page.reload();

  const open = async () => {
    await page.getByRole('button', { name: 'Repost menu' }).click();
    await page.getByRole('menuitem', { name: 'Pi Quote' }).click();
    await page.locator('[data-pi-x-composer]').waitFor();
  };
  let navigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navigations++;
  });
  await open();
  assert.equal(navigations, 0, 'Pi Quote must not reload the document');
  assert.equal(
    await page.getByTestId('attachments').getByTestId('tweetText').innerText(),
    'Coding is fun.',
  );
  console.log('Pi Quote opened');
  await page.waitForTimeout(300);
  assert(
    requests.some(
      (r) => r.tools?.length === 5 && r.tools.some((t) => t.function.name === 'capture_screenshot'),
    ),
    'Every generation exposes all session tools',
  );
  assert.equal(
    await options.locator('[role=switch]').count(),
    2,
    'Behavior preferences are available',
  );
  const editor = page.locator('[role=dialog]').getByTestId('tweetTextarea_0');
  assert.equal(await editor.innerText(), '');
  assert.equal(await page.locator('[data-pi-x-refinement]').count(), 0);
  assert.equal(
    await page.locator('[data-pi-x-composer] textarea,[data-pi-x-composer] select').count(),
    0,
  );
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  // An extension-page tab exercises the same panel bundle and bridge. Keep X as the active
  // browser tab, as it is when the native side panel is open alongside X.
  await page.bringToFront();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(await editor.innerText(), '这是一段中文草稿。');
  await panel.getByLabel('Draft prompt', { exact: true }).selectOption('in-my-voice');
  await panel.getByRole('textbox', { name: 'Message the agent' }).click();
  await panel.waitForTimeout(1300);
  assert.equal(await panel.getByLabel('Draft prompt', { exact: true }).inputValue(), 'in-my-voice');
  await panel.getByRole('button', { name: 'Regenerate', exact: true }).click();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await editor.innerText(), '这是一段中文草稿。');
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(await editor.innerText(), '用自己的语气写作。');
  await editor.fill('My manual draft');
  const chat = panel.getByRole('textbox', { name: 'Message the agent' });
  await chat.fill('Make it conversational');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await editor.innerText(), 'My manual draft');
  const followup = requests.find((r) =>
    r.messages.some((m) => m.role === 'user' && m.content.includes('Make it conversational')),
  );
  assert(followup.messages.some((m) => m.role === 'user' && m.content.includes('My manual draft')));
  assert(
    followup.messages.some((m) => m.role === 'assistant' && m.content === '用自己的语气写作。'),
  );
  // A page-level focus trap cannot steal focus from a separate extension document.
  await page.evaluate(() =>
    document.addEventListener('focusin', (e) => {
      const editor = document.querySelector('[role=dialog] [contenteditable]');
      if (editor && e.target !== editor) editor.focus();
    }),
  );
  await chat.fill('Keep product names in English');
  assert(await chat.evaluate((t) => t === document.activeElement));
  await panel.waitForTimeout(1500); // Multiple state refreshes must preserve input focus and text.
  assert(await chat.evaluate((t) => t === document.activeElement));
  assert.equal(await chat.inputValue(), 'Keep product names in English');
  assert.equal(
    await panel.locator('.tool-history').count(),
    2,
    'Each generation has its own history',
  );
  assert(
    await panel
      .locator('.tool-history')
      .evaluateAll((groups) =>
        groups.every(
          (group) =>
            group.nextElementSibling?.getAttribute('data-job-id') ===
            group.getAttribute('data-job-id'),
        ),
      ),
    'Tool history belongs immediately before its own response',
  );
  assert.equal(
    await panel
      .locator('.turn-text')
      .first()
      .evaluate((node) => getComputedStyle(node).fontSize),
    '16px',
  );
  const history = panel.locator('.tool-history').first();
  await history.waitFor();
  assert.equal(
    await history.evaluate((node) => node.open),
    false,
    'Tool history is collapsed by default',
  );
  await history.locator(':scope > summary').click();
  const firstCall = history.locator('.tool-entry').first();
  await firstCall.locator('summary').click();
  await panel.waitForTimeout(1300);
  assert.equal(
    await history.evaluate((node) => node.open),
    true,
    'History stays expanded during polling',
  );
  assert.equal(await firstCall.evaluate((node) => node.open), true);
  assert((await firstCall.innerText()).includes('Parameters'));
  assert((await firstCall.innerText()).includes('Result'));
  await panel.screenshot({ path: resolve('test-results/tool-history.png') });
  await history.locator(':scope > summary').click();
  const compact = await panel.evaluate(() => ({
    toolbar: document.querySelector('.toolbar').getBoundingClientRect().height,
    conversation: document.querySelector('#conversation').getBoundingClientRect().height,
    viewport: innerHeight,
  }));
  assert(compact.toolbar <= 52, 'Toolbar must stay compact');
  assert(compact.conversation >= compact.viewport * 0.6, 'Conversation gets most of the panel');
  await panel.screenshot({ path: resolve('test-results/sidepanel.png') });
  const otherWindow = await worker.evaluate(() =>
    chrome.windows.create({ url: 'about:blank', focused: true }),
  );
  await panel.waitForTimeout(1300);
  assert(
    await panel.locator('#workspace').isVisible(),
    'Panel must stay bound to its containing window',
  );
  await worker.evaluate((id) => chrome.windows.remove(id), otherWindow.id);
  await page.bringToFront();
  await editor.fill('Newer manual edits');
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await panel.getByRole('button', { name: 'Keep my edits' }).waitFor();
  assert.equal(await editor.innerText(), 'Newer manual edits');
  await panel.getByRole('button', { name: 'Keep my edits' }).click();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  await panel.getByRole('button', { name: 'Replace draft', exact: true }).click();
  assert.equal(await editor.innerText(), '用自己的语气写作。');
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await editor.innerText(), 'Newer manual edits');
  await chat.fill('Shorter');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await panel.getByRole('button', { name: 'Dismiss', exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Dismiss', exact: true }).click();
  assert.equal(await editor.innerText(), 'Newer manual edits');
  await panel.setViewportSize({ width: 320, height: 720 });
  await panel.emulateMedia({ colorScheme: 'dark' });
  assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await panel.screenshot({ path: resolve('test-results/sidepanel-dark.png') });
  await page.screenshot({ path: resolve('test-results/composer.png') });
  await page.locator('#close').click();
  await panel.getByRole('button', { name: 'Start a draft', exact: true }).waitFor();
  delay = 900;
  await open();
  await editor.fill('My own words');
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await editor.innerText(), 'My own words');
  await page.locator('#close').click();
  delay = 0;
  await page.evaluate(() => {
    document.querySelector('time').closest('a').href = '/author/status/456';
    document.querySelector('[data-testid=tweetText]').textContent = 'A different source post.';
  });
  await open();
  await panel
    .locator('#source-snippet')
    .getByText('A different source post.', { exact: true })
    .waitFor({ state: 'attached' });
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
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
  // Original-tweet entry opens its own tab, attaches only there, and waits for a brief.
  await panel.getByRole('button', { name: 'Start a draft', exact: true }).waitFor();
  const beforeOriginal = requests.length;
  const created = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Start a draft', exact: true }).click();
  const originalTab = await created;
  await originalTab.waitForURL('https://x.com/compose/post');
  await panel.setViewportSize({ width: 400, height: 900 });
  await panel.emulateMedia({ colorScheme: 'light' });
  await panel.locator('#workspace').waitFor();
  assert.equal(await panel.getByRole('textbox', { name: 'Message the agent' }).inputValue(), '');
  await panel.screenshot({ path: resolve('test-results/original-start.png') });
  assert.equal(
    requests.length,
    beforeOriginal,
    'Opening the writing workspace must not spend a model request',
  );
  const originalEditor = originalTab.locator('[role=dialog]').getByTestId('tweetTextarea_0');
  assert.equal(await originalEditor.innerText(), '');
  await panel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Write a tweet about lessons from building my first Chrome extension');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert(
    requests.some((r) =>
      r.messages.some(
        (m) => m.role === 'user' && m.content.includes('There is no source post to quote'),
      ),
    ),
  );
  assert.equal(await originalEditor.innerText(), '');
  await panel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Make it shorter and warmer');
  await panel.getByRole('button', { name: 'Send message' }).click();
  await panel.getByText('Make it shorter and warmer', { exact: true }).waitFor();
  await panel.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.getAttribute('aria-label') === 'Apply to draft' && !b.disabled,
    ),
  );
  assert(
    requests.some((r) =>
      r.messages.some(
        (m) =>
          m.role === 'user' &&
          m.content.includes('Make it shorter and warmer') &&
          m.content.includes('用自己的语气写作。'),
      ),
    ),
  );
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(await originalEditor.innerText(), '用自己的语气写作。');
  await panel.screenshot({ path: resolve('test-results/original-tweet.png') });
  await panel.getByRole('button', { name: 'Undo', exact: true }).click();
  assert.equal(await originalEditor.innerText(), '');
  await originalTab.locator('#close').click();
  await originalTab.close();
  await page.bringToFront();
  await panel.close();
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
  // Exercise article extraction in the service worker, conversation tab cleanup, and Exa search.
  // Chrome-created tabs can navigate before Playwright attaches its network fixture.
  // Reload after attachment so this test always supplies the controlled X document.
  const supplyToolFixture = async (p) => {
    try {
      await p.waitForLoadState('domcontentloaded', { timeout: 5000 });
      if (p.url().startsWith('chrome-extension://')) return;
      // Chrome's first extension-created navigation may bypass context routing.
      // Reload the exact requested URL after attachment to supply the fixture.
      await p.goto(toolPageUrl);
    } catch {}
  };
  context.on('page', supplyToolFixture);
  await context.route('https://evidence.example.org/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<html><head><title>Primary evidence</title></head><body><article><h1>Primary evidence</h1><p>' +
        'A controlled study found a measurable improvement. '.repeat(30) +
        '</p></article></body></html>',
    }),
  );
  await context.route('https://mcp.exa.ai/**', async (route) => {
    const body = route.request().postDataJSON();
    assert(!route.request().headers().authorization);
    const tool = body.params.name;
    assert(['web_search_exa', 'web_fetch_exa'].includes(tool));
    const text =
      tool === 'web_search_exa'
        ? 'Title: Primary evidence\nURL: https://evidence.example.org/article\nA controlled study'
        : 'Title: Primary evidence\nURL: https://evidence.example.org/article\nA controlled study found a measurable improvement.';
    await route.fulfill({
      contentType: 'text/event-stream',
      body:
        'event: message\ndata: ' +
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: { content: [{ type: 'text', text }] },
        }) +
        '\n\n',
    });
  });
  await options.getByText('All changes saved.').waitFor();
  // Plain-rewrite chat gains configured research tools without changing its saved prompt.
  await page.bringToFront();
  await open();
  const researchPanel = await context.newPage();
  await researchPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await researchPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await researchPanel.locator('.research-tools').count(), 0);
  await researchPanel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Search the web for evidence about this post and revise the draft.');
  await researchPanel.getByRole('button', { name: 'Send message' }).click();
  await researchPanel.getByText('Research draft', { exact: true }).waitFor();
  assert(
    requests.some(
      (r) =>
        r.messages.some(
          (m) => m.role === 'user' && m.content.includes('Search the web for evidence'),
        ) &&
        r.tools?.some((t) => t.function.name === 'web_search') &&
        r.tools?.some((t) => t.function.name === 'read_article'),
    ),
  );
  await researchPanel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Inspect a screenshot of the source post and revise the draft.');
  await researchPanel.getByRole('button', { name: 'Send message' }).click();
  await researchPanel.getByText('Screenshot draft', { exact: true }).waitFor();
  assert(
    requests.some((r) => JSON.stringify(r.messages).includes('data:image/png;base64,')),
    'Captured image must reach the configured model',
  );
  console.log('Screenshot capture and image tool return verified');
  await page.locator('#close').click();
  await researchPanel.close();
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
  // A collapsed timeline source is hydrated from its detail page before generation.
  toolPageUrl = 'https://x.com/author/status/123';
  const beforeFullSource = requests.length;
  await page.evaluate(() => {
    const article = document.querySelector('article[data-testid="tweet"]');
    article.querySelector('[data-testid="tweetText"]').textContent = 'Coding…';
    const more = document.createElement('button');
    more.dataset.testid = 'tweet-text-show-more-link';
    more.textContent = 'Show more';
    article.append(more);
  });
  await open();
  await page.waitForFunction(() => document.querySelector('[data-pi-x-composer]'));
  const sourceDeadline = Date.now() + 15000;
  while (requests.length === beforeFullSource && Date.now() < sourceDeadline)
    await page.waitForTimeout(100);
  assert(
    requests
      .slice(beforeFullSource)
      .some((r) =>
        r.messages.some(
          (m) =>
            m.role === 'user' &&
            typeof m.content === 'string' &&
            m.content.includes('Coding is fun.'),
        ),
      ),
    'Full detail-page text must replace collapsed source before generation',
  );
  await page.locator('#close').click();
  await page.evaluate(() => {
    document.querySelector('article[data-testid="tweet"] [data-testid="tweetText"]').textContent =
      'Coding is fun.';
    document.querySelector('[data-testid="tweet-text-show-more-link"]')?.remove();
  });
  console.log('Full source hydration verified');
  // Existing settings expose the built-in attributed-reporting prompt without migration.
  await open();
  const retellPanel = await context.newPage();
  await retellPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await retellPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  await retellPanel.getByLabel('Draft prompt', { exact: true }).selectOption('retell-viewpoint');
  const beforeRetell = requests.length;
  await retellPanel.getByRole('button', { name: 'Regenerate', exact: true }).click();
  const retellDeadline = Date.now() + 12000;
  while (
    !requests
      .slice(beforeRetell)
      .some((r) =>
        r.messages.some(
          (m) => m.role === 'system' && m.content.includes('Retell the source author'),
        ),
      ) &&
    Date.now() < retellDeadline
  )
    await retellPanel.waitForTimeout(100);
  await retellPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert(
    requests
      .slice(beforeRetell)
      .some((r) =>
        r.messages.some(
          (m) =>
            m.role === 'system' &&
            m.content.includes('Retell the source author') &&
            m.content.includes('Never claim that the user built'),
        ),
      ),
    'Reporting prompt must reach the model',
  );
  await page.locator('#close').click();
  await retellPanel.close();
  console.log('Attributed reporting option verified');
  // A cancelled dialog must not receive a late completion.
  delay = 1200;
  await open();
  await page.locator('#close').click();
  await page.waitForTimeout(1600);
  delay = 0;
  assert.equal(await page.locator('[data-pi-x-composer]').count(), 0);
  // X Articles render title/rich text and use article cards in the quote dialog.
  await page.evaluate(() => {
    const source = document.querySelector('article[data-testid="tweet"]');
    source.querySelector('[data-testid="User-Name"]').textContent = 'mem0 @mem0ai';
    source.querySelector('time').closest('a').href = '/mem0ai/status/2115094349466022038';
    const rich = document.createElement('article');
    rich.dataset.testid = 'twitterArticleReadView';
    rich.innerHTML =
      '<div data-testid="twitter-article-title">How to choose a memory model</div><div data-testid="twitterArticleRichTextView"><p>Introduction.</p><table><tr><td>Cost</td><td>$3.55</td></tr></table><p>Final article conclusion.</p></div>';
    source.querySelector('[data-testid="tweetText"]').replaceWith(rich);
  });
  const beforeArticle = requests.length;
  await open();
  const articlePanel = await context.newPage();
  await articlePanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await page.bringToFront();
  await articlePanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert(
    requests
      .slice(beforeArticle)
      .some((r) =>
        r.messages.some(
          (m) =>
            m.role === 'user' &&
            typeof m.content === 'string' &&
            m.content.includes('Final article conclusion.') &&
            m.content.includes('$3.55'),
        ),
      ),
    'Article title and full rich text must reach the model',
  );
  await page.locator('#close').click();
  await articlePanel.close();
  console.log('X Article quoting and full text verified');
  context.off('page', supplyToolFixture);
  // New settings and Reply mode are functional, including a model switch on a durable session.
  await options.getByRole('button', { name: 'Add model', exact: true }).click();
  await options.getByLabel('Base URL', { exact: true }).fill(baseUrl);
  await options.getByLabel('Model ID', { exact: true }).fill('fixture-model-2');
  await options.getByRole('switch', { name: 'Run default intent on open' }).uncheck();
  await options.getByRole('switch', { name: 'Read conversation context' }).uncheck();
  await options.getByLabel('Draft language', { exact: false }).selectOption('English');
  await options.getByText('All changes saved.').waitFor();
  const replyPanel = await context.newPage();
  await replyPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await replyPanel.getByRole('button', { name: 'Reply', exact: true }).click();
  await replyPanel
    .getByLabel('X post URL', { exact: true })
    .fill('https://x.com/author/status/123');
  const replyPageEvent = context.waitForEvent('page');
  await replyPanel.getByRole('button', { name: 'Open post', exact: true }).click();
  const replyPage = await replyPageEvent;
  await replyPanel.locator('#source-picker').waitFor({ state: 'hidden' });
  await replyPage.locator('[role=dialog] [data-testid=replyingTo]').waitFor();
  await replyPanel.getByLabel('Draft prompt', { exact: true }).waitFor();
  assert.equal(
    await replyPanel.getByLabel('Draft prompt', { exact: true }).inputValue(),
    'compose-reply',
  );
  assert.equal(
    await replyPanel.locator('.turn.agent').count(),
    0,
    'Auto-draft off waits for input',
  );
  await replyPanel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Write a thoughtful reply');
  const replyRequestStart = requests.length;
  await replyPanel.getByRole('button', { name: 'Send message' }).click();
  await replyPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  const replyRequest = requests
    .slice(replyRequestStart)
    .find((r) =>
      r.messages?.some(
        (m) => typeof m.content === 'string' && m.content.includes('Write a thoughtful reply'),
      ),
    );
  assert(replyRequest, 'Reply request reaches model');
  assert(
    !replyRequest.tools.some((t) => t.function.name === 'conversation_context'),
    'Context preference removes the tool',
  );
  assert(JSON.stringify(replyRequest.messages).includes('Draft language default: English'));
  const profiles = await worker.evaluate(
    async () => (await chrome.storage.local.get('settings')).settings.models,
  );
  await replyPanel
    .getByRole('combobox', { name: 'Model', exact: true })
    .selectOption(profiles[1].id);
  await replyPanel
    .getByRole('textbox', { name: 'Message the agent' })
    .fill('Make this reply shorter');
  const switchedStart = requests.length;
  await replyPanel.getByRole('button', { name: 'Send message' }).click();
  await replyPanel.locator('.turn.agent').nth(1).waitFor();
  assert(
    requests.slice(switchedStart).some((r) => r.model === 'fixture-model-2'),
    'Selected model is used for refinement',
  );
  await replyPanel.screenshot({ path: resolve('test-results/reply-panel.png') });
  await options.screenshot({ path: resolve('test-results/options-redesign.png'), fullPage: true });
  const modeQuoteEvent = context.waitForEvent('page');
  await replyPanel.getByRole('button', { name: 'Quote', exact: true }).click();
  const modeQuotePage = await modeQuoteEvent;
  await modeQuotePage.locator('[role=dialog] [data-testid=attachments]').waitFor();
  await replyPanel.locator('#quote-mode.active').waitFor();
  assert.equal(await modeQuotePage.locator('[role=dialog] [contenteditable]').innerText(), '');
  await modeQuotePage.close();
  await replyPage.close();
  await replyPanel.close();
  console.log('Reply, multiple models, language and context preferences verified');
  const jobs = await worker.evaluate(async () =>
    Object.values(await chrome.storage.local.get(null)).filter(
      (v) => v && typeof v === 'object' && 'status' in v,
    ),
  );
  assert(jobs.some((j) => j.status === 'cancelled'));
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(
    `Browser checks passed: settings, connection, responsive layout, Pi Quote menu/dialog/insertion, edit preservation, credential boundary, all five research tools, automatic session tools, dialog cancellation. ${requests.length} API requests.`,
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
