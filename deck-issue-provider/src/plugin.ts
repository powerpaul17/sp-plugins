import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginFieldMapping,
} from '../../shared/src/plugin-api-types';
import { t, isAuthError, encodeBasicAuth } from '../../shared/src/helpers';
import type { DeckConfig } from './deck-client';
import { getBaseUrl, getAllCards, findCardStack } from './deck-client';
import { mapDeckCardToSearchResult, mapDeckCardToIssue } from './mapping';

// ── Auto-create unlinked tasks ──────────────────────────────────────────────
const SYNC_TAG_TITLE = '🔗 SYNC_PENDING';
let _syncTagId: string | null = null;

async function _ensureSyncTag(): Promise<string> {
  if (_syncTagId) return _syncTagId;
  const tags = await PluginAPI.getAllTags();
  const found = tags.find((t: SpTag) => t.title === SYNC_TAG_TITLE);
  if (found) {
    _syncTagId = found.id;
    return _syncTagId;
  }
  const newId = await PluginAPI.addTag({ title: SYNC_TAG_TITLE, color: '#ff9800' });
  _syncTagId = newId;
  return _syncTagId;
}

async function _onSyncButtonClick(): Promise<void> {
  try {
    const cfg = await PluginAPI.getConfig<Record<string, unknown>>();
    if (!cfg?.autoCreateUnlinked) {
      PluginAPI.showSnack({
        msg: 'Enable "Auto-create unlinked cards" in project settings first',
        type: 'WARNING',
      });
      return;
    }
    const tasks = await PluginAPI.getTasks();
    const unlinked = tasks.filter((t: SpTask) => !t.issueId && !t.isDone);
    if (unlinked.length === 0) {
      PluginAPI.showSnack({ msg: 'All tasks already have linked cards!', type: 'INFO' });
      return;
    }
    const tagId = await _ensureSyncTag();
    for (const task of unlinked) {
      const newTagIds = task.tagIds ? [...task.tagIds] : [];
      if (!newTagIds.includes(tagId)) {
        newTagIds.push(tagId);
      }
      await PluginAPI.updateTask(task.id, { tagIds: newTagIds });
    }
    PluginAPI.showSnack({
      msg: `Marked ${unlinked.length} tasks for sync — next poll will create cards`,
      type: 'SUCCESS',
    });
  } catch (e) {
    PluginAPI.showSnack({
      msg: `Error: ${e instanceof Error ? e.message : String(e)}`,
      type: 'ERROR',
    });
  }
}

async function createCardInDeck(
  title: string,
  config: DeckConfig,
  http: PluginHttp,
): Promise<{ issueId: string }> {
  const boardId = parseInt(config.boardId, 10);
  const stackId = parseInt(config.defaultStackId || '0', 10);
  if (!stackId) throw new Error('No default stack configured');
  const res = await http.post<DeckCard>(
    `${getBaseUrl(config)}/boards/${boardId}/stacks/${stackId}/cards`,
    { title, type: 'plain', owner: config.username },
  );
  return { issueId: String(res.id) };
}

async function processUnlinkedTasks(
  config: DeckConfig,
  http: PluginHttp,
): Promise<void> {
  try {
    const tagId = await _ensureSyncTag();
    const tasks = await PluginAPI.getTasks();
    const tagged = tasks.filter(
      (t: SpTask) => !t.issueId && !t.isDone && (t.tagIds || []).includes(tagId),
    );
    if (tagged.length === 0) return;

    const allCards = await getAllCards(config, http);
    let created = 0;

    for (const task of tagged) {
      // Dedup: skip if card with same title already exists
      const exists = allCards.some(
        ({ card }) => card.title.toLowerCase() === task.title.toLowerCase(),
      );
      if (exists) {
        const newTagIds = (task.tagIds || []).filter((id: string) => id !== tagId);
        await PluginAPI.updateTask(task.id, { tagIds: newTagIds });
        continue;
      }

      const result = await createCardInDeck(task.title, config, http);
      created++;

      const newTagIds = (task.tagIds || []).filter((id: string) => id !== tagId);
      await PluginAPI.updateTask(task.id, {
        issueId: result.issueId,
        tagIds: newTagIds,
      });
    }

    if (created > 0) {
      PluginAPI.showSnack({
        msg: `Created ${created} card(s) in Deck`,
        type: 'SUCCESS',
      });
    }
  } catch (e) {
    PluginAPI.showSnack({
      msg: `Auto-sync error: ${e instanceof Error ? e.message : String(e)}`,
      type: 'ERROR',
    });
  }
}

