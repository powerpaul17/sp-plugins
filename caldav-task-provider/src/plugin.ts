import type {
  IssueProviderPluginDefinition,
  PluginHttp,
  PluginIssue,
  PluginSearchResult,
} from './plugin-api-types';

declare const PluginAPI: {
  registerIssueProvider(definition: IssueProviderPluginDefinition): void;
  translate(key: string, params?: Record<string, string | number>): string;
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CaldavConfig {
  serverUrl: string;
  username: string;
  password: string;
  calendarHref: string;
}

interface CalendarInfo {
  href: string;
  displayName: string;
}

interface ParsedVtodo {
  href: string;
  etag: string;
  uid: string;
  summary: string;
  description: string;
  dtstart: string;       // raw iCal value (e.g. "20260320T100000Z")
  dtstartParams: string;  // e.g. "VALUE=DATE" or "TZID=..."
  due: string;
  dueParams: string;
  completed: string;     // raw iCal value or empty
  status: string;
  priority: string;
  categories: string;
  location: string;
  percentComplete: string;
  duration: string;
  lastModified: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DAV_NS = 'DAV:';
const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';
const CS_NS = 'http://calendarserver.org/ns/';

// ---------------------------------------------------------------------------
// Helpers: HTTP
// ---------------------------------------------------------------------------

const getServerUrl = (cfg: CaldavConfig): string =>
  (cfg.serverUrl || '').replace(/\/+$/, '');

const t = (key: string): string => {
  try {
    return PluginAPI.translate(key);
  } catch {
    return key;
  }
};

const isAuthError = (err: unknown): boolean =>
  typeof err === 'object' && err !== null && typeof (err as Record<string, unknown>).status === 'number'
    ? [401, 403, 404].includes((err as { status: number }).status)
    : false;

// ---------------------------------------------------------------------------
// Helpers: iCal Text
// ---------------------------------------------------------------------------

const unfoldIcal = (data: string): string =>
  data.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');

const escapeIcalText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');

const unescapeIcalText = (text: string): string =>
  text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');

/** Fold long iCal lines at 75 octets (RFC 5545 §3.1). */
const _encoder = new TextEncoder();
const _decoder = new TextDecoder();
const foldIcalLine = (line: string): string => {
  const bytes = _encoder.encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let offset = 0;
  let first = true;
  while (offset < bytes.length) {
    const max = first ? 75 : 74;
    let end = Math.min(offset + max, bytes.length);
    while (end > offset && (bytes[end] & 0xc0) === 0x80) end--;
    if (end === offset) end = offset + 1;
    parts.push(_decoder.decode(bytes.slice(offset, end)));
    offset = end;
    first = false;
  }
  return parts.join('\r\n ');
};

/** Extract a property value from unfolded iCal lines. */
const getIcalProp = (lines: string[], name: string): string => {
  const p1 = name + ':';
  const p2 = name + ';';
  for (const line of lines) {
    if (line.startsWith(p1)) return line.slice(p1.length);
    if (line.startsWith(p2)) {
      const ci = line.indexOf(':');
      if (ci !== -1) return line.slice(ci + 1);
    }
  }
  return '';
};

/** Extract property parameters (e.g. "VALUE=DATE" or "TZID=Europe/Vienna"). */
const getIcalPropParams = (lines: string[], name: string): string => {
  const p = name + ';';
  for (const line of lines) {
    if (line.startsWith(p)) {
      const ci = line.indexOf(':');
      if (ci !== -1) return line.slice(p.length, ci);
    }
  }
  return '';
};

/** Parse iCal date/time value → Date. */
const parseIcalDateTime = (value: string, _params: string): Date | null => {
  if (!value) return null;
  if (value.length === 8) {
    // Date-only: YYYYMMDD
    const d = new Date(
      parseInt(value.slice(0, 4), 10),
      parseInt(value.slice(4, 6), 10) - 1,
      parseInt(value.slice(6, 8), 10),
    );
    return isNaN(d.getTime()) ? null : d;
  }
  const y = parseInt(value.slice(0, 4), 10);
  const m = parseInt(value.slice(4, 6), 10) - 1;
  const d = parseInt(value.slice(6, 8), 10);
  const h = parseInt(value.slice(9, 11), 10);
  const min = parseInt(value.slice(11, 13), 10);
  const s = parseInt(value.slice(13, 15), 10);
  if (value.endsWith('Z')) {
    return new Date(Date.UTC(y, m, d, h, min, s));
  }
  return new Date(y, m, d, h, min, s);
};

const toIcalUtc = (date: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  );
};

const toIcalDate = (date: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
};

// ---------------------------------------------------------------------------
// Helpers: VTODO parsing
// ---------------------------------------------------------------------------

/** Parse VTODO blocks from unfolded iCal data. */
const parseVtodos = (icalData: string, href: string, etag: string): ParsedVtodo | null => {
  const unfolded = unfoldIcal(icalData);
  const start = unfolded.indexOf('BEGIN:VTODO');
  if (start === -1) return null;
  const end = unfolded.indexOf('END:VTODO', start);
  if (end === -1) return null;
  const block = unfolded.slice(start, end + 'END:VTODO'.length);
  const lines = block.split(/\r?\n/).filter((l) => l.length > 0);

  return {
    href,
    etag,
    uid: getIcalProp(lines, 'UID'),
    summary: unescapeIcalText(getIcalProp(lines, 'SUMMARY')),
    description: unescapeIcalText(getIcalProp(lines, 'DESCRIPTION')),
    dtstart: getIcalProp(lines, 'DTSTART'),
    dtstartParams: getIcalPropParams(lines, 'DTSTART'),
    due: getIcalProp(lines, 'DUE'),
    dueParams: getIcalPropParams(lines, 'DUE'),
    completed: getIcalProp(lines, 'COMPLETED'),
    status: getIcalProp(lines, 'STATUS'),
    priority: getIcalProp(lines, 'PRIORITY'),
    categories: getIcalProp(lines, 'CATEGORIES'),
    location: getIcalProp(lines, 'LOCATION'),
    percentComplete: getIcalProp(lines, 'PERCENT-COMPLETE'),
    duration: getIcalProp(lines, 'DURATION'),
    lastModified: getIcalProp(lines, 'LAST-MODIFIED'),
  };
};

/** Build a complete iCalendar string for a VTODO. */
const buildIcalTask = (task: {
  uid: string;
  summary: string;
  description?: string;
  dtstart?: string;
  dtstartParam?: string;
  due?: string;
  dueParam?: string;
  completed?: string;
  status?: string;
  priority?: string;
  categories?: string;
  location?: string;
}): string => {
  const now = toIcalUtc(new Date());
  const l: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Super Productivity//CalDAV Tasks//EN',
    'BEGIN:VTODO',
    foldIcalLine(`UID:${task.uid}`),
    `DTSTAMP:${now}`,
  ];

  if (task.dtstart) {
    l.push(
      task.dtstartParam
        ? foldIcalLine(`DTSTART;${task.dtstartParam}:${task.dtstart}`)
        : foldIcalLine(`DTSTART:${task.dtstart}`),
    );
  }
  if (task.due) {
    l.push(
      task.dueParam
        ? foldIcalLine(`DUE;${task.dueParam}:${task.due}`)
        : foldIcalLine(`DUE:${task.due}`),
    );
  }
  if (task.completed) {
    l.push(`COMPLETED:${task.completed}`);
  }
  if (task.status) {
    l.push(`STATUS:${task.status}`);
  }
  l.push(foldIcalLine(`SUMMARY:${escapeIcalText(task.summary)}`));
  if (task.description) {
    l.push(foldIcalLine(`DESCRIPTION:${escapeIcalText(task.description)}`));
  }
  if (task.priority) {
    l.push(`PRIORITY:${task.priority}`);
  }
  if (task.categories) {
    l.push(foldIcalLine(`CATEGORIES:${task.categories}`));
  }
  if (task.location) {
    l.push(foldIcalLine(`LOCATION:${escapeIcalText(task.location)}`));
  }
  l.push(`LAST-MODIFIED:${now}`);
  l.push('END:VTODO');
  l.push('END:VCALENDAR');
  return l.join('\r\n') + '\r\n';
};

