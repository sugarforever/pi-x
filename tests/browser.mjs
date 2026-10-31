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
const formattedReply =
  '## A useful approach\n\n**Given:** a right triangle.\n\n1. Identify the sides.\n2. Apply the theorem.\n\n| Side | Length |\n| --- | --- |\n| AB | 6 |\n\n\\[c=\\sqrt{6^2+8^2}=10\\]\n\n```python\nprint(6 ** 2 + 8 ** 2)\n```\n\n[Problem source](https://math.example.org/amc)';
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
  if (policy.includes('You are a browser companion')) {
    const user = data.messages.filter((m) => m.role === 'user').at(-1)?.content || '';
    const triangle = {
      dimension: 2,
      title: 'Triangle ABC',
      points: [
        { id: 'A', at: [0, 0] },
        { id: 'B', at: [6, 0] },
        { id: 'C', at: [0, 8] },
      ],
      segments: [
        { a: 'A', b: 'B', label: '6' },
        { a: 'B', b: 'C' },
        { a: 'C', b: 'A', label: '8' },
      ],
      angles: [{ points: ['B', 'A', 'C'], label: '90°' }],
      constraints: [
        { kind: 'distance', a: 'A', b: 'B', value: 6 },
        {
          kind: 'perpendicular',
          lines: [
            ['A', 'B'],
            ['A', 'C'],
          ],
        },
      ],
    };
    let scene;
    if (user.includes('Draw the triangle')) scene = triangle;
    if (user.includes('Add the midpoint'))
      scene = {
        ...triangle,
        title: 'Triangle with median',
        points: [...triangle.points, { id: 'M', midpoint: ['B', 'C'] }],
        segments: [...triangle.segments, { a: 'A', b: 'M', dashed: true }],
      };
    if (user.includes('Draw a cube'))
      scene = {
        dimension: 3,
        title: 'Cube study',
        solids: [{ id: 'cube', kind: 'cube', size: [4, 4, 4] }],
      };
    const artifactRequest = /Create study notes|Revise study notes|Create Python example/.test(
      user.split('User request:').at(-1),
    );
    if (user.split('User request:').at(-1).includes('Show a formatted explanation')) {
      payload = { content: formattedReply };
    } else if (artifactRequest) {
      const revise = user.split('User request:').at(-1).includes('Revise study notes');
      const code = user.split('User request:').at(-1).includes('Create Python example');
      const current = JSON.parse(
        user
          .split('Current artifacts (authoritative selected versions): ')[1]
          .split('\nUser request:')[0],
      );
      const data = code
        ? { language: 'python', code: 'print("Hello")' }
        : {
            markdown: revise
              ? '# Study notes\nRevised explanation.'
              : '# Study notes\nFirst explanation.',
          };
      payload =
        last.role === 'tool'
          ? { content: revise ? 'Notes revised.' : code ? 'Code ready.' : 'Notes ready.' }
          : revise
            ? call('update_artifact', {
                artifactId: current.selectedId,
                baseVersionId: current.selected.version.id,
                contentJson: JSON.stringify(data),
              })
            : call('create_artifact', {
                kind: code ? 'code' : 'document',
                title: code ? 'Python example' : 'Study notes',
                contentJson: JSON.stringify(data),
              });
    } else
      payload = scene
        ? last.role === 'tool' && last.tool_call_id === 'tool-draw_diagram'
          ? { content: `Diagram ready: ${scene.title}.` }
          : call('draw_diagram', { sceneJson: JSON.stringify(scene) })
        : {
            content: user.includes('Explain the hint')
              ? 'Pair equal terms on opposite sides to use symmetry.'
              : 'Hint: look for symmetry before calculating.',
          };
  } else if (screenshotRequest) {
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
  await options.getByRole('button', { name: 'Use device code instead', exact: true }).click();
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
  await context.route('https://auth.openai.com/oauth/authorize?**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Fixture ChatGPT sign-in</h1>' }),
  );
  const loginOpened = context.waitForEvent('page');
  await options.getByRole('button', { name: 'Sign in with ChatGPT', exact: true }).click();
  const login = await loginOpened;
  await login.waitForURL('https://auth.openai.com/oauth/authorize?**');
  const oauth = new URL(login.url());
  assert.equal(oauth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(oauth.searchParams.get('redirect_uri'), 'http://localhost:1455/auth/callback');
  assert.equal(await options.locator('#chatgpt-device').isVisible(), false);
  // No server listens at the loopback callback. The extension must capture its
  // tab URL update and replace the failed navigation with its own settings page.
  await login
    .goto(
      `http://localhost:1455/auth/callback?code=browser-code&state=${oauth.searchParams.get('state')}`,
    )
    .catch(() => {});
  await login.waitForURL(`chrome-extension://${id}/options.html`);
  await login.getByText('Signed in with ChatGPT.', { exact: true }).waitFor();
  await login.getByRole('button', { name: 'Sign out', exact: true }).click();
  await login.getByText('Signed out.', { exact: true }).waitFor();
  await login.close();
  await options.reload();

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
  await feedPanel.locator('#send').click();
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
  await panel.locator('#send').click();
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await editor.innerText(), '这是一段中文草稿。');
  await panel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(await editor.innerText(), '用自己的语气写作。');
  await editor.fill('My manual draft');
  const chat = panel.getByRole('textbox', { name: 'Message the agent' });
  await chat.fill('Make it conversational');
  await panel.locator('#send').click();
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
    '14.5px',
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
  await panel.locator('#send').click();
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
  await panel.locator('#send').click();
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
  await panel.locator('#send').click();
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
  await researchPanel.locator('#send').click();
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
  await researchPanel.locator('#send').click();
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
  await retellPanel.locator('#send').click();
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
  await replyPanel.locator('#mode-label').click();
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
  await replyPanel.locator('#send').click();
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
  await replyPanel.locator('#send').click();
  await replyPanel.locator('.turn.agent').nth(1).waitFor();
  assert(
    requests.slice(switchedStart).some((r) => r.model === 'fixture-model-2'),
    'Selected model is used for refinement',
  );
  await replyPanel.screenshot({ path: resolve('test-results/reply-panel.png') });
  await options.screenshot({ path: resolve('test-results/options-redesign.png'), fullPage: true });
  const modeQuoteEvent = context.waitForEvent('page');
  await replyPanel.locator('#mode-label').click();
  await replyPanel.getByRole('button', { name: 'Quote', exact: true }).click();
  const modeQuotePage = await modeQuoteEvent;
  await modeQuotePage.locator('[role=dialog] [data-testid=attachments]').waitFor();
  await replyPanel.locator('#quote-mode.active').waitFor({ state: 'attached' });
  assert.equal(await modeQuotePage.locator('[role=dialog] [contenteditable]').innerText(), '');
  await modeQuotePage.close();
  await replyPage.close();
  await replyPanel.close();
  console.log('Reply, multiple models, language and context preferences verified');
  // Page chat works without an X content script or composer.
  await context.route('https://math.example.org/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: route.request().url().includes('/other')
        ? '<html><head><title>Other article</title></head><body><main>A different page.</main></body></html>'
        : '<html lang="en"><head><title>AMC practice problem</title><meta name="author" content="Math Circle"><meta property="og:site_name" content="AMC Practice"></head><body><nav>Menu</nav><main><h1>AMC Question</h1><p>Triangle ABC is right-angled at A, with AB = 6 and AC = 8. Find BC.</p><h2>Published solution</h2><p>BC = 10 by the Pythagorean theorem.</p></main></body></html>',
    }),
  );
  const mathPage = await context.newPage();
  await mathPage.goto('https://math.example.org/amc');
  const pagePanel = await context.newPage();
  await pagePanel.setViewportSize({ width: 400, height: 900 });
  await pagePanel.goto(`chrome-extension://${id}/sidepanel.html`);
  const beforePageChat = requests.length;
  await mathPage.bringToFront();
  await pagePanel.locator('#mode-label').getByText('Page chat', { exact: true }).waitFor();
  await pagePanel
    .locator('#page-title')
    .getByText('AMC practice problem', { exact: true })
    .waitFor({ state: 'attached' });
  assert.equal(requests.length, beforePageChat, 'Opening a page chat makes no model request');
  await pagePanel.locator('#page-details summary').click();
  assert((await pagePanel.locator('#page-text').textContent()).includes('Published solution'));
  assert((await pagePanel.locator('#page-metadata').textContent()).includes('Math Circle'));
  await pagePanel.locator('#page-details summary').click();
  await pagePanel.getByRole('textbox', { name: 'Message the agent' }).fill('Give me only a hint');
  await pagePanel.locator('#send').click();
  await pagePanel
    .getByText('Hint: look for symmetry before calculating.', { exact: true })
    .waitFor();
  const firstChatRequest = requests.at(-1);
  assert(JSON.stringify(firstChatRequest.messages).includes('BC = 10 by the Pythagorean theorem.'));
  assert(!JSON.stringify(firstChatRequest.messages).includes('Draft language default'));
  await pagePanel.getByRole('textbox', { name: 'Message the agent' }).fill('Explain the hint');
  await pagePanel.locator('#send').click();
  await pagePanel
    .locator('#conversation')
    .getByText('Pair equal terms on opposite sides to use symmetry.', { exact: true })
    .waitFor();
  assert(JSON.stringify(requests.at(-1).messages).includes('Hint: look for symmetry'));
  assert.equal(await pagePanel.locator('.earlier-revision').count(), 0);
  await pagePanel.locator('#request').fill('Show a formatted explanation');
  await pagePanel.locator('#send').click();
  const richReply = pagePanel
    .locator('.turn.agent')
    .filter({ has: pagePanel.getByRole('heading', { name: 'A useful approach', exact: true }) });
  await richReply.locator('math msqrt').waitFor();
  assert.equal(await richReply.locator('table tbody td').first().textContent(), 'AB');
  assert.equal(await richReply.locator('ol li').count(), 2);
  assert((await richReply.locator('pre code').textContent()).includes('print(6 ** 2 + 8 ** 2)'));
  await richReply.getByRole('heading').scrollIntoViewIfNeeded();
  await pagePanel.screenshot({ path: resolve('test-results/markdown-chat.png') });
  const diagram = pagePanel.locator('#diagram-panel');
  const messageDrawing = async (text, title) => {
    await pagePanel.getByRole('textbox', { name: 'Message the agent' }).fill(text);
    await pagePanel.locator('#send').click();
    await pagePanel
      .locator('#conversation')
      .getByText(`Diagram ready: ${title}.`, { exact: true })
      .waitFor();
  };
  const pagesBeforeDrawing = context.pages().length;
  await messageDrawing(
    'Draw the triangle from the stated conditions without giving a solution',
    'Triangle ABC',
  );
  const inline = pagePanel.locator('#conversation .inline-drawing');
  await inline.locator('svg[aria-label="Triangle ABC"]').waitFor();
  assert.equal(context.pages().length, pagesBeforeDrawing, 'Drawing does not open a window');
  assert.equal(
    await inline.locator('select, [tabindex], [role="button"], [data-label-hit]').count(),
    0,
    'Inline drawing has no editing controls',
  );
  await pagePanel.setViewportSize({ width: 340, height: 850 });
  assert(
    await inline.evaluate((el) => el.scrollWidth <= el.clientWidth),
    'Drawing fits a narrow panel',
  );
  await pagePanel.screenshot({ path: resolve('test-results/inline-drawing-narrow.png') });
  await pagePanel.setViewportSize({ width: 480, height: 850 });
  assert.equal(await diagram.isVisible(), false, 'Artifact workspace is hidden by default');
  assert.ok(
    (await pagePanel.locator('#conversation').boundingBox()).height > 450,
    'Chat gets most panel height',
  );
  await pagePanel.screenshot({ path: resolve('test-results/chat-first-panel.png') });
  const previewEvent = context.waitForEvent('page');
  await inline
    .getByRole('button', { name: 'Open drawing Triangle ABC in preview window', exact: true })
    .click();
  const previewHost = await previewEvent;
  await previewHost.getByRole('button', { name: 'Keep on top', exact: true }).waitFor();
  await previewHost.waitForURL(/preview=window/);
  const previewHostId = await previewHost.evaluate(
    async () => (await chrome.windows.getCurrent()).id,
  );
  assert.notEqual(
    previewHostId,
    await pagePanel.evaluate(async () => (await chrome.windows.getCurrent()).id),
    'Preview opens in a separate window, preserving the original browser tab',
  );
  const pinnedEvent = context.waitForEvent('page');
  await previewHost.getByRole('button', { name: 'Keep on top', exact: true }).click();
  const artifactWindow = await pinnedEvent;
  await artifactWindow.locator('#pinned-artifact-view svg[aria-label="Triangle ABC"]').waitFor();
  assert.equal(
    await artifactWindow.locator('#workspace').isVisible(),
    false,
    'Detached preview contains no chat UI',
  );
  // Headless Linux does not reliably expose PiP through chrome.windows.
  // Assert the actual Document PiP display mode instead of OS window metadata.
  assert.equal(
    await artifactWindow.evaluate(() => matchMedia('(display-mode: picture-in-picture)').matches),
    true,
    'Preview is a real Document Picture-in-Picture window',
  );
  await previewHost.waitForFunction(
    async (id) => (await chrome.windows.get(id)).state === 'minimized',
    previewHostId,
  );
  await pagePanel.bringToFront();
  assert.equal(
    await artifactWindow.evaluate(() => matchMedia('(display-mode: picture-in-picture)').matches),
    true,
    'Preview remains pinned when chat is focused',
  );
  await mathPage.bringToFront();
  await artifactWindow.bringToFront();
  await artifactWindow.waitForFunction(() => getComputedStyle(document.body).display === 'flex');
  const pinnedLabel = artifactWindow.getByRole('button', { name: 'Move label A', exact: true });
  const oldX = Number(await pinnedLabel.locator('text').getAttribute('x'));
  const hit = await pinnedLabel.locator('[data-label-hit]').boundingBox();
  await artifactWindow.mouse.move(hit.x + 3, hit.y + 3);
  await artifactWindow.mouse.down();
  await artifactWindow.mouse.move(hit.x + 30, hit.y + 20, { steps: 5 });
  await artifactWindow.mouse.up();
  await artifactWindow.waitForTimeout(700);
  assert(
    Number(await pinnedLabel.locator('text').getAttribute('x')) > oldX + 10,
    `Labels remain draggable in the pinned window (${oldX} -> ${await pinnedLabel.locator('text').getAttribute('x')})`,
  );
  await artifactWindow.screenshot({ path: resolve('test-results/artifact-detached.png') });
  await pagePanel.locator('#dock-artifact').click();
  await diagram.locator('svg[aria-label="Triangle ABC"]').waitFor();
  await messageDrawing('Add the midpoint M of BC and connect A to M', 'Triangle with median');
  await diagram.locator('[aria-label="Move label M"]').waitFor();
  await inline.locator('svg[aria-label="Triangle with median"]').waitFor();
  assert.equal(
    await inline.locator('svg[aria-label="Triangle ABC"]').count(),
    1,
    'Original turn retains its own drawing',
  );
  await artifactWindow
    .locator('#pinned-artifact-view svg[aria-label="Triangle with median"]')
    .waitFor();
  await pagePanel.locator('#page-details summary').click();
  await pagePanel.getByRole('button', { name: 'Remove context', exact: true }).click();
  await pagePanel.locator('#page-title').getByText('No page attached', { exact: true }).waitFor();
  await artifactWindow.waitForTimeout(700);
  await artifactWindow
    .locator('#pinned-artifact-view svg[aria-label="Triangle with median"]')
    .waitFor();
  await pagePanel.getByRole('button', { name: 'Use current page', exact: true }).click();
  await pagePanel
    .locator('#page-title')
    .getByText('AMC practice problem', { exact: true })
    .waitFor();
  await pagePanel.locator('#page-details summary').click();
  const pageCount = context.pages().length;
  await pagePanel.locator('#preview-artifact').click();
  assert.equal(context.pages().length, pageCount, 'Preview reuses its existing window');
  const previewClosed = artifactWindow.waitForEvent('close');
  await artifactWindow.getByRole('button', { name: 'Close preview', exact: true }).click();
  await previewClosed;
  await previewHost.waitForFunction(
    async (id) => (await chrome.windows.get(id)).state === 'normal',
    previewHostId,
  );
  await previewHost.close();
  await mathPage.bringToFront();
  await pagePanel.locator('#dock-artifact').click();

  const versionSelect = diagram.getByRole('combobox', { name: 'Diagram version' });
  const medianVersion = await versionSelect.inputValue();
  const oldPreviewEvent = context.waitForEvent('page');
  await inline
    .getByRole('button', { name: 'Open drawing Triangle ABC in preview window', exact: true })
    .click();
  const oldPreview = await oldPreviewEvent;
  await oldPreview.locator('#expanded-diagram-view svg[aria-label="Triangle ABC"]').waitFor();
  assert.equal(
    await inline.locator('svg[aria-label="Triangle with median"]').count(),
    1,
    'Viewing an older version leaves message snapshots intact',
  );
  await oldPreview.close();
  await versionSelect.selectOption(medianVersion);
  await diagram.locator('svg[aria-label="Triangle with median"]').waitFor();
  await pagePanel.reload();
  await inline.locator('svg[aria-label="Triangle ABC"]').waitFor();
  await inline.locator('svg[aria-label="Triangle with median"]').waitFor();
  await pagePanel.locator('#history-toggle').click();
  await pagePanel.locator('.history-item').first().click();
  await pagePanel
    .locator('#history-content .inline-drawing svg[aria-label="Triangle ABC"]')
    .waitFor();
  await pagePanel
    .locator('#history-content .inline-drawing svg[aria-label="Triangle with median"]')
    .waitFor();
  await pagePanel.locator('#history-back').click();
  // Docking is intentionally transient; message snapshots survive a reload.
  await pagePanel.locator('#dock-artifact').click();
  await diagram.locator('svg[aria-label="Triangle with median"]').waitFor();

  await diagram.getByRole('button', { name: 'Undo diagram', exact: true }).click();
  await diagram.locator('svg[aria-label="Triangle ABC"]').waitFor();
  assert.equal(await diagram.locator('[aria-label="Move label M"]').count(), 0);
  await versionSelect.selectOption(medianVersion);
  const labelM = diagram.locator('[aria-label="Move label M"]');
  await labelM.waitFor();
  const beforeDragX = Number(await labelM.locator('text').getAttribute('x'));
  const grab = await labelM.locator('[data-label-hit]').boundingBox();
  await pagePanel.mouse.move(grab.x + 3, grab.y + 3);
  await pagePanel.mouse.down();
  await pagePanel.mouse.move(grab.x + 33, grab.y + 23, { steps: 6 });
  await pagePanel.mouse.up();
  const draggedX = Number(await labelM.locator('text').getAttribute('x'));
  assert(draggedX > beforeDragX + 10, 'Dragging the padded label target moves the label');
  await pagePanel.waitForTimeout(700);
  assert.equal(
    Number(await labelM.locator('text').getAttribute('x')),
    draggedX,
    'Dragged label position survives storage refresh',
  );
  await labelM.focus();
  await labelM.press('ArrowRight');
  await pagePanel.waitForTimeout(700);
  await pagePanel.screenshot({ path: resolve('test-results/math-diagram-panel.png') });
  await diagram.getByRole('button', { name: 'Expand diagram', exact: true }).click();
  const expanded = pagePanel.getByRole('dialog', { name: 'Expanded diagram' });
  const expandedBox = await expanded.locator('svg').boundingBox();
  assert(expandedBox.height > 500, 'Expanded diagram receives a large viewport');
  const svgDownloadEvent = pagePanel.waitForEvent('download');
  await expanded.getByRole('button', { name: 'Download diagram SVG', exact: true }).click();
  const svgDownload = await svgDownloadEvent;
  assert((await readFile(await svgDownload.path(), 'utf8')).includes('<svg'));
  const pngDownloadEvent = pagePanel.waitForEvent('download');
  await expanded.getByRole('button', { name: 'Download diagram PNG', exact: true }).click();
  const pngDownload = await pngDownloadEvent;
  assert.deepEqual(
    [...(await readFile(await pngDownload.path())).subarray(0, 8)],
    [137, 80, 78, 71, 13, 10, 26, 10],
  );
  await pagePanel.screenshot({ path: resolve('test-results/math-diagram-expanded.png') });
  const diagramTabEvent = context.waitForEvent('page');
  await expanded.getByRole('button', { name: 'Open in tab', exact: true }).click();
  const diagramTab = await diagramTabEvent;
  await diagramTab.setViewportSize({ width: 1280, height: 900 });
  await diagramTab.getByRole('dialog', { name: 'Expanded diagram' }).locator('svg').waitFor();
  const fullBox = await diagramTab
    .getByRole('dialog', { name: 'Expanded diagram' })
    .locator('svg')
    .boundingBox();
  assert(fullBox.width > 900, 'Diagram can use browser width outside the narrow side panel');
  await diagramTab.screenshot({ path: resolve('test-results/math-diagram-full-tab.png') });
  await diagramTab.close();
  await mathPage.bringToFront();

  await expanded.getByRole('button', { name: 'Close diagram', exact: true }).click();
  await messageDrawing('Draw a cube of side length 4', 'Cube study');
  await diagram.locator('svg[aria-label="Cube study"]').waitFor();
  const beforeRotate = await diagram.locator('svg').innerHTML();
  await diagram.getByRole('button', { name: 'Rotate right', exact: true }).click();
  assert.notEqual(await diagram.locator('svg').innerHTML(), beforeRotate);
  await pagePanel.screenshot({ path: resolve('test-results/math-solid-panel.png') });
  const sendArtifact = async (request, response) => {
    await pagePanel.locator('#request').fill(request);
    await pagePanel.locator('#send').click();
    await pagePanel
      .locator('#conversation .turn.agent')
      .getByText(response, { exact: true })
      .waitFor();
    await pagePanel
      .getByRole('button', { name: 'Send message', exact: true })
      .waitFor({ state: 'visible' });
  };
  await sendArtifact('Create study notes', 'Notes ready.');
  await diagram.getByRole('heading', { name: 'Study notes', exact: true }).waitFor();
  await sendArtifact('Revise study notes', 'Notes revised.');
  await diagram.getByText('Revised explanation.', { exact: true }).waitFor();
  const noteOpenEvent = context.waitForEvent('page');
  await pagePanel
    .getByRole('button', { name: 'Open artifact Study notes', exact: true })
    .last()
    .click();
  const noteWindow = await noteOpenEvent;
  await noteWindow
    .locator('#expanded-diagram-view')
    .getByText('Revised explanation.', { exact: true })
    .waitFor();
  await noteWindow.close();
  await pagePanel.locator('#dock-artifact').click();
  await diagram.getByText('Revised explanation.', { exact: true }).waitFor();
  const notesVersion = await diagram.getByLabel('Artifact version', { exact: true }).inputValue();
  await diagram.getByRole('button', { name: 'Undo artifact', exact: true }).click();
  await diagram.getByText('First explanation.', { exact: true }).waitFor();
  await diagram.getByLabel('Artifact version', { exact: true }).selectOption(notesVersion);
  await diagram.getByRole('button', { name: 'Artifact source', exact: true }).click();
  await diagram
    .locator('.artifact-source')
    .getByText('# Study notes\nRevised explanation.', { exact: true })
    .waitFor();
  await diagram.getByRole('button', { name: 'Artifact preview', exact: true }).click();
  await pagePanel.screenshot({ path: resolve('test-results/artifact-document.png') });
  await sendArtifact('Create Python example', 'Code ready.');
  await diagram
    .locator('.artifact-preview code')
    .getByText('print("Hello")', { exact: true })
    .waitFor();
  await pagePanel.screenshot({ path: resolve('test-results/artifact-code.png') });
  const codePreviewEvent = context.waitForEvent('page');
  await pagePanel.locator('#preview-artifact').click();
  const codeHost = await codePreviewEvent;
  const codePinEvent = context.waitForEvent('page');
  await codeHost.getByRole('button', { name: 'Keep on top', exact: true }).click();
  const codePreview = await codePinEvent;
  await codePreview.locator('#pinned-artifact-view code').waitFor();
  await codePreview.getByRole('button', { name: 'Copy artifact', exact: true }).click();
  await codePreview.locator('.artifact-status').getByText('Copied.', { exact: true }).waitFor();
  codePreview.once('dialog', (dialog) => dialog.accept());
  await codePreview.getByRole('button', { name: 'Remove artifact', exact: true }).click();
  await codePreview.getByRole('heading', { name: 'Study notes', exact: true }).waitFor();
  const codePreviewClosed = codePreview.waitForEvent('close');
  await codePreview.getByRole('button', { name: 'Close preview', exact: true }).click();
  await codePreviewClosed;
  await codeHost.close();
  const fallbackPanel = await context.newPage();
  await fallbackPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await fallbackPanel.locator('#artifact-chip').waitFor();
  await fallbackPanel.evaluate(() =>
    Object.defineProperty(window.documentPictureInPicture, 'requestWindow', {
      value: () => new Promise(() => {}),
    }),
  );
  const fallbackEvent = context.waitForEvent('page');
  await fallbackPanel.locator('#preview-artifact').click();
  const fallbackPopup = await fallbackEvent;
  await fallbackPopup.waitForURL(/preview=window/);
  await fallbackPopup.getByRole('button', { name: 'Keep on top', exact: true }).waitFor();
  await fallbackPopup
    .locator('#expanded-diagram-view')
    .getByRole('heading', { name: 'Study notes', exact: true })
    .waitFor();
  const repinEvent = context.waitForEvent('page');
  await fallbackPopup.getByRole('button', { name: 'Keep on top', exact: true }).click();
  const repinned = await repinEvent;
  await repinned
    .locator('#pinned-artifact-view')
    .getByRole('heading', { name: 'Study notes', exact: true })
    .waitFor();
  assert(
    await repinned.evaluate(() => matchMedia('(display-mode: picture-in-picture)').matches),
    'Fallback preview can be pinned from its own window',
  );
  const repinnedClosed = repinned.waitForEvent('close');
  await repinned.getByRole('button', { name: 'Close preview', exact: true }).click();
  await repinnedClosed;
  const fallbackClosed = fallbackPopup.waitForEvent('close');
  await fallbackPopup.getByRole('button', { name: 'Close preview', exact: true }).click();
  await fallbackClosed;
  await fallbackPanel.close();
  await mathPage.bringToFront();

  await pagePanel.locator('#dock-artifact').click();
  const artifactPicker = diagram.getByLabel('Artifact', { exact: true });
  const drawingId = await artifactPicker
    .locator('option')
    .evaluateAll((options) => options.find((o) => o.textContent.includes('Cube study')).value);
  await artifactPicker.selectOption(drawingId);
  await pagePanel.locator('#page-details summary').click();
  await mathPage.goto('https://math.example.org/other');
  await pagePanel
    .locator('#page-notice')
    .getByText(/Other article/)
    .waitFor();
  assert.equal(await pagePanel.locator('#page-title').textContent(), 'AMC practice problem');
  await pagePanel.screenshot({ path: resolve('test-results/page-chat.png') });
  await pagePanel.getByRole('button', { name: 'Use current page', exact: true }).click();
  await pagePanel.locator('#page-title').getByText('Other article', { exact: true }).waitFor();
  await pagePanel.getByRole('button', { name: 'Remove context', exact: true }).click();
  await pagePanel.locator('#page-title').getByText('No page attached', { exact: true }).waitFor();
  await mathPage.close();
  await pagePanel.reload();
  await pagePanel.locator('#artifact-chip').waitFor();
  assert.equal(await diagram.isVisible(), false, 'Reload restores chat-first layout');
  await pagePanel.locator('#dock-artifact').click();
  await pagePanel.locator('#diagram-panel svg[aria-label="Cube study"]').waitFor();
  await pagePanel
    .locator('#conversation')
    .getByText('Pair equal terms on opposite sides to use symmetry.', { exact: true })
    .waitFor();
  await pagePanel.getByRole('button', { name: 'History', exact: true }).click();
  await pagePanel.locator('.history-item').filter({ hasText: 'AMC practice problem' }).click();
  await pagePanel.getByRole('button', { name: 'Continue chat', exact: true }).click();
  await pagePanel
    .locator('#conversation')
    .getByText('Pair equal terms on opposite sides to use symmetry.', { exact: true })
    .waitFor();
  const beforeReuse = requests.length;
  const newXEvent = context.waitForEvent('page');
  await pagePanel
    .locator('#conversation .turn.agent')
    .filter({ hasText: 'Pair equal terms on opposite sides to use symmetry.' })
    .getByRole('button', { name: 'Write on X', exact: true })
    .click();
  const fromChat = await newXEvent;
  await fromChat.waitForURL('https://x.com/compose/post');
  await pagePanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  assert.equal(await fromChat.locator('[role=dialog] [contenteditable]').innerText(), '');
  assert.equal(
    requests.length,
    beforeReuse,
    'Reusing a chat answer does not generate or insert automatically',
  );
  await pagePanel.getByRole('button', { name: 'Apply to draft', exact: true }).click();
  assert.equal(
    await fromChat.locator('[role=dialog] [contenteditable]').innerText(),
    'Pair equal terms on opposite sides to use symmetry.',
  );
  await fromChat.close();
  await pagePanel.getByRole('button', { name: 'History', exact: true }).click();
  await pagePanel.locator('.history-item').filter({ hasText: 'AMC practice problem' }).click();
  await pagePanel.getByRole('button', { name: 'Continue chat', exact: true }).click();
  const finalPreviewEvent = context.waitForEvent('page');
  await pagePanel.locator('#preview-artifact').click();
  const finalPreview = await finalPreviewEvent;
  await finalPreview.locator('#expanded-diagram-view svg').waitFor();
  const finalPreviewClosed = finalPreview.waitForEvent('close');
  await pagePanel.locator('#page-details summary').click();
  pagePanel.once('dialog', (dialog) => dialog.accept());
  await pagePanel.getByRole('button', { name: 'Delete chat', exact: true }).click();
  await finalPreviewClosed;
  await pagePanel.waitForTimeout(800);
  const remainingChats = await worker.evaluate(async () =>
    Object.values(await chrome.storage.local.get(null)).filter(
      (v) => v && typeof v === 'object' && v.mode === 'chat',
    ),
  );
  assert.equal(remainingChats.length, 0, 'Deleting chat removes its jobs');
  assert.equal(
    await worker.evaluate(
      async () =>
        Object.keys(await chrome.storage.local.get(null)).filter(
          (k) => k.startsWith('artifacts:') || k.startsWith('diagram:'),
        ).length,
    ),
    0,
    'Deleting chat removes every artifact kind',
  );
  await pagePanel.close();
  console.log(
    'Page chat: AMC context, metadata, follow-ups, navigation, refresh, remove, tab closure, history, drawing/editing/undo/3D/export, X reuse and deletion verified',
  );
  // Quoted cards can expose their image permalink before the post permalink.
  const mediaPost = await context.newPage();
  await mediaPost.goto('https://x.com/badlogicgames/status/2116308846721511576');
  await mediaPost.evaluate(() => {
    const article = document.querySelector('article[data-testid="tweet"]');
    article.querySelector('a').href = '/badlogicgames/status/2116308846721511576';
    article.querySelector('[data-testid="User-Name"]').textContent = 'Mario @badlogicgames';
    document.body.addEventListener('click', (event) => {
      if (event.target.closest('a[role="menuitem"]')) {
        document.querySelector(
          '[data-testid="attachments"] [data-testid="User-Name"]',
        ).textContent = 'Mario @badlogicgames';
      }
    });
    article.insertAdjacentHTML(
      'beforeend',
      '<div role="link"><div data-testid="tweetText">performance optimizations</div><a href="/badlogicgames/status/2116078693827428383/photo/1"><img alt="Graph"></a></div>',
    );
  });
  await mediaPost.getByRole('button', { name: 'Repost menu' }).click();
  await mediaPost.getByRole('menuitem', { name: 'Pi Quote' }).click();
  await mediaPost.locator('[data-pi-x-composer]').waitFor();
  const mediaPanel = await context.newPage();
  await mediaPanel.goto(`chrome-extension://${id}/sidepanel.html`);
  await mediaPost.bringToFront();
  await mediaPanel.getByRole('textbox', { name: 'Message the agent' }).fill('Draft a quote');
  await mediaPanel.locator('#send').click();
  await mediaPanel.getByRole('button', { name: 'Apply to draft', exact: true }).waitFor();
  const quotedMediaUrl = await worker.evaluate(
    async () =>
      Object.values(await chrome.storage.local.get(null)).find(
        (v) => v?.post?.id === '2116308846721511576' && v.status === 'done',
      )?.post.quoted.url,
  );
  assert.equal(quotedMediaUrl, 'https://x.com/badlogicgames/status/2116078693827428383');
  await mediaPanel.close();
  await mediaPost.close();
  console.log('Pi Quote with quoted image permalink verified');
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
