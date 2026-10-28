const launchers = new WeakMap<HTMLElement, HTMLElement>();
function composerRoot(editor: HTMLElement): HTMLElement | undefined {
  if (editor.closest('article,[data-testid="tweet"]')) return;
  const dialog = editor.closest<HTMLElement>('[role="dialog"]');
  if (dialog) {
    if (
      dialog.querySelector(
        'article,[data-testid="replyingTo"],[data-testid="attachments"] [data-testid="tweetText"]',
      )
    )
      return;
    return dialog;
  }
  // Find the inline composer itself, never the main column containing the feed.
  for (
    let root = editor.parentElement;
    root && root.tagName !== 'MAIN';
    root = root.parentElement
  ) {
    if (root.querySelector('article,[data-testid="tweet"]')) return;
    if (root.querySelector('[data-testid="tweetButtonInline"],[data-testid="tweetButton"]'))
      return root;
  }
}
export function installDraftLaunchers(
  document: Document,
  start: (root: HTMLElement, editor: HTMLElement) => void,
) {
  for (const editor of document.querySelectorAll<HTMLElement>(
    '[data-testid="tweetTextarea_0"][contenteditable="true"],[data-testid="tweetTextarea_0"] [contenteditable="true"]',
  )) {
    if (editor.dataset.piXBound || launchers.get(editor)?.isConnected) continue;
    const root = composerRoot(editor);
    if (!root) continue;
    const host = document.createElement('div');
    host.dataset.piXDraftLauncher = 'true';
    const shadow = host.attachShadow({ mode: 'open' }),
      style = document.createElement('style'),
      button = document.createElement('button');
    style.textContent =
      ':host{display:block;margin:8px 0}button{font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid #1d9bf044;background:transparent;color:#1d9bf0;cursor:pointer}button:hover{background:#1d9bf014}button:focus-visible{outline:2px solid #1d9bf0;outline-offset:3px}';
    button.type = 'button';
    button.textContent = 'Write with AI';
    button.setAttribute('aria-label', 'Write with AI');
    button.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (editor.isConnected) start(root, editor);
    };
    shadow.append(style, button);
    const container =
      editor.closest('[data-testid="tweetTextarea_0RichTextInputContainer"]') || editor;
    container.before(host);
    launchers.set(editor, host);
  }
}
export function removeDraftLauncher(editor: HTMLElement) {
  launchers.get(editor)?.remove();
  launchers.delete(editor);
}
