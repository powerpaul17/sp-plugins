import type { PluginHttp } from '../../shared/src/plugin-api-types';
import { parseVtodos, type ParsedVtodo } from './ical-utils';

export const DAV_NS = 'DAV:';
export const CALDAV_NS = 'urn:ietf:params:xml:ns:caldav';
export const CS_NS = 'http://calendarserver.org/ns/';

export interface CaldavConfig {
  serverUrl: string;
  username: string;
  password: string;
  calendarHref: string;
}

export interface CalendarInfo {
  href: string;
  displayName: string;
}

export const getServerUrl = (cfg: CaldavConfig): string =>
  (cfg.serverUrl || '').replace(/\/+$/, '');

export function resolveHref(cfg: CaldavConfig, href: string): string {
  const base = getServerUrl(cfg);
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  const cleanHref = href.startsWith('/') ? href : '/' + href;
  const baseUrl = base.replace(/\/+$/, '');
  if (cleanHref.startsWith('/remote.php')) {
    return baseUrl.split('/remote.php')[0] + cleanHref;
  }
  return baseUrl + cleanHref;
}

export const buildPropfind = (): string => `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="${DAV_NS}" xmlns:cs="${CS_NS}" xmlns:c="${CALDAV_NS}">
  <d:prop>
    <d:displayname/>
    <d:resourcetype/>
    <cs:getctag/>
    <c:supported-calendar-component-set/>
  </d:prop>
</d:propfind>`;

export const buildCalendarQuery = (): string => `<?xml version="1.0" encoding="UTF-8"?>
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

export const parseCalendarList = (xml: string): CalendarInfo[] => {
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

    const isCalendar =
      resourcetype.getElementsByTagNameNS(DAV_NS, 'collection').length > 0 &&
      resourcetype.getElementsByTagNameNS(CALDAV_NS, 'calendar').length > 0;
    if (!isCalendar) continue;

    if (!supportsComponent(resp, 'VTODO')) continue;

    const displayName = getXmlText(resp, 'displayname') || href.replace(/.*\//, '');
    results.push({ href, displayName });
  }
  return results;
};

export const parseTaskReport = (xml: string): ParsedVtodo[] => {
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

export async function fetchTasks(
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

export function generateUuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