/**
 * Modify selected properties in an existing iCal VTODO string.
 * Only touches properties inside the VTODO block.
 */
const modifyIcalTask = (icalData: string, changes: Record<string, string>): string => {
  const lines = unfoldIcal(icalData).split(/\r?\n/);
  const now = toIcalUtc(new Date());

  // Index changes by base property name
  const changeMap = new Map<string, string>();
  for (const [prop, value] of Object.entries(changes)) {
    changeMap.set(prop.split(/[;:]/)[0], value ? foldIcalLine(`${prop}:${value}`) : '');
  }

  const replaced = new Set<string>();
  const result: string[] = [];
  let inVtodo = false;

  for (const line of lines) {
    const base = line.split(/[;:]/)[0];

    if (line === 'BEGIN:VTODO') inVtodo = true;
    if (line === 'END:VTODO') inVtodo = false;

    if (!inVtodo) {
      result.push(line);
      continue;
    }

    // Skip lines for properties that have replacements
    if (changeMap.has(base) && !replaced.has(base)) {
      const val = changeMap.get(base)!;
      if (val) result.push(val);
      replaced.add(base);
      continue;
    } else if (changeMap.has(base)) {
      continue; // duplicate → skip
    }

    // Auto-update timestamps
    if (base === 'LAST-MODIFIED' || base === 'DTSTAMP') {
      result.push(`${base}:${now}`);
      continue;
    }
    if (base === 'SEQUENCE') {
      const seq = parseInt(line.split(':')[1] || '0', 10) + 1;
      result.push(`SEQUENCE:${seq}`);
      continue;
    }

    result.push(line);
  }

  // Insert new properties that didn't replace existing ones
  if (inVtodo) {
    // Actually we exited VTODO — insert before END:VTODO
    const endIdx = result.findIndex((l) => l === 'END:VTODO');
    if (endIdx !== -1) {
      const insert: string[] = [];
      for (const [baseName, val] of changeMap) {
        if (!replaced.has(baseName) && val) {
          insert.push(val);
        }
      }
      const hasSeq = result.slice(0, endIdx).some((l) => l.startsWith('SEQUENCE:'));
      if (!hasSeq) insert.push('SEQUENCE:1');
      result.splice(endIdx, 0, ...insert);
    }
  }

  return result.join('\r\n') + '\r\n';
};

