import { ArtifactWorkspace } from './artifact-workspace';
import type { ArtifactAction } from './artifact-renderers';
import type { ArtifactCollection } from '../artifacts/types';
interface DocumentPiP {
  requestWindow(options: { width: number; height: number }): Promise<Window>;
}
export class PinnedArtifactPreview {
  private window?: Window;
  private chatId?: string;
  private viewer?: ArtifactWorkspace;
  private generation = 0;
  constructor(
    private onAction: ArtifactAction,
    private api: DocumentPiP | undefined = (
      window as Window & { documentPictureInPicture?: DocumentPiP }
    ).documentPictureInPicture,
    private onVisibilityChange: (visible: boolean) => void = () => {},
  ) {}
  async open(chatId: string, collection: ArtifactCollection, busy: boolean): Promise<boolean> {
    if (!this.api) return false;
    if (this.window && !this.window.closed && this.chatId === chatId) {
      this.viewer?.update(collection, busy);
      this.window.focus();
      return true;
    }
    this.close();
    this.chatId = chatId;
    const generation = this.generation;
    const pending = this.api.requestWindow({ width: 800, height: 650 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let popup: Window;
    try {
      popup = await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Pinned preview request timed out.')), 1500);
        }),
      ]);
    } catch (error) {
      this.close();
      void pending.then((late) => late.close()).catch(() => {});
      throw error;
    } finally {
      clearTimeout(timer);
    }
    if (generation !== this.generation) {
      popup.close();
      return true;
    }
    this.window = popup;
    const doc = popup.document;
    doc.title = 'Pix · Pinned artifact preview';
    // Copy loaded extension styles synchronously so the new document is usable
    // immediately, without relying on a second stylesheet request from about:blank.
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const style = doc.createElement('style');
        style.textContent = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
        doc.head.append(style);
      } catch {
        if (!sheet.href) continue;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        doc.head.append(link);
      }
    }
    doc.body.className = 'artifact-pip';
    const header = doc.createElement('header');
    header.className = 'expanded-heading';
    const title = doc.createElement('strong');
    title.textContent = 'Pinned artifact preview';
    const close = doc.createElement('button');
    close.type = 'button';
    close.className = 'quiet';
    close.textContent = 'Close preview';
    close.onclick = () => this.close();
    header.append(title, close);
    const host = doc.createElement('section');
    host.id = 'pinned-artifact-view';
    doc.body.replaceChildren(header, host);
    this.viewer = new ArtifactWorkspace(host, (action) => {
      if (this.chatId !== chatId || popup.closed)
        throw new Error('Preview conversation is unavailable.');
      return this.onAction(action);
    });
    this.viewer.update(collection, busy);
    popup.addEventListener(
      'pagehide',
      () => {
        if (this.window === popup) {
          this.window = undefined;
          this.viewer = undefined;
          this.chatId = undefined;
          this.generation++;
          this.onVisibilityChange(false);
        }
      },
      { once: true },
    );
    this.onVisibilityChange(true);
    return true;
  }
  update(chatId: string | undefined, collection: ArtifactCollection | undefined, busy: boolean) {
    if (this.chatId && this.chatId !== chatId) {
      this.close();
      return;
    }
    this.viewer?.update(collection, busy);
  }
  close() {
    const popup = this.window;
    this.window = undefined;
    this.viewer = undefined;
    this.chatId = undefined;
    this.generation++;
    if (popup) {
      if (!popup.closed) popup.close();
      this.onVisibilityChange(false);
    }
  }
}
