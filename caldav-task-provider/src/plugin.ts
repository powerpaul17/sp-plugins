import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginFieldMapping
} from '../../shared/src/plugin-api-types';
import { t, isAuthError, encodeBasicAuth } from '../../shared/src/helpers';
import type { CaldavConfig } from './caldav-client';
import {
  getServerUrl,
  buildPropfind,
  buildCalendarQuery,
  parseTaskReport,
  resolveHref,
  fetchTasks,
  generateUuid
} from './caldav-client';
import {
  escapeIcalText,
  unescapeIcalText,
  splitIcalList,
  toIcalUtc,
  toIcalDate,
  parseIcalDateTime,
  buildIcalTask,
  modifyIcalTask,
  parseDuration
} from './ical-utils';
import { mapVtodoToSearchResult, mapVtodoToIssue } from './mapping';

PluginAPI.registerIssueProvider({
  // ── Configuration UI ──────────────────────────────────────────────────────
  configFields: [
    {
      key: 'calendarUrl',
      type: 'input',
      label: 'Calendar URL',
      required: true,
      description:
        'Full URL to the CalDAV calendar, e.g. https://cloud.example.com/remote.php/dav/calendars/username/personal/'
    },
    {
      key: 'username',
      type: 'input',
      label: 'Username',
      required: true
    },
    {
      key: 'password',
      type: 'password',
      label: 'App Password',
      required: true,
      description: 'Generate in Nextcloud Settings → Security → App Passwords'
    }
  ],

  // ── HTTP Headers ──────────────────────────────────────────────────────────
  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as CaldavConfig;
    if (!cfg.username || !cfg.password) return {};
    const creds = encodeBasicAuth(cfg.username, cfg.password);
    return {
      Authorization: `Basic ${creds}`
    };
  },

  // ── Search Tasks ──────────────────────────────────────────────────────────
  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp
  ) {
    try {
      const cfg = config as unknown as CaldavConfig;
      const tasks = await fetchTasks(cfg, http);
      const term = searchTerm.toLowerCase();
      return tasks
        .filter((t) => t.summary.toLowerCase().includes(term))
        .map(mapVtodoToSearchResult);
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Get Single Task ───────────────────────────────────────────────────────
  async getById(
    issueId: string,
    config: Record<string, unknown>,
    http: PluginHttp
  ) {
    try {
      const cfg = config as unknown as CaldavConfig;
      const fullUrl = resolveHref(cfg, issueId);
      const xml = await http.request<string>(
        'REPORT',
        fullUrl,
        buildCalendarQuery(),
        {
          headers: {
            'Content-Type': 'application/xml; charset=UTF-8',
            Depth: '0'
          },
          responseType: 'text'
        }
      );
      const tasks = parseTaskReport(xml);
      if (tasks.length === 0) throw new Error(`Task ${issueId} not found`);
      return mapVtodoToIssue(tasks[0]);
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Task Link ─────────────────────────────────────────────────────────────
  getIssueLink(issueId: string): string {
    return issueId;
  },

  // ── Display Fields ────────────────────────────────────────────────────────
  issueDisplay: [
    { field: 'title', label: 'Summary', type: 'link', linkField: 'url' },
    { field: 'state', label: 'Status', type: 'text' },
    { field: 'priority', label: 'Priority', type: 'text', hideEmpty: true },
    { field: 'labels', label: 'Categories', type: 'list', hideEmpty: true },
    { field: 'dueDate', label: 'Due', type: 'date', hideEmpty: true },
    { field: 'location', label: 'Location', type: 'text', hideEmpty: true },
    { field: 'body', label: 'Description', type: 'markdown' },
    {
      field: 'percentComplete',
      label: '% Complete',
      type: 'text',
      hideEmpty: true
    },
  ],

  // ── Test Connection ───────────────────────────────────────────────────────
  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp
  ): Promise<boolean> {
    try {
      const cfg = config as unknown as CaldavConfig;
      const base = getServerUrl(cfg);
      await http.request<string>('PROPFIND', base, buildPropfind(), {
        headers: {
          'Content-Type': 'application/xml; charset=UTF-8',
          Depth: '0'
        },
        responseType: 'text'
      });
      if (cfg.calendarUrl) {
        await http.request<string>(
          'PROPFIND',
          cfg.calendarUrl,
          buildPropfind(),
          {
            headers: {
              'Content-Type': 'application/xml; charset=UTF-8',
              Depth: '0'
            },
            responseType: 'text'
          }
        );
      }
      return true;
    } catch {
      return false;
    }
  },

  // ── Backlog Import ────────────────────────────────────────────────────────
  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp
  ) {
    try {
      const tasks = await fetchTasks(config as unknown as CaldavConfig, http);
      return tasks
        .filter((t) => !t.completed && t.status !== 'COMPLETED')
        .map(mapVtodoToSearchResult);
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Two-Way Sync Field Mappings ──────────────────────────────────────────
  fieldMappings: [
    {
      taskField: 'isDone',
      issueField: 'status',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string =>
        taskValue ? 'COMPLETED' : 'NEEDS-ACTION',
      toTaskValue: (issueValue: unknown): boolean => issueValue === 'COMPLETED'
    },
    {
      taskField: 'title',
      issueField: 'summary',
      defaultDirection: 'both',
      toIssueValue: (v: unknown) => (v as string) ?? '',
      toTaskValue: (v: unknown) => (v as string) ?? ''
    },
    {
      taskField: 'notes',
      issueField: 'description',
      defaultDirection: 'both',
      toIssueValue: (v: unknown) => (v as string) ?? '',
      toTaskValue: (v: unknown) => (v as string) ?? ''
    },
    {
      taskField: 'dueWithTime',
      issueField: 'due_timed',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueDay'],
      toIssueValue: (taskValue: unknown): string =>
        taskValue ? toIcalUtc(new Date(taskValue as number | string)) : '',
      toTaskValue: (issueValue: unknown): number | undefined => {
        if (!issueValue) return undefined;
        const d = parseIcalDateTime(issueValue as string, '');
        return d?.getTime();
      }
    },
    {
      taskField: 'dueDay',
      issueField: 'due_dateonly',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueWithTime'],
      toIssueValue: (taskValue: unknown): string =>
        taskValue
          ? toIcalDate(new Date((taskValue as string) + 'T12:00:00'))
          : '',
      toTaskValue: (issueValue: unknown): string | undefined => {
        if (!issueValue) return undefined;
        const d = parseIcalDateTime(issueValue as string, '');
        if (!d) return undefined;
        return toIcalDate(d);
      }
    },
    {
      taskField: 'timeEstimate',
      issueField: 'duration',
      defaultDirection: 'pullOnly',
      toIssueValue: (v: unknown) => v,
      toTaskValue: (issueValue: unknown): number | undefined => {
        if (!issueValue) return undefined;
        return parseDuration(issueValue as string);
      }
    },
    {
      taskField: 'tagIds',
      issueField: 'categories',
      defaultDirection: 'both',
      toIssueValue: (taskValue: unknown): string => {
        const labels = taskValue as string[];
        return labels?.length
          ? labels.map((l) => escapeIcalText(l)).join(',')
          : '';
      },
      toTaskValue: (issueValue: unknown): string[] => {
        if (typeof issueValue === 'string') {
          return splitIcalList(issueValue)
            .map((l) => unescapeIcalText(l.trim()))
            .filter(Boolean);
        }
        if (Array.isArray(issueValue)) return issueValue as string[];
        return [];
      }
    }
  ] satisfies PluginFieldMapping[],

  // ── Push Changes to CalDAV ────────────────────────────────────────────────
  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp
  ): Promise<void> {
    const cfg = config as unknown as CaldavConfig;
    const fullUrl = resolveHref(cfg, id);

    try {
      const currentXml = await http.request<string>(
        'REPORT',
        fullUrl,
        buildCalendarQuery(),
        {
          headers: {
            'Content-Type': 'application/xml; charset=UTF-8',
            Depth: '0'
          },
          responseType: 'text'
        }
      );
      const tasks = parseTaskReport(currentXml);
      if (tasks.length === 0) throw new Error(`Task ${id} not found`);
      const vt = tasks[0];

      const icalChanges: Record<string, string> = {};

      if ('status' in changes) {
        icalChanges['STATUS'] = changes['status'] as string;
        if (changes['status'] === 'COMPLETED') {
          icalChanges['COMPLETED'] = toIcalUtc(new Date());
        } else {
          icalChanges['COMPLETED'] = '';
        }
      }
      if ('summary' in changes) {
        icalChanges['SUMMARY'] = escapeIcalText(changes['summary'] as string);
      }
      if ('description' in changes) {
        icalChanges['DESCRIPTION'] = escapeIcalText(
          changes['description'] as string
        );
      }
      if ('due_timed' in changes && changes['due_timed']) {
        icalChanges['DUE'] = changes['due_timed'] as string;
      } else if ('due_dateonly' in changes && changes['due_dateonly']) {
        icalChanges['DUE;VALUE=DATE'] = changes['due_dateonly'] as string;
      } else if ('due_timed' in changes || 'due_dateonly' in changes) {
        icalChanges['DUE'] = '';
      }
      if ('categories' in changes) {
        icalChanges['CATEGORIES'] = changes['categories'] as string;
      }

      const modified = modifyIcalTask(vt.rawIcal, icalChanges);

      const headers: Record<string, string> = {
        'Content-Type': 'text/calendar; charset=utf-8'
      };
      if (vt.etag) {
        headers['If-Match'] = vt.etag;
      }

      await http.request<string>('PUT', fullUrl, modified, {
        headers,
        responseType: 'text'
      });
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Create Task in CalDAV ─────────────────────────────────────────────────
  async createIssue(
    title: string,
    config: Record<string, unknown>,
    http: PluginHttp
  ) {
    const cfg = config as unknown as CaldavConfig;
    const uuid = generateUuid();
    const baseUrl = cfg.calendarUrl.replace(/\/?$/, '/');
    const taskUrl = baseUrl + uuid + '.ics';
    const taskHref = new URL(taskUrl).pathname;

    const icalBody = buildIcalTask({
      uid: uuid,
      summary: title,
      status: 'NEEDS-ACTION'
    });

    try {
      await http.request<string>('PUT', taskUrl, icalBody, {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        responseType: 'text'
      });
      return {
        issueId: taskHref,
        issueData: {
          id: taskHref,
          title,
          body: '',
          state: 'NEEDS-ACTION',
          lastUpdated: Date.now()
        }
      };
    } catch (e) {
      if (isAuthError(e)) throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      throw e;
    }
  },

  // ── Delete Task ───────────────────────────────────────────────────────────
  async deleteIssue(
    id: string,
    config: Record<string, unknown>,
    http: PluginHttp
  ): Promise<void> {
    const cfg = config as unknown as CaldavConfig;
    const fullUrl = resolveHref(cfg, id);
    try {
      await http.request<string>('DELETE', fullUrl, undefined, {
        responseType: 'text'
      });
    } catch (e) {
      if (isAuthError(e)) {
        const status = (e as { status?: number }).status;
        if (status === 404) return;
        throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      }
      throw e;
    }
  },

  // ── Extract Sync Values ───────────────────────────────────────────────────
  extractSyncValues(
    issue: import('../../shared/src/plugin-api-types').PluginIssue
  ): Record<string, unknown> {
    return {
      summary: issue.title,
      description: issue.body,
      status: issue.state,
      categories: issue.labels?.length ? issue.labels : []
    };
  }
});