// ---------------------------------------------------------------------------
// Helpers: XML & WebDAV
// ---------------------------------------------------------------------------

/** Build PROPFIND body for calendar discovery. */
const buildPropfind = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:cs="${CS_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

/** Build REPORT calendar-query body for VTODO. */
const buildCalendarQuery = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="${DAV_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VTODO"/>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

/** Get text content from an XML element by local name across namespaces. */
const getXmlText = (parent: Element, localName: string): string => {
  for (const ns of [DAV_NS, CALDAV_NS, CS_NS]) {
    const el = parent.getElementsByTagNameNS(ns, localName)[0];
    if (el?.textContent) return el.textContent;
  }
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName && all[i].textContent) {
      return all[i].textContent!;
    }
  }
  return '';
};

/** Check if element supports a given calendar component. */
const supportsComponent = (parent: Element, name: string): boolean => {
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === 'comp' && all[i].getAttribute('name') === name) return true;
    if (
      all[i].localName === 'supported-calendar-component-set' &&
      all[i].textContent?.includes(name)
    )
      return true;
  }
  return false;
};

/** Parse PROPFIND multistatus → list of VTODO-supporting calendars. */
const parseCalendarList = (xml: string): CalendarInfo[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const responses = doc.getElementsByTagNameNS(DAV_NS, 'response');
  const results: CalendarInfo[] = [];
  for (let i = 0; i < responses.length; i++) {
    const resp = responses[i];
    const href = getXmlText(resp, 'href');
    if (!href) continue;
    const resourcetype = resp.getElementsByTagNameNS(DAV_NS, 'resourcetype')[0];
    if (!resourcetype) continue;

    // Must be a calendar (has <d:collection> + <c:calendar>)
    const isCalendar =
      resourcetype.getElementsByTagNameNS(DAV_NS, 'collection').length > 0 &&
      resourcetype.getElementsByTagNameNS(CALDAV_NS, 'calendar').length > 0;
    if (!isCalendar) continue;

    // Must support VTODO
    if (!supportsComponent(resp, 'VTODO')) continue;

    const displayName = getXmlText(resp, 'displayname') || href.replace(/.*\//, '');
    results.push({ href, displayName });
  }
  return results;
};

/** Parse REPORT multistatus → list of ParsedVtodo. */
const parseTaskReport = (xml: string): ParsedVtodo[] => {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const responses = doc.getElementsByTagNameNS(DAV_NS, 'response');
  const tasks: ParsedVtodo[] = [];
  for (let i = 0; i < responses.length; i++) {
    const resp = responses[i];
    const href = getXmlText(resp, 'href');
    if (!href) continue;
    const etag = getXmlText(resp, 'getetag') || '';
    const calData = getXmlText(resp, 'calendar-data');
    if (!calData) continue;
    const parsed = parseVtodos(calData, href, etag);
    if (parsed) tasks.push(parsed);
  }
  return tasks;
};

// ---------------------------------------------------------------------------
// Helpers: Mapping
// ---------------------------------------------------------------------------

const mapVtodoToSearchResult = (vt: ParsedVtodo): PluginSearchResult => ({
  id: vt.href, // compound: we use the href as unique ID
  title: vt.summary || '(untitled)',
  status: vt.status || (vt.completed ? 'COMPLETED' : 'NEEDS-ACTION'),
});

const mapVtodoToIssue = (vt: ParsedVtodo): PluginIssue => {
  const isDateOnly = vt.due?.length === 8 || vt.dueParams?.includes('VALUE=DATE');
  const dueDate = parseIcalDateTime(vt.due, vt.dueParams);
  const dtstartDate = parseIcalDateTime(vt.dtstart, vt.dtstartParams);

  return {
    id: vt.href,
    title: vt.summary || '(untitled)',
    body: vt.description || '',
    state: vt.status || (vt.completed ? 'COMPLETED' : 'NEEDS-ACTION'),
    lastUpdated: vt.lastModified ? parseIcalDateTime(vt.lastModified, '')?.getTime() : undefined,
    labels: vt.categories ? vt.categories.split(',').map((c) => c.trim()).filter(Boolean) : [],
    priority: vt.priority ? parseInt(vt.priority, 10) : undefined,
    dueDateString: vt.due,
    dueDate: dueDate?.toISOString(),
    dueIsDateOnly: isDateOnly,
    dtstartDate: dtstartDate?.toISOString(),
    completedDate: vt.completed ? parseIcalDateTime(vt.completed, '')?.toISOString() : undefined,
    location: vt.location,
    percentComplete: vt.percentComplete ? parseInt(vt.percentComplete, 10) : undefined,
  };
};

// ---------------------------------------------------------------------------
// Plugin Registration
// ---------------------------------------------------------------------------

PluginAPI.registerIssueProvider({
  // ── Configuration UI ──────────────────────────────────────────────────────
  configFields: [
    {
      key: 'serverUrl',
      type: 'input',
      label: 'CalDAV Server URL',
      required: true,
      description:
        'e.g. https://cloud.example.com/remote.php/dav/principals/users/username/',
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
      key: 'calendarHref',
      type: 'select',
      label: 'Task Calendar',
      required: true,
      showIf: 'serverUrl',
      async loadOptions(
        config: Record<string, unknown>,
        http: PluginHttp,
      ): Promise<{ label: string; value: string }[]> {
        try {
          const cfg = config as unknown as CaldavConfig;
          const base = getServerUrl(cfg);
          // PROPFIND the user's calendar home
          const xml = await http.request<string>(
            'PROPFIND',
            base,
            buildPropfind(),
            { headers: { 'Content-Type': 'application/xml; charset=UTF-8', Depth: '1' }, responseType: 'text' },
          );
          const calendars = parseCalendarList(xml);
          return calendars.map((c) => ({ label: c.displayName, value: c.href }));
        } catch {
          return [{ label: '(failed to load calendars)', value: '' }];
        }
      },
    },
  ],

  // ── HTTP Headers ──────────────────────────────────────────────────────────
  getHeaders(config: Record<string, unknown>): Record<string, string> {
    const cfg = config as unknown as CaldavConfig;
    if (!cfg.username || !cfg.password) return {};
    const creds = btoa(
      unescape(encodeURIComponent(`${cfg.username}:${cfg.password}`)),
    );
    return {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/json',
    };
  },

  // ── Search Tasks ──────────────────────────────────────────────────────────
  async searchIssues(
    searchTerm: string,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
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
    http: PluginHttp,
  ): Promise<PluginIssue> {
    try {
      const cfg = config as unknown as CaldavConfig;
      // issueId is the href from the calendar
      const fullUrl = resolveHref(cfg, issueId);
      const xml = await http.request<string>(
        'REPORT',
        fullUrl,
        buildCalendarQuery(),
        {
          headers: { 'Content-Type': 'application/xml; charset=UTF-8', Depth: '0' },
          responseType: 'text',
        },
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
  getIssueLink(issueId: string, _config: Record<string, unknown>): string {
    // CalDAV doesn't have a universal web UI link
    // For Nextcloud: can link to the Tasks app
    // We return the href as fallback
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
    { field: 'percentComplete', label: '% Complete', type: 'text', hideEmpty: true },
  ],

  // ── Test Connection ───────────────────────────────────────────────────────
  async testConnection(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<boolean> {
    try {
      const base = getServerUrl(config as unknown as CaldavConfig);
      await http.request<string>('PROPFIND', base, buildPropfind(), {
        headers: { 'Content-Type': 'application/xml; charset=UTF-8', Depth: '0' },
        responseType: 'text',
      });
      return true;
    } catch {
      return false;
    }
  },

  // ── Backlog Import ────────────────────────────────────────────────────────
  async getNewIssuesForBacklog(
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<PluginSearchResult[]> {
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
      toTaskValue: (issueValue: unknown): boolean =>
        issueValue === 'COMPLETED',
    },
    {
      taskField: 'title',
      issueField: 'summary',
      defaultDirection: 'both',
      toIssueValue: (v: unknown) => (v as string) ?? '',
      toTaskValue: (v: unknown) => (v as string) ?? '',
    },
    {
      taskField: 'notes',
      issueField: 'description',
      defaultDirection: 'both',
      toIssueValue: (v: unknown) => (v as string) ?? '',
      toTaskValue: (v: unknown) => (v as string) ?? '',
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
      },
    },
    {
      taskField: 'dueDay',
      issueField: 'due_dateonly',
      defaultDirection: 'both',
      mutuallyExclusive: ['dueWithTime'],
      toIssueValue: (taskValue: unknown): string =>
        taskValue ? toIcalDate(new Date(taskValue as string + 'T12:00:00')) : '',
      toTaskValue: (issueValue: unknown): string | undefined => {
        if (!issueValue) return undefined;
        const d = parseIcalDateTime(issueValue as string, '');
        if (!d) return undefined;
        return toIcalDate(d);
      },
    },
    {
      taskField: 'timeEstimate',
      issueField: 'duration',
      defaultDirection: 'pullOnly',
      toIssueValue: (v: unknown) => v,
      toTaskValue: (issueValue: unknown): number | undefined => {
        if (!issueValue) return undefined;
        return parseDuration(issueValue as string);
      },
    },
  ],

  // ── Push Changes to CalDAV ────────────────────────────────────────────────
  async updateIssue(
    id: string,
    changes: Record<string, unknown>,
    config: Record<string, unknown>,
    http: PluginHttp,
  ): Promise<void> {
    const cfg = config as unknown as CaldavConfig;
    const fullUrl = resolveHref(cfg, id);

    try {
      // 1. Fetch current iCal data (with etag for conditional PUT)
      const currentXml = await http.request<string>(
        'REPORT',
        fullUrl,
        buildCalendarQuery(),
        {
          headers: { 'Content-Type': 'application/xml; charset=UTF-8', Depth: '0' },
          responseType: 'text',
        },
      );
      const tasks = parseTaskReport(currentXml);
      if (tasks.length === 0) throw new Error(`Task ${id} not found`);
      const vt = tasks[0];

      // 2. Fetch raw iCal data for modification
      const rawIcal = await http.request<string>('GET', fullUrl, undefined, {
        headers: { Accept: 'text/calendar; charset=utf-8' },
        responseType: 'text',
      });

      // 3. Build iCal changes
      const icalChanges: Record<string, string> = {};

      if ('status' in changes) {
        icalChanges['STATUS'] = changes['status'] as string;
        if (changes['status'] === 'COMPLETED') {
          icalChanges['COMPLETED'] = toIcalUtc(new Date());
        } else {
          // Remove COMPLETED when un-done by setting empty
          icalChanges['COMPLETED'] = '';
        }
      }
      if ('summary' in changes) {
        icalChanges['SUMMARY'] = escapeIcalText(changes['summary'] as string);
      }
      if ('description' in changes) {
        icalChanges['DESCRIPTION'] = escapeIcalText(changes['description'] as string);
      }
      if ('due_timed' in changes && changes['due_timed']) {
        icalChanges['DUE'] = changes['due_timed'] as string;
      } else if ('due_dateonly' in changes && changes['due_dateonly']) {
        icalChanges['DUE;VALUE=DATE'] = changes['due_dateonly'] as string;
      } else if ('due_timed' in changes || 'due_dateonly' in changes) {
        // Clearing due date
        icalChanges['DUE'] = '';
      }

      // 4. Apply modifications
      const modified = modifyIcalTask(rawIcal, icalChanges);

      // 5. PUT with If-Match (etag)
      const headers: Record<string, string> = {
        'Content-Type': 'text/calendar; charset=utf-8',
      };
      if (vt.etag) {
        headers['If-Match'] = vt.etag;
      }

      await http.request<string>('PUT', fullUrl, modified, {
        headers,
        responseType: 'text',
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
    http: PluginHttp,
  ): Promise<{ issueId: string; issueData: PluginIssue }> {
    const cfg = config as unknown as CaldavConfig;
    const uuid = generateUuid();
    const taskHref = `${cfg.calendarHref.replace(/\/?$/, '/')}${uuid}.ics`;

    const icalBody = buildIcalTask({
      uid: uuid,
      summary: title,
      status: 'NEEDS-ACTION',
    });

    try {
      await http.request<string>('PUT', taskHref, icalBody, {
        headers: { 'Content-Type': 'text/calendar; charset=utf-8' },
        responseType: 'text',
      });
      return {
        issueId: taskHref,
        issueData: {
          id: taskHref,
          title,
          body: '',
          state: 'NEEDS-ACTION',
          lastUpdated: Date.now(),
        },
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
    http: PluginHttp,
  ): Promise<void> {
    const cfg = config as unknown as CaldavConfig;
    const fullUrl = resolveHref(cfg, id);
    try {
      await http.request<string>('DELETE', fullUrl, undefined, {
        responseType: 'text',
      });
    } catch (e) {
      if (isAuthError(e)) {
        // 404 = already deleted, fine
        const status = (e as { status?: number }).status;
        if (status === 404) return;
        throw new Error(t('ERRORS.INSUFFICIENT_PERMISSIONS'));
      }
      throw e;
    }
  },

  // ── Extract Sync Values ───────────────────────────────────────────────────
  extractSyncValues(issue: PluginIssue): Record<string, unknown> {
    return {
      summary: issue.title,
      description: issue.body,
      status: issue.state,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal Helpers
// ---------------------------------------------------------------------------

/** Fetch all VTODO tasks from the configured calendar. */
async function fetchTasks(
  cfg: CaldavConfig,
  http: PluginHttp,
): Promise<ParsedVtodo[]> {
  const calendarHref = cfg.calendarHref;
  if (!calendarHref) return [];

  const url = resolveHref(cfg, calendarHref);
  const xml = await http.request<string>('REPORT', url, buildCalendarQuery(), {
    headers: { 'Content-Type': 'application/xml; charset=UTF-8', Depth: '1' },
    responseType: 'text',
  });
  return parseTaskReport(xml);
}

/** Resolve an href (which may be relative or compound) to an absolute URL. */
function resolveHref(cfg: CaldavConfig, href: string): string {
  const base = getServerUrl(cfg);
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  // Remove leading / if base already has a path
  const cleanHref = href.startsWith('/') ? href : '/' + href;
  const baseUrl = base.replace(/\/+$/, '');
  // If base already includes /remote.php/dav/, just append the relative part
  // For Nextcloud: calendarHref is something like /remote.php/dav/calendars/user/calendar/
  if (cleanHref.startsWith('/remote.php')) {
    return baseUrl.split('/remote.php')[0] + cleanHref;
  }
  return baseUrl + cleanHref;
}

/** Generate a v4 UUID (RFC 4122). */
function generateUuid(): string {
  // Use crypto.randomUUID if available, fallback to Math.random
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Parse iCal DURATION to milliseconds. */
function parseDuration(dur: string): number {
  if (!dur) return 0;
  let ms = 0;
  const d = dur.match(/(\d+)D/);
  const h = dur.match(/(\d+)H/);
  const m = dur.match(/(\d+)M/);
  const s = dur.match(/(\d+)S/);
  const w = dur.match(/(\d+)W/);
  if (w) ms += parseInt(w[1], 10) * 7 * 86400000;
  if (d) ms += parseInt(d[1], 10) * 86400000;
  if (h) ms += parseInt(h[1], 10) * 3600000;
  if (m) ms += parseInt(m[1], 10) * 60000;
  if (s) ms += parseInt(s[1], 10) * 1000;
  return ms;
}
