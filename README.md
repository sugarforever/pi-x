# pi-x · AI Quote for X

Translate, rewrite, or research a post—then draft a quote in your own voice.

**pi-x** is a Chrome extension that adds **AI Quote** to X’s repost menu. It opens X’s native quote dialog, runs your saved default prompt, and fills in an editable draft. Switch prompts to regenerate, make your edits, and post when you’re ready.

[Download releases](https://github.com/sugarforever/pi-x/releases) · [Installation guide](INSTALL.md) · [Release guide](docs/RELEASING.md)

## What you can do

| Intent                | How it works                                                                     |
| --------------------- | -------------------------------------------------------------------------------- |
| Translate and rewrite | Turn a post into natural Chinese—or another language—with your own instructions. |
| Match your voice      | Retrieve relevant examples you provide and use them as style references.         |
| Read in context       | Read linked articles and rendered ancestor or quoted posts before drafting.      |
| Research a claim      | Search the web and read supporting sources before composing a response.          |

Each named prompt has its own instructions and enabled tools. A simple rewrite uses only the selected post; prompts with tools can gather more context when needed. Every generation runs through **Pi Durable**, with persisted progress and recovery for interrupted work.

## Install

Requires **Chrome 120+**. No Node.js installation is needed to use a release package.

1. Download **`pi-x-vX.Y.Z.zip`** from a [GitHub Release](https://github.com/sugarforever/pi-x/releases). Choose the extension asset, rather than GitHub’s automatically generated source archives.
2. Extract it into a permanent folder containing `manifest.json` directly.
3. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
4. Select the extracted folder, then pin pi-x from Chrome’s Extensions menu if you want quick access to settings.

GitHub packages use Developer mode and update manually. See [INSTALL.md](INSTALL.md) for checksum verification and updating in place. If a release package is not available yet, [build from source](#build-from-source).

## Connect your model

Click the extension icon to open settings, then configure:

| Setting  | What to enter                                                         |
| -------- | --------------------------------------------------------------------- |
| Base URL | Your OpenAI-compatible API endpoint, including `/v1` where required.  |
| API key  | Your provider’s key. Keyless local HTTP endpoints are also supported. |
| Model ID | The model identifier from your provider.                              |

Save, grant the connection’s site permission, and click **Test connection**. The settings page includes a **Playground** for trying saved prompts before using them on X.

The endpoint must support **streaming Chat Completions**. Prompts with tools also need **function/tool calling**. You supply your own API access; a ChatGPT subscription alone does not provide it, and provider usage may incur charges.

## Use AI Quote

1. Refresh any X tabs that were open when you installed the extension.
2. Open a post’s repost menu and select **AI Quote**.
3. Your default prompt runs while X’s normal quote dialog opens.
4. Review the inserted draft, edit it, and click X’s **Post** button yourself.

Choose another prompt in the dialog and click **Regenerate** to try a different intent. If you type while generation runs—or regenerate an existing draft—the extension preserves your editor text and shows the new draft separately. **Insert draft** asks before replacing existing text; **Copy draft** provides a manual fallback. Closing the dialog cancels its job.

## Make prompts your own

Create, rename, or remove prompts in settings and choose one as the default. Intent comes from your instructions. For example:

> Translate the selected post into natural Chinese and rewrite it in my style. Preserve the author’s meaning and uncertainty. Keep it concise, avoid hashtags, and return only the draft.

Four starter prompts are included:

| Prompt                 | Enabled tools                     | Additional setup                                      |
| ---------------------- | --------------------------------- | ----------------------------------------------------- |
| **Chinese rewrite**    | None                              | Ready after connecting a model.                       |
| **In my voice**        | Writing examples                  | Paste examples of your writing into settings.         |
| **Read in context**    | Articles and conversation context | Enable article access in settings.                    |
| **Research the claim** | Web search and articles           | Add a Brave Search API key and enable article access. |

Writing examples guide style, not facts or opinions. Conversation context may open a temporary inactive X tab using your existing login, read the rendered posts, and close it afterward. The extension does not automatically collect your posting history or read media.

## Your data and permissions

- **Stored locally:** keys, prompts, writing samples, and draft sessions remain in this Chrome profile. Keys are not synced or sent to X, and are not encrypted by the extension.
- **Sent to your provider:** the selected post, your instructions, and any context retrieved by enabled tools. Brave receives search queries when web search is enabled. Article requests omit cookies and provider credentials.
- **Under your control:** tool access is configured per prompt. Article reading also requires an explicit setting and optional HTTPS site permission. Only trusted extension contexts can access stored settings and credentials.
- **Easy to clear:** **Clear all extension data** removes keys, prompts, writing samples, and sessions. Draft sessions are cleaned after 24 hours while Chrome runs. Uninstalling removes extension storage; Chrome’s extension settings manage granted site access.

## Current limits

X’s DOM is not a public integration API, so changes to its interface may require adapter updates. Live-X validation with your account and model provider remains necessary. X handles post-length limits and posting errors.

Short links with hidden redirects, JavaScript-only pages, paywalls, deleted/private posts, and unloaded conversation history may be unavailable. Research tools report access failures; review generated claims before posting. Research URL checks reject IP literals, local names, nonstandard ports, and unsafe redirects, but do not provide a DNS-rebinding-resistant network sandbox.

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
