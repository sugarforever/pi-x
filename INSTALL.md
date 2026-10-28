# Install pi-x · Writing partner for X

1. Download `pi-x-vX.Y.Z.zip` from the GitHub Release's **Assets**. The automatically generated “Source code” archives are for developers; use the `pi-x-…zip` asset instead.
2. Extract the ZIP into a permanent folder, for example `Extensions/pi-x`. The extracted folder must contain `manifest.json` directly.
3. In Chrome 120 or newer, open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder. Do not select the ZIP file.
5. Click the pi-x extension icon (pin it from Chrome's Extensions menu if needed). Configure your API base URL, API key, and model ID, settings save automatically. Click **Test connection** to verify them.
6. Refresh existing X tabs. Click the pi-x toolbar icon, choose **New draft**, and describe what you want to write. Refine it in chat, then **Apply to draft** when ready. To respond to an existing post, use **Pi Quote** from its repost menu.

Keep the extracted folder in place; Chrome loads the extension from it. This GitHub download uses Developer mode and does not install through the Chrome Web Store. It does not update automatically.

## Update

Download a newer release and close any active pi-x composer. Extract the new ZIP and replace the extension files in the **same folder**, then click **Reload** on the extension card at `chrome://extensions`. Refresh your X tabs. Reusing the same folder retains the extension identity and local settings. Uninstalling the extension removes its stored data.

## Verify the download (optional)

Download `SHA256SUMS.txt` from the same release. In a terminal inside the download folder:

- macOS: `shasum -a 256 -c SHA256SUMS.txt`
- Linux: `sha256sum -c SHA256SUMS.txt`
- Windows PowerShell: `Get-FileHash .\pi-x-vX.Y.Z.zip -Algorithm SHA256`, then compare the hash with `SHA256SUMS.txt`.

## Research tools

Browser reading is enabled automatically and uses temporary tabs in your Chrome profile. Chrome may request approval for site access when updating. Web search uses Exa without an API key. Writing-style matching uses examples you paste into settings. Retrieved page text and other tool context are sent to your configured model provider.
