export type ToolName = 'articles' | 'context' | 'voice' | 'search';
export interface Prompt {
  id: string;
  name: string;
  instructions: string;
  tools: ToolName[];
}
export interface WritingSample {
  id: string;
  title: string;
  text: string;
}
export interface Settings {
  version: 1;
  baseUrl: string;
  apiKey: string;
  model: string;
  searchKey: string;
  articleAccess: boolean;
  prompts: Prompt[];
  defaultPromptId: string;
  samples: WritingSample[];
}
export interface Post {
  id: string;
  url: string;
  author: string;
  text: string;
  links: string[];
  quoted?: { text: string; url?: string };
}
export interface PublicSettings {
  prompts: { id: string; name: string }[];
  defaultPromptId: string;
  configured: boolean;
}
export interface Job {
  id: string;
  tabId: number;
  documentId?: string;
  composerId: string;
  post: Post;
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
  | { type: 'settings:open' }
  | { type: 'job:start'; composerId: string; post: Post; promptId?: string }
  | { type: 'job:get'; id: string }
  | { type: 'job:cancel'; id: string };
export interface Reply<T> {
  ok: boolean;
  value?: T;
  error?: string;
}
