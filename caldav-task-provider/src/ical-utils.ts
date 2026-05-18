const _encoder = new TextEncoder();
const _decoder = new TextDecoder();

export const unfoldIcal = (data: string): string =>
  data.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');

export const escapeIcalText = (text: string): string =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');

export const unescapeIcalText = (text: string): string =>
  text
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');

export const splitIcalList = (value: string): string[] => {
  const parts: string[] = [];
  let current = '';
  let i = 0;
  while (i < value.length) {
    if (value[i] === '\\' && i + 1 < value.length) {
      current += value[i] + value[i + 1];
      i += 2;
    } else if (value[i] === ',') {
      parts.push(current);
      current = '';
      i++;
    } else {
      current += value[i];
      i++;
    }
  }
  parts.push(current);
  return parts;
};

export const foldIcalLine = (line: string): string => {
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

export const getIcalProp = (lines: string[], name: string): string => {
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

export const getIcalPropParams = (lines: string[], name: string): string => {
  const p = name + ';';
  for (const line of lines) {
    if (line.startsWith(p)) {
      const ci = line.indexOf(':');
      if (ci !== -1) return line.slice(p.length, ci);
    }
  }
  return '';
};

export const parseIcalDateTime = (
  value: string,
  _params: string
): Date | null => {
  if (!value) return null;
  if (value.length === 8) {
    const y = parseInt(value.slice(0, 4), 10);
    const m = parseInt(value.slice(4, 6), 10) - 1;
    const d = parseInt(value.slice(6, 8), 10);
    const date = new Date(Date.UTC(y, m, d));
    return isNaN(date.getTime()) ? null : date;
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

export const toIcalUtc = (date: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(
      date.getUTCDate()
    )}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(
      date.getUTCSeconds()
    )}Z`
  );
};

export const toIcalDate = (date: Date): string => {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(
    date.getUTCDate()
  )}`;
};

export interface ParsedVtodo {
  href: string;
  etag: string;
  uid: string;
  summary: string;
  description: string;
  dtstart: string;
  dtstartParams: string;
  due: string;
  dueParams: string;
  completed: string;
  status: string;
  priority: string;
  categories: string;
  location: string;
  percentComplete: string;
  duration: string;
  lastModified: string;
  rawIcal: string;
}

export const parseVtodos = (
  icalData: string,
  href: string,
  etag: string
): ParsedVtodo | null => {
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
    rawIcal: icalData
  };
};

export const buildIcalTask = (task: {
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
  categories?: string[];
  location?: string;
}): string => {
  const now = toIcalUtc(new Date());
  const l: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Super Productivity//CalDAV Tasks//EN',
    'BEGIN:VTODO',
    foldIcalLine(`UID:${task.uid}`),
    `DTSTAMP:${now}`
  ];

  if (task.dtstart) {
    l.push(
      task.dtstartParam
        ? foldIcalLine(`DTSTART;${task.dtstartParam}:${task.dtstart}`)
        : foldIcalLine(`DTSTART:${task.dtstart}`)
    );
  }
  if (task.due) {
    l.push(
      task.dueParam
        ? foldIcalLine(`DUE;${task.dueParam}:${task.due}`)
        : foldIcalLine(`DUE:${task.due}`)
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
  if (task.categories?.length) {
    const escaped = task.categories.map((c) => escapeIcalText(c)).join(',');
    l.push(foldIcalLine(`CATEGORIES:${escaped}`));
  }
  if (task.location) {
    l.push(foldIcalLine(`LOCATION:${escapeIcalText(task.location)}`));
  }
  l.push(`LAST-MODIFIED:${now}`);
  l.push('END:VTODO');
  l.push('END:VCALENDAR');
  return l.join('\r\n') + '\r\n';
};

export const modifyIcalTask = (
  icalData: string,
  changes: Record<string, string>
): string => {
  const lines = unfoldIcal(icalData).split(/\r?\n/);
  const now = toIcalUtc(new Date());

  const changeMap = new Map<string, string>();
  for (const [prop, value] of Object.entries(changes)) {
    changeMap.set(
      prop.split(/[;:]/)[0],
      value ? foldIcalLine(`${prop}:${value}`) : ''
    );
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

    if (changeMap.has(base) && !replaced.has(base)) {
      const val = changeMap.get(base)!;
      if (val) result.push(val);
      replaced.add(base);
      continue;
    } else if (changeMap.has(base)) {
      continue;
    }

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
  const endIdx = result.findIndex((l) => l === 'END:VTODO');
  if (endIdx !== -1) {
    const insert: string[] = [];
    for (const [baseName, val] of changeMap) {
      if (!replaced.has(baseName) && val) {
        insert.push(val);
      }
    }
    const hasSeq = result
      .slice(0, endIdx)
      .some((l) => l.startsWith('SEQUENCE:'));
    if (!hasSeq) insert.push('SEQUENCE:1');
    result.splice(endIdx, 0, ...insert);
  }

  return result.join('\r\n') + '\r\n';
};

export function parseDuration(dur: string): number {
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
