# Install pi-x · Chat with the page you’re on

1. Download `pi-x-vX.Y.Z.zip` from the GitHub Release's **Assets**. The automatically generated “Source code” archives are for developers; use the `pi-x-…zip` asset instead.
2. Extract the ZIP into a permanent folder, for example `Extensions/pi-x`. The extracted folder must contain `manifest.json` directly.
3. In Chrome 120 or newer, open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder. Do not select the ZIP file.
5. Click the pi-x extension icon (pin it from Chrome's Extensions menu if needed). Open Settings and either sign in with your ChatGPT subscription or configure an OpenAI-compatible API base URL, API key, and model ID. Settings save automatically. Click **Test connection** to verify them.
6. Open a web page and click the pi-x toolbar icon. Inspect the attached **Page** context, then ask a question or discuss its content. Use **Use current page** to refresh context after navigation. For X writing, refresh existing X tabs and choose **New post**, **Quote**, or **Reply** in pi-x’s mode menu, or use **Pi Quote** from a post’s repost menu. Review a proposed draft and choose **Insert** before posting manually in X.

Keep the extracted folder in place; Chrome loads the extension from it. This GitHub download uses Developer mode and does not install through the Chrome Web Store. It does not update automatically.

## Artifacts

Ask for a drawing, document, or code example, then click its artifact card to open a separate preview window. Click **Keep on top** to keep the preview visible while chatting. Its owner window minimizes and restores when the floating preview closes. Keep the minimized owner open. Use **Copy**, **Download**, and the version selector to export or revisit results.

## Update

Download a newer release and stop any running pi-x request. Extract the new ZIP and replace the extension files in the **same folder**, then click **Reload** on the extension card at `chrome://extensions`. Refresh your X tabs. Reusing the same folder retains the extension identity and local settings. Uninstalling the extension removes its stored data.

## Verify the download (optional)

Download `SHA256SUMS.txt` from the same release. In a terminal inside the download folder:

- macOS: `shasum -a 256 -c SHA256SUMS.txt`
- Linux: `sha256sum -c SHA256SUMS.txt`
- Windows PowerShell: `Get-FileHash .\pi-x-vX.Y.Z.zip -Algorithm SHA256`, then compare the hash with `SHA256SUMS.txt`.

## Research tools

Browser reading is enabled automatically and uses temporary tabs in your Chrome profile. Chrome may request approval for site access when updating. Web search uses Exa without an API key. Writing-style matching uses examples you paste into settings. Retrieved page text and other tool context are sent to your configured model provider.
