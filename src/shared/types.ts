export interface ToolTrace {
  jobId?: string;
  id: string;
  name: string;
  arguments: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  output?: string;
}
export type ToolName = 'articles' | 'context' | 'voice' | 'search';
export interface Prompt {
  id: string;
  name: string;
  instructions: string;
  tools: ToolName[];
  enabledTools?: ToolName[];
}
export interface WritingSample {
  id: string;
  title: string;
  text: string;
}
export type ModelProvider = 'openai-compatible' | 'chatgpt';
export interface ModelProfile {
  provider?: ModelProvider;
  id: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}
export interface Behavior {
  autoDraft: boolean;
  readContext: boolean;
  language: string;
}
export interface Settings {
  provider?: ModelProvider;
  models?: ModelProfile[];
  defaultModelId?: string;
  behavior?: Behavior;
  version: 1;
  baseUrl: string;
  apiKey: string;
  model: string;
  prompts: Prompt[];
  defaultPromptId: string;
  samples: WritingSample[];
}
export interface Post {
  articleTitle?: string;
  truncated?: boolean;
  id: string;
  url: string;
  author: string;
  text: string;
  links: string[];
  quoted?: { text: string; url?: string };
}
export interface PublicSettings {
  models?: { id: string; model: string }[];
  defaultModelId?: string;
  behavior?: Behavior;
  model?: string;
  prompts: { id: string; name: string }[];
  defaultPromptId: string;
  configured: boolean;
}
export interface Refinement {
  instruction: string;
  currentDraft: string;
}
export interface Job {
  toolCalls?: ToolTrace[];
  mode?: 'quote' | 'compose' | 'reply';
  modelId?: string;
  brief?: string;
  initialDraft?: string;
  sessionId?: string;
  refinement?: Refinement;
  id: string;
  tabId: number;
  documentId?: string;
  composerId: string;
  post?: Post;
  prompt: Prompt;
  status: 'running' | 'done' | 'error' | 'cancelled';
  progress: string;
  createdAt: number;
  lastSeenAt?: number;
  draft?: string;
  error?: string;
}
export type PageMessage =
  | { type: 'settings:public' }
  | { type: 'panel:open' }
  | { type: 'settings:open' }
  | {
      type: 'job:start';
      composerId: string;
      post?: Post;
      promptId?: string;
      mode?: 'compose' | 'quote' | 'reply';
      modelId?: string;
      brief?: string;
      initialDraft?: string;
    }
  | {
      type: 'job:refine';
      composerId: string;
      previousJobId: string;
      refinement: Refinement;
      modelId?: string;
    }
  | { type: 'job:get'; id: string }
  | { type: 'job:cancel'; id: string };
export interface Reply<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export interface ChatGPTStatus {
  state: 'signed-out' | 'pending' | 'signed-in';
  userCode?: string;
  expiresAt?: number;
  nextPollAt?: number;
  error?: string;
}
