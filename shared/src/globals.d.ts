/// <reference path="./plugin-api-types.d.ts" />

interface SpTask {
  id: string;
  title: string;
  projectId: string | null;
  tagIds: string[];
  issueId?: string | null;
  issueType?: unknown;
  isDone: boolean;
  [key: string]: unknown;
}

interface SpTag {
  id: string;
  title: string;
  color?: string | null;
}

declare const PluginAPI: {
  registerIssueProvider(
    definition: import('./plugin-api-types').IssueProviderPluginDefinition,
  ): void;
  translate(
    key: string,
    params?: Record<string, string | number>,
  ): string;

  // UI
  registerHeaderButton(config: {
    label: string;
    icon?: string;
    onClick: () => void;
    color?: 'primary' | 'accent' | 'warn';
  }): void;
  showSnack(cfg: {
    msg: string;
    type?: 'SUCCESS' | 'ERROR' | 'WARNING' | 'INFO';
    ico?: string;
  }): void;

  // Tasks
  getTasks(): Promise<SpTask[]>;
  getCurrentContextTasks(): Promise<SpTask[]>;
  updateTask(taskId: string, updates: Record<string, unknown>): Promise<void>;

  // Tags
  getAllTags(): Promise<SpTag[]>;
  addTag(tagData: { title: string; color?: string }): Promise<string>;

  // Config
  getConfig<T = Record<string, unknown>>(): Promise<T | null>;
};
