# Install pi-x · AI Quote

1. Download `pi-x-vX.Y.Z.zip` from the GitHub Release's **Assets**. The automatically generated “Source code” archives are for developers; use the `pi-x-…zip` asset instead.
2. Extract the ZIP into a permanent folder, for example `Extensions/pi-x`. The extracted folder must contain `manifest.json` directly.
3. In Chrome 120 or newer, open `chrome://extensions` and turn on **Developer mode**.
4. Click **Load unpacked** and select the extracted folder. Do not select the ZIP file.
5. Click the pi-x extension icon (pin it from Chrome's Extensions menu if needed). Configure your API base URL, API key, and model ID, then save and test the connection.
6. Refresh existing X tabs. Open a post's repost menu, select **AI Quote**, and review the draft before posting.

Keep the extracted folder in place; Chrome loads the extension from it. This GitHub download uses Developer mode and does not install through the Chrome Web Store. It does not update automatically.

## Update

Download a newer release and close any active AI Quote composer. Extract the new ZIP and replace the extension files in the **same folder**, then click **Reload** on the extension card at `chrome://extensions`. Refresh your X tabs. Reusing the same folder retains the extension identity and local settings. Uninstalling the extension removes its stored data.

## Verify the download (optional)

Download `SHA256SUMS.txt` from the same release. In a terminal inside the download folder:

- macOS: `shasum -a 256 -c SHA256SUMS.txt`
- Linux: `sha256sum -c SHA256SUMS.txt`
- Windows PowerShell: `Get-FileHash .\pi-x-vX.Y.Z.zip -Algorithm SHA256`, then compare the hash with `SHA256SUMS.txt`.

## Research tools

Article reading requires enabling article access in settings. Web research requires your own Brave Search API key. Writing-style matching uses examples you paste into settings. Only enabled tools can send their gathered context to your chosen model provider.
