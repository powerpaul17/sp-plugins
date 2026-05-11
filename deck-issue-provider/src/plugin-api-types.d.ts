// Type definitions for Super Productivity Plugin API
// Source: @super-productivity/plugin-api (issue-provider-types.ts)
// Inlined because the npm package doesn't export issue-provider types.
// Keep in sync with upstream when updating.

export interface PluginSearchResult {
  id: string;
  title: string;
  url?: string;
  status?: string;
  assignee?: string;
  start?: number;
  dueWithTime?: number;
  duration?: number;
  isAllDay?: boolean;
  description?: string;
}

export interface PluginIssue {
  id: string;
  title: string;
  body?: string;
  url?: string;
  state?: string;
  lastUpdated?: number;
  assignee?: string;
  labels?: string[];
  comments?: PluginIssueComment[];
  [key: string]: unknown;
}

export interface PluginIssueComment {
  author: string;
  body: string;
  created: number;
  [key: string]: unknown;
}

export interface PluginIssueField {
  field: string;
  label: string;
  type?: 'text' | 'markdown' | 'link' | 'date' | 'list';
  linkField?: string;
  hideEmpty?: boolean;
}

export interface PluginCommentsConfig {
  authorField?: string;
  bodyField?: string;
  createdField?: string;
  avatarField?: string;
  sortField?: string;
}

export type PluginSyncDirection = 'off' | 'pullOnly' | 'pushOnly' | 'both';

export interface PluginFieldMapping {
  taskField: 'isDone' | 'title' | 'notes' | 'dueDay' | 'dueWithTime' | 'timeEstimate';
  issueField: string;
  defaultDirection: PluginSyncDirection;
  mutuallyExclusive?: string[];
  toIssueValue(
    taskValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
  toTaskValue(
    issueValue: unknown,
    ctx: { issueId: string; issueNumber?: number },
  ): unknown;
}

export interface PluginFormField {
  key: string;
  type:
    | 'input'
    | 'password'
    | 'textarea'
    | 'checkbox'
    | 'select'
    | 'multiSelect'
    | 'link'
    | 'oauthButton';
  label: string;
  required?: boolean;
  description?: string;
  options?: { label: string; value: string }[];
  url?: string;
  pattern?: string;
  advanced?: boolean;
  showIf?: string;
  oauthConfig?: Record<string, unknown>;
  loadOptions?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ label: string; value: string }[]>;
}

export interface PluginHttpOptions {
  params?: Record<string, string>;
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: 'json' | 'text';
}

export interface PluginHttp {
  get<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  post<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  put<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  patch<T = unknown>(url: string, body: unknown, options?: PluginHttpOptions): Promise<T>;
  delete<T = unknown>(url: string, options?: PluginHttpOptions): Promise<T>;
  request<T = unknown>(
    method: string,
    url: string,
    body?: unknown,
    options?: PluginHttpOptions,
  ): Promise<T>;
}

export interface IssueProviderPluginDefinition {
  configFields: PluginFormField[];
  getHeaders(
    config: Record<string, unknown>,
  ): Record<string, string> | Promise<Record<string, string>>;
  searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginIssue>;
  getIssueLink(issueId: string, config: Record<string, unknown>): string;
  testConnection?(config: Record<string, unknown>, http: PluginHttp): Promise<boolean>;
  getNewIssuesForBacklog?(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]>;
  issueDisplay: PluginIssueField[];
  commentsConfig?: PluginCommentsConfig;
  fieldMappings?: PluginFieldMapping[];
  updateIssue?(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  createIssue?(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<{ issueId: string; issueNumber?: number; issueData: PluginIssue }>;
  extractSyncValues?(issue: PluginIssue): Record<string, unknown>;
  deleteIssue?(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void>;
  deletedStates?: string[];
  timeBlock?: {
    upsertEvent(
      taskId: string,
      eventData: {
        title: string;
        dueWithTime: number;
        durationMs: number;
        isDone: boolean;
      },
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void>;
    deleteEvent(
      taskId: string,
      config: Record<string, unknown>,
      http: PluginHttp,
    ): Promise<void>;
  };
}
