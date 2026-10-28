<img src="assets/logo.png" width="96" alt="pi-x plush pi mascot logo" />

# pi-x · Your writing partner for X

Turn an idea, a link, or rough notes into a draft through conversation.

**pi-x** is a Chrome extension for composing drafts with an AI writing partner. Start a new draft, discuss what you want to say, research supporting context, and refine the wording in a dedicated side panel. When you are happy, apply the draft to X’s composer and post it yourself.

You can also start from an existing post using **Pi Quote** in X’s repost menu. Quoting is one way to begin a draft; no existing post is needed to write your own.

[Download releases](https://github.com/sugarforever/pi-x/releases) · [Installation guide](INSTALL.md) · [Release guide](docs/RELEASING.md)

## What you can do

| Intent                | How it works                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| Compose from scratch | Start with an idea, a link, or notes and develop a draft through chat. |
| Translate and rewrite | Turn a post into natural Chinese—or another language—with your own instructions. |
| Match your voice      | Retrieve relevant examples you provide and use them as style references.         |
| Read in context       | Read linked articles and rendered ancestor or quoted posts before drafting.      |
| Research a claim      | Search the web and read supporting sources before composing a response.          |

Each named prompt defines writing instructions. Search, page reading, conversation context and writing examples are available by default. Each intent can narrow its tools; Behavior settings can disable conversation context globally. The agent uses the enabled tools when needed. Every generation runs through **Pi Durable**, with persisted progress and recovery for interrupted work.

## Install

Requires **Chrome 120+**. No Node.js installation is needed to use a release package.

1. Download **`pi-x-vX.Y.Z.zip`** from a [GitHub Release](https://github.com/sugarforever/pi-x/releases). Choose the extension asset, rather than GitHub’s automatically generated source archives.
2. Extract it into a permanent folder containing `manifest.json` directly.
3. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
4. Select the extracted folder, then pin pi-x from Chrome’s Extensions menu if you want quick access to settings.

GitHub packages use Developer mode and update manually. See [INSTALL.md](INSTALL.md) for checksum verification and updating in place. If a release package is not available yet, [build from source](#build-from-source).

## Connect your model

Open the side panel and choose Settings, then select a provider for each model profile.

For **ChatGPT subscription**, click **Sign in with ChatGPT**, open the device sign-in link, and enter the displayed code. Enable device-code login in your ChatGPT account security settings or ask your workspace administrator if it is unavailable. Keep Settings open while authorizing; reopening Settings resumes a pending sign-in. Enter a model ID available to your account, then click **Test connection**. Subscription requests use Pi’s Codex Responses adapter and your account’s applicable usage limits. **Sign out** disconnects the shared ChatGPT account for every subscription profile. See [OpenAI’s authentication documentation](https://learn.chatgpt.com/docs/auth).

For **OpenAI-compatible API**, configure:

| Setting  | What to enter                                                         |
| -------- | --------------------------------------------------------------------- |
| Base URL | Your OpenAI-compatible API endpoint, including `/v1` where required.  |
| API key  | Your provider’s key. Keyless local HTTP endpoints are also supported. |
| Model ID | The model identifier from your provider.                              |

Settings save automatically as you edit. Invalid or incomplete fields show a “Not saved” message until corrected. Click **Test connection** to verify the provider and grant access if using an HTTP endpoint. The settings page includes a **Playground** for trying saved prompts before using them on X.

Save multiple model profiles in **Models** and choose the default with its radio button. The panel’s model selector switches the model for subsequent drafts and refinements while preserving the conversation. Existing single-model settings migrate when you first edit them. Each connection can be tested separately.

For OpenAI-compatible providers, GPT-6 models use Pi’s **streaming Responses API** adapter with **low reasoning effort**, including when calling tools. Other models use its **streaming Chat Completions** adapter. Your configured endpoint must support the selected API and the model must support **function/tool calling**. API providers require their own API access and may incur charges. Use the separate ChatGPT subscription provider to sign in with your ChatGPT account.

## Write an original tweet

On X’s home feed, click **Write with AI** beside the “What’s happening?” composer. The assistant works with that editor and preserves anything already typed. Describe the draft in chat, refine it, and apply it back to the same composer. Starting from this action does not open another X tab or call the model. The first chat message starts generation.

Click the extension toolbar icon to open your writing partner, then choose **New draft** (or **Start a draft** on the welcome screen). pi-x opens a separate, blank X composer tab without changing any existing drafts. If X asks you to sign in, do that first, then choose New draft again.

Describe an idea, paste a link, or share rough notes. Opening the workspace does not call the model; your first message starts the draft. The **Original post** preset writes a fresh tweet rather than translating a source post. You can also choose one of your saved writing prompts.

Keep chatting to refine the proposed version before applying it. Your manual edits in X take priority if you change the editor; otherwise the next request builds on the latest proposed revision. Exa search is available automatically; browser reading uses your Chrome session automatically. When satisfied, click **Insert**, review it in X, and press X’s **Post** button yourself. **Undo** restores your prior editor text. Closing that composer ends its live conversation.

## Use Pi Quote

1. Refresh any X tabs that were open when you installed the extension.
2. Open a post’s repost menu and select **Pi Quote**.
3. Your default prompt runs while X’s normal quote dialog opens.
4. Refine the proposed draft in the side panel, choose **Insert**, and click X’s **Post** button yourself.

Choose another prompt in the side panel and click **Regenerate** to try a different intent. Every generated version is a proposal. Your editor text stays unchanged until you choose **Insert**. Closing the quote dialog cancels its job.

To report someone else's first-person views, choose **转述观点** in the panel's prompt selector and click **Regenerate**. The built-in preset attributes views and experiences to the source author, preserves uncertainty, and avoids turning the author's “I/we” into the user's own claims or endorsement. It is available automatically for existing installations.

## Shape your draft in the side panel

X Articles are supported through the same Pi Quote menu. The source includes the article title and rendered rich text, including paragraphs and tables; the native article preview is matched by its author and title.

Collapsed long source posts are resolved from their permalink before drafting. The reader expands the source’s “Show more” control where available; if the source remains collapsed, generation reports an error instead of treating the preview as the full post. Expand **Source** in the side panel to inspect the captured source; **Draft** shows the current X editor text. The source shows a two-line preview; expand it to inspect the full captured text. The current editor text stays collapsed by default.

**Pi Quote** opens X’s native quote dialog and the extension’s Chrome side panel. Your saved default prompt prepares a proposed draft in the panel. The quote dialog contains only an **Open pi-x** launcher at the upper right of the editor, the original post and X’s own editor and controls.

Chat with the agent in the side panel to adjust tone, length or content. Each request uses the current text in X, including manual edits, and retains the durable conversation. Tools are enabled by default. The intent’s tool choices and the global conversation-context preference determine which tools are offered for each request. Use **Regenerate** with another prompt to start a fresh conversation.

Tool calls appear in a separate collapsed **Tools** history within each conversation round, after its request and before its response. Expand it and a call to inspect its parameters, result preview, status, and duration. The panel preserves expanded entries while polling. History is saved locally with draft jobs, limited to 64 calls per job and 12,000 characters per parameter/result preview; screenshots show image metadata instead of Base64 payloads. Only the trusted extension panel receives these details.

When a version feels right, click **Insert**. Nothing writes into X until you apply a revision. **Dismiss** sets a revision aside; **Copy** offers a manual fallback; **Undo** restores the text before the last application. If you edited in X after requesting a revision, the panel lets you keep your edits or explicitly replace them. Enter sends, Shift+Enter adds a line. Closing the side panel preserves the conversation while its quote dialog remains open. Closing that quote dialog cancels work and ends the live conversation.

Page reading opens a temporary background tab in your existing Chrome profile, using your normal login session, and returns the rendered page text to the writing agent. Browser reading is enabled by default through the extension’s required site access. Chrome may ask you to approve expanded access when updating. Tabs opened for reading are closed afterward. Search uses [Exa’s hosted MCP service](https://exa.ai/docs/get-started/exa-mcp), with no API key; free search usage is rate limited.

The panel stays connected to the active tab in its own Chrome window. Posting remains a manual action through X’s **Post** button.

## Quote, reply and reuse drafts

The panel has **Quote**, **Reply**, and **New post** modes. Quote and Reply use the current source when available; otherwise paste an X permalink. pi-x opens the source in a new tab and invokes X’s native quote or reply composer. Reply starts with a **Thoughtful reply** intent, aimed at the source author rather than retelling their post.

**History** shows conversations from the last 24 hours, including each revision and its expandable tool records. **Use draft** opens a fresh composer with the selected version as a proposal; it only fills X when you choose Insert. History is local to this Chrome profile, and existing draft retention and Clear all data apply to it.

**Insert** remains clickable after it changes to **Inserted**. Clear the editor and click it again to restore that version. Replacing different text still requires confirmation; clicking an already identical version preserves the existing undo step.

In **Behavior**, control automatic drafting on opening a quote/reply, conversation reading, and the fallback draft language. Explicit language instructions in an intent or chat take priority. Turning off automatic drafting lets you choose an intent/model and give instructions before the first model request.

## Make prompts your own

Create, rename, or remove prompts in settings and choose one as the default. Intent comes from your instructions. For example:

> Translate the selected post into natural Chinese and rewrite it in my style. Preserve the author’s meaning and uncertainty. Keep it concise, avoid hashtags, and return only the draft.

Four starter prompts are included:

| Prompt | Purpose |
| --- | --- |
| Chinese rewrite | Translate and rewrite clearly in Chinese. |
| In my voice | Use your writing samples as style references. |
| Read in context | Read the conversation and relevant linked pages. |
| Research the claim | Find evidence and draft with appropriate uncertainty. |

Writing examples guide style, not facts or opinions. Conversation context may open a temporary inactive X tab using your existing login, read the rendered posts, and close it afterward. The extension does not automatically collect your posting history or read media.

## Your data and permissions

- **Stored locally:** API keys, ChatGPT access and refresh tokens, prompts, writing samples, and draft sessions remain in this Chrome profile. Credentials are not synced or sent to X, and are not encrypted by the extension. Subscription tokens are stored separately from model settings, refreshed automatically, and sent only to OpenAI authentication and ChatGPT subscription endpoints.
- **Sent to your provider:** the selected post, your instructions, current draft and refinement conversation, and any context retrieved by tools. Exa receives search queries. Pages requested for reading open in your Chrome session; extracted text, including signed-in content, is sent to your configured model provider. Requests to Exa omit browser cookies and model-provider credentials.
- **Under your control:** tools are available automatically and the agent chooses when to use them. Search needs access to `https://mcp.exa.ai/*`; browser page reading uses required site access. Only trusted extension contexts can access stored settings and credentials.
- **Easy to clear:** **Clear all extension data** removes API keys, ChatGPT tokens and pending sign-ins, prompts, writing samples, and sessions. Draft jobs expire after 24 hours while Chrome runs; a shared conversation is retained until its most recent job expires. Uninstalling removes extension storage; Chrome’s extension settings manage granted site access.

Screenshot research is available automatically through `capture_screenshot`. Ask the agent to inspect the current page, an open tab ID, or a URL. It can capture the viewport, crop a rectangle in viewport CSS pixels, or scroll a CSS selector into view and capture its visible area. Captures briefly activate the target tab, then restore the previous tab. Temporary URL tabs close afterward. Images are limited to 1600 pixels on the longest side and are sent to your configured model provider; use a model that supports image input. Screenshots are stored with the local draft conversation. Chrome’s screenshot API requires `<all_urls>` site access, though research tools accept only public HTTPS URLs.

## Current limits

X’s DOM is not a public integration API, so changes to its interface may require adapter updates. Live-X validation with your account and model provider remains necessary. X handles post-length limits and posting errors.

Short links with hidden redirects, JavaScript-only pages, paywalls, deleted/private posts, and unloaded conversation history may be unavailable. Research tools report access failures; review generated claims before posting. Page URL checks reject IP literals, local names and nonstandard ports. Browser reading waits for page load and a quiet DOM; content requiring extra clicks, scrolling, or interactive verification may remain unavailable.

Pi Durable saves progress; it does not keep Chrome running. Each job has an 8-response-turn limit, a 25-second timeout per model request, and a 10-minute lifetime. A matching live composer can reconnect and resume interrupted work. Recovery ends when that composer is gone. Requests interrupted before their responses were committed may be repeated and incur additional provider charges. Pi Durable’s upstream API is experimental; dependencies are locked for reproducibility.

## Build from source

Requires Node.js **22.19+, 24+, or 26+**.

```sh
npm ci
npm run build
```

Load the generated `dist` folder through Chrome’s **Load unpacked** option, then follow [Connect your model](#connect-your-model).

## Development

```sh
npm run check                 # Version consistency, TypeScript, unit tests, and build
npm run format:check          # Source formatting
npx playwright install chromium
npm run test:browser          # Extension + X fixture + local model endpoint
npm run test:browser:release  # Build, extract, and test the release ZIP
npm run package:extension    # Production ZIP and SHA-256 checksum in release/
```

Browser tests use a disposable profile, controlled network fixtures, and a local model endpoint. They do not use your X account or real API keys. Screenshots are written to `test-results/`.

| Directory            | Responsibility                                                            |
| -------------------- | ------------------------------------------------------------------------- |
| `src/content/`       | Post extraction, repost-menu entry, native composer toolbar.              |
| `src/background/`    | Message routing, jobs, credentials, context tabs, recovery, cleanup.      |
| `src/agent/`         | Pi Durable harness, OpenAI-compatible provider, research and style tools. |
| `src/options/`       | Connection settings, prompts, writing samples, playground.                |
| `src/shared/`        | Validated settings, URL policies, protocol, message helper.               |
| `.github/workflows/` | CI and release automation.                                                |

## Releases and contributions

Use **Conventional Commits**: `fix:` for patches, `feat:` for features, and `!` or a `BREAKING CHANGE:` footer for breaking changes. Release Please proposes **Semantic Versioning** updates and a changelog in a release PR. Merging that PR triggers verification and publishes a GitHub Release with the extension ZIP and checksum.

See [docs/RELEASING.md](docs/RELEASING.md) for one-time GitHub setup, version rules, and release recovery.

## License

[MIT](LICENSE).
