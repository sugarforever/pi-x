import type { Post, PublicSettings, ToolTrace } from './types';
export interface PanelTurn {
  jobId?: string;
  id: string;
  role: 'user' | 'agent';
  text: string;
  status?: 'proposal' | 'applied' | 'dismissed' | 'reverted' | 'error';
}
export interface PanelState {
  jobIds?: string[];
  toolCalls?: ToolTrace[];
  composerId: string;
  mode?: 'quote' | 'compose' | 'reply';
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
  | { action: 'model'; modelId: string }
  | { action: 'refine'; instruction: string; promptId?: string }
  | { action: 'regenerate'; promptId: string }
  | { action: 'cancel' }
  | { action: 'apply'; turnId: string; expectedCurrent?: string }
  | { action: 'dismiss'; turnId: string }
  | { action: 'undo'; expectedCurrent?: string };
export interface PanelResult {
  conflict?: boolean;
  currentDraft?: string;
}
