<img src="assets/logo.png" width="96" alt="pi-x mascot" />

# pi-x · Chat with the page you’re on

Ask questions about a web page, draw and revise diagrams, create notes and code, or draft posts for X. pi-x opens beside the page in Chrome’s side panel.

[Download releases](https://github.com/sugarforever/pi-x/releases) · [Detailed user guide](docs/USER_GUIDE.md)

## Install in Chrome

Requires **Chrome 120 or newer**. You do not need Node.js or developer tools to use a release.

1. Open [GitHub Releases](https://github.com/sugarforever/pi-x/releases) and download **`pi-x-vX.Y.Z.zip`** under **Assets**. Choose the pi-x ZIP, not “Source code”.
2. Extract it into a permanent folder, such as `Extensions/pi-x`.
3. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Pin pi-x from Chrome’s Extensions menu for easy access.

Keep the extracted folder: Chrome loads the extension from it. This is a manual installation, outside the Chrome Web Store. If no release is listed yet, use [Build from source](#build-from-source).

## Connect a model

Open pi-x and choose **Settings**. Choose one of:

- **ChatGPT subscription:** click **Sign in with ChatGPT** and finish signing in. Select a model available to your account.
- **OpenAI-compatible API:** enter your provider’s base URL, API key, and model ID.

Settings save automatically. Click **Test connection** before starting a conversation.

## Use pi-x

### Chat about a page

1. Open a web page and click the pi-x toolbar icon.
2. Ask a question, such as “Summarize this article” or “Give me a hint without revealing the answer”.
3. Continue the conversation to clarify or explore another approach.

The conversation keeps its attached page snapshot when you switch tabs. Use **Chat options → Use current page** to attach the page you’re viewing. Use **+** for a new chat or **History → Continue chat** to reopen one.

### Draw, create, and revise

Ask “Draw the triangle described on this page”, “Create study notes”, or “Write a Python example”. Then ask for changes in the same chat.

- Drawings appear directly in assistant messages as static images, without opening a window. Each message shows the version produced in that round; multiple revisions of the same drawing in one round show the final revision, and separate drawings appear individually.
- Click **Open preview ↗** beneath a drawing to open that version in the **preview window** for a larger view, editing labels, 3D rotation, or SVG/PNG export. Document/code cards and the artifact chip also open the preview window. Your original browser tab stays in place.
- Message drawings survive reloads and are available in saved chat history. Versions removed by the existing 24-version retention limit show an unavailable notice instead of a newer drawing. While generating, previews remain visible; opening a version is available after the answer finishes.
- Click **Keep on top** to show a floating preview while chatting. The original preview window minimizes and returns when you close the floating preview. Keep the minimized owner open; closing it also closes the floating preview.
- Use the version selector or **Undo** to revisit a revision; use **Copy** or **Download** to export it.
- Use **Dock preview** to view the artifact inside the side panel instead.

Drawings support movable labels, zoom, and SVG/PNG export. Code artifacts are displayed as text, not executed.

### Write on X

Refresh X tabs after installing. Choose **New post**, **Quote**, or **Reply** in pi-x, or choose **Pi Quote** from a post’s repost menu. Describe what you want, refine the draft through chat, then click **Insert**. Review it in X and click **Post** yourself.

## Update

1. Download and extract the newer release ZIP.
2. Stop any running pi-x request and replace the files in the **same installation folder**.
3. Open `chrome://extensions`, click **Reload** on pi-x, and refresh your X tabs.

Reusing the same folder keeps your extension identity and local settings. Updates are manual. See [INSTALL.md](INSTALL.md) for optional checksum verification.

## Privacy and limitations

Page content and messages are sent to your selected model provider when you submit a request. Browser research can read pages using your signed-in Chrome session; web search sends queries to Exa. Settings, credentials, and chat history are stored locally in this Chrome profile. Chats expire after 24 hours of inactivity while Chrome runs.

Chrome’s internal pages and built-in PDF viewer are unsupported. Some pages provide only partial readable content. See the [detailed guide](docs/USER_GUIDE.md) for screenshots, permissions, provider setup, and troubleshooting details.

## Build from source

Requires a supported Node.js version: **22.19+, 24, or 26+**.

```sh
npm ci
npm run build
```

Follow the installation steps above, selecting the generated `dist` folder.

## Development and releases

```sh
npm run check                 # Version checks, types, unit tests, and build
npm run format:check
npx playwright install chromium
npm run test:browser          # Isolated browser fixtures; no personal Chrome session
npm run test:browser:release  # Build and test the downloadable ZIP
```

Releases are controlled by Git tags. Keep the version in `package.json`, `package-lock.json`, and `manifest.json` aligned, commit it to `main`, then push a matching tag such as `v0.1.0`. GitHub Actions tests the tagged source and publishes the extension ZIP and checksum. No release PR is needed.

See [Release management](docs/RELEASING.md) for setup and retry instructions. No Chrome Web Store publishing is configured.

## License

[MIT](LICENSE).
