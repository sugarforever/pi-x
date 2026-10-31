import type { ArtifactCollection } from '../artifacts/types';
import type { DiagramDocument } from '../geometry/document';
import type { PageContext, Post, PublicSettings, ToolTrace } from './types';
export interface PanelTurn {
  context?: PageContext;
  promptId?: string;
  promptName?: string;
  jobId?: string;
  id: string;
  role: 'user' | 'agent';
  text: string;
  status?: 'proposal' | 'applied' | 'dismissed' | 'reverted' | 'error';
}
export interface PanelState {
  diagram?: DiagramDocument;
  artifacts?: ArtifactCollection;
  jobIds?: string[];
  toolCalls?: ToolTrace[];
  composerId: string;
  mode?: 'quote' | 'compose' | 'reply' | 'chat';
  pageContext?: PageContext;
  pageChanged?: boolean;
  activePageTitle?: string;
  modelId?: string;
  post?: Post;
  currentDraft: string;
  prompts: PublicSettings['prompts'];
  promptId: string;
  busy: boolean;
  ready: boolean;
  status: string;
  turns: PanelTurn[];
  canUndo: boolean;
}
export type PanelCommand =
  | {
      action: 'artifact';
      operation: 'select' | 'version' | 'remove' | 'label';
      artifactId: string;
      versionId?: string | null;
      point?: string;
      offset?: number[];
    }
  | {
      action: 'diagram';
      operation: 'select' | 'label';
      versionId?: string;
      point?: string;
      offset?: number[];
    }
  | { action: 'model'; modelId: string }
  | { action: 'refine'; instruction: string; promptId?: string; allowScreenshot?: boolean }
  | { action: 'regenerate'; promptId: string }
  | { action: 'cancel' }
  | { action: 'apply'; turnId: string; expectedCurrent?: string }
  | { action: 'dismiss'; turnId: string }
  | { action: 'undo'; expectedCurrent?: string };
export interface PanelResult {
  conflict?: boolean;
  currentDraft?: string;
}