// Register header button for manual sync
PluginAPI.registerHeaderButton({
  label: 'Sync unlinked',
  icon: 'sync',
  onClick: _onSyncButtonClick,
});

PluginAPI.registerIssueProvider({
  // ── Configuration UI ──────────────────────────────────────────────────────
  configFields: [
    {
      key: 'serverUrl',
      type: 'input',
      label: 'Nextcloud URL',
      required: true,
      description: 'e.g. https://cloud.example.com',
    },
    {
      key: 'username',
      type: 'input',
      label: 'Username',
      required: true,
    },
    {
      key: 'password',
      type: 'password',
      label: 'App Password',
      required: true,
      description: 'Generate in Nextcloud Settings → Security → App Passwords',
    },
    {
      key: 'boardId',
      type: 'select',
      label: 'Board',
      required: true,
      showIf: 'serverUrl',
      async loadOptions(
        config: Record<string, unknown>,
        http: PluginHttp,
      ): Promise<{ label: string; value: string }[]> {
        try {
          const boards = await http.get<import('./deck-client').DeckBoard[]>(
            `${getBaseUrl(config as unknown as DeckConfig)}/boards`,
          );
          return boards
            .filter((b) => !b.archived)
            .map((b) => ({ label: b.title, value: String(b.id) }));
        } catch {
          return [{ label: '(failed to load)', value: '' }];
        }
      },
    },
    {
      key: 'importStackIds',
      type: 'multiSelect',
      label: 'Import Stacks',
      description: 'Cards from which stacks should be imported? Empty = all.',
      showIf: 'boardId',
      async loadOptions(
        config: Record<string, unknown>,
        http: PluginHttp,
      ): Promise<{ label: string; value: string }[]> {
        try {
          const boardId = (config as Record<string, string>).boardId;
          if (!boardId) return [];
          const stacks = await http.get<import('./deck-client').DeckStack[]>(
            `${getBaseUrl(config as unknown as DeckConfig)}/boards/${boardId}/stacks`,
          );
          return stacks.map((s) => ({ label: s.title, value: String(s.id) }));
        } catch {
          return [{ label: '(failed to load)', value: '' }];
        }
      },
    },
    {
      key: 'defaultStackId',
      type: 'select',
      label: 'Default Stack for New Cards',
      description: 'Stack where newly created SP tasks are placed as cards.',
      required: true,
      showIf: 'boardId',
      async loadOptions(
        config: Record<string, unknown>,
        http: PluginHttp,
      ): Promise<{ label: string; value: string }[]> {
        try {
          const boardId = (config as Record<string, string>).boardId;
          if (!boardId) return [];
          const stacks = await http.get<import('./deck-client').DeckStack[]>(
            `${getBaseUrl(config as unknown as DeckConfig)}/boards/${boardId}/stacks`,
          );
          return stacks.map((s) => ({ label: s.title, value: String(s.id) }));
        } catch {
          return [{ label: '(failed to load)', value: '' }];
        }
      },
    },
    {
      key: 'autoCreateUnlinked',
      type: 'checkbox',
      label: 'Auto-create cards for unlinked tasks',
      description:
        'When enabled, clicking the "Sync unlinked" header button creates Deck cards for tasks without an issueId. Works on all non-done tasks without a linked card.',
      default: false,
    },
  ],

  // ── HTTP Headers: Basic Auth ──────────────────────────────────────────────
  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as DeckConfig;
    if (!cfg.username || !cfg.password) return {};
    const credentials = encodeBasicAuth(cfg.username, cfg.password);
    return {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/json',
    };
  },

  // ── Search Cards ──────────────────────────────────────────────────────────
  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ) {
    try {
      const all = await getAllCards(config as unknown as DeckConfig, http);
      const term = searchTerm.toLowerCase();
      return all
        .filter(({ card }) => card.title.toLowerCase().includes(term))
        .map(({ card }) => mapDeckCardToSearchResult(card));
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Get Single Card ───────────────────────────────────────────────────────
  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ) {
    const cfg = config as unknown as DeckConfig;
    const boardId = parseInt(cfg.boardId, 10);
    const cardId = parseInt(issueId, 10);
    try {
      const stack = await findCardStack(cfg, http, boardId, cardId);
      if (!stack) throw new Error(`Card ${issueId} not found`);
      const card = stack.cards?.find((c) => c.id === cardId);
      if (!card) throw new Error(`Card ${issueId} not found`);
      return mapDeckCardToIssue(card);
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Card Link ─────────────────────────────────────────────────────────────
  getIssueLink(issueId: string, config: Record<string, unknown>): string {
    const cfg = config as unknown as DeckConfig;
    const base = (cfg.serverUrl || '').replace(/\/+$/, '');
    return `${base}/index.php/apps/deck/#/board/${cfg.boardId}/card/${issueId}`;
  },

  // ── Display Fields ────────────────────────────────────────────────────────
  issueDisplay: [
    { field: 'title', label: 'Title', type: 'link', linkField: 'url' },
    { field: 'state', label: 'Status', type: 'text' },
    { field: 'assignee', label: 'Assignee', type: 'text', hideEmpty: true },
    { field: 'labels', label: 'Labels', type: 'list', hideEmpty: true },
    { field: 'duedate', label: 'Due Date', type: 'date', hideEmpty: true },
    { field: 'body', label: 'Description', type: 'markdown' },
  ],

  // ── Test Connection ───────────────────────────────────────────────────────
  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      await http.get(`${getBaseUrl(config as unknown as DeckConfig)}/boards`);
      return true;
    } catch {
      return false;
    }
  },

  // ── Backlog Import ────────────────────────────────────────────────────────
  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ) {
    try {
      const all = await getAllCards(config as unknown as DeckConfig, http);
      const backlog = all
        .filter(({ card }) => !card.done && !card.archived)
        .map(({ card }) => mapDeckCardToSearchResult(card));

      // Auto-create cards for unlinked tasks if enabled
      const cfg = config as unknown as DeckConfig;
      if (cfg.autoCreateUnlinked) {
        await processUnlinkedTasks(cfg, http);
      }

      return backlog;
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Two-Way Sync Field Mappings ──────────────────────────────────────────
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'done',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string | null =>
        taskValue ? new Date().toISOString() : null,
      toTaskValue: (issueValue: unknown): boolean =>
        issueValue === true || typeof issueValue === 'string',
    },
    {
      taskField: 'title',
      issueField: 'title',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown) => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown) => (issueValue as string) ?? '',
    },
    {
      taskField: 'notes',
      issueField: 'description',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown) => (taskValue as string) ?? '',
      toTaskValue: (issueValue: unknown) => (issueValue as string) ?? '',
    },
    {
      taskField: 'dueDay',
      issueField: 'duedate',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueWithTime'],
      toIssueValue: (taskValue: unknown): string | null =>
        (taskValue as string) || null,
      toTaskValue: (issueValue: unknown): string | null =>
        (issueValue as string) || null,
    },
  ] satisfies PluginFieldMapping[],

  // ── Push Changes to Deck ──────────────────────────────────────────────────
  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = config as unknown as DeckConfig;
    if (!cfg.username || !cfg.password) {
      throw new Error(t('ERRORS.TOKEN_REQUIRED'));
    }
    const boardId = parseInt(cfg.boardId, 10);
    const cardId = parseInt(id, 10);

    try {
      const stack = await findCardStack(cfg, http, boardId, cardId);
      if (!stack) throw new Error(`Card ${id} not found`);

      await http.put(
        `${getBaseUrl(cfg)}/boards/${boardId}/stacks/${stack.id}/cards/${cardId}`,
        { type: 'plain', owner: cfg.username, ...changes },
      );
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Create Card in Deck ───────────────────────────────────────────────────
  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ) {
    const cfg = config as unknown as DeckConfig;
    if (!cfg.username || !cfg.password) {
      throw new Error(t('ERRORS.TOKEN_REQUIRED'));
    }

    try {
      const result = await createCardInDeck(title, cfg, http);
      return {
        issueId: result.issueId,
        issueData: {
          id: result.issueId,
          title,
          body: '',
          state: 'open',
          lastUpdated: Date.now(),
        },
      };
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Delete Card ────────────────────────────────────────────────────
  async deleteIssue(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = config as unknown as DeckConfig;
    const boardId = parseInt(cfg.boardId, 10);
    const cardId = parseInt(id, 10);
    try {
      const stack = await findCardStack(cfg, http, boardId, cardId);
      if (!stack) return;
      await http.delete(
        `${getBaseUrl(cfg)}/boards/${boardId}/stacks/${stack.id}/cards/${cardId}`,
      );
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Extract Sync Values (conflict detection) ──────────────────────────────
  extractSyncValues(issue: import('../../shared/src/plugin-api-types').PluginIssue): Record<string, unknown> {
    return {
      done: issue.state === 'done',
      title: issue.title,
      description: issue.body,
      duedate: issue.duedate,
    };
  },
});
