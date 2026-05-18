import type {
  PluginIssue,
  PluginSearchResult
} from '../../shared/src/plugin-api-types';
import type { ParsedVtodo } from './ical-utils';
import {
  parseIcalDateTime,
  splitIcalList,
  unescapeIcalText
} from './ical-utils';

export const mapVtodoToSearchResult = (
  vt: ParsedVtodo
): PluginSearchResult => ({
  id: vt.href,
  title: vt.summary || '(untitled)',
  status: vt.status || (vt.completed ? 'COMPLETED' : 'NEEDS-ACTION')
});

export const mapVtodoToIssue = (vt: ParsedVtodo): PluginIssue => {
  const isDateOnly =
    vt.due?.length === 8 || vt.dueParams?.includes('VALUE=DATE');
  const dueDate = parseIcalDateTime(vt.due, vt.dueParams);
  const dtstartDate = parseIcalDateTime(vt.dtstart, vt.dtstartParams);

  return {
    id: vt.href,
    title: vt.summary || '(untitled)',
    body: vt.description || '',
    state: vt.status || (vt.completed ? 'COMPLETED' : 'NEEDS-ACTION'),
    lastUpdated: vt.lastModified
      ? parseIcalDateTime(vt.lastModified, '')?.getTime()
      : undefined,
    labels: vt.categories
      ? splitIcalList(vt.categories)
          .map((c) => unescapeIcalText(c.trim()))
          .filter(Boolean)
      : [],
    priority: vt.priority ? parseInt(vt.priority, 10) : undefined,
    dueDateString: vt.due,
    dueDate: dueDate?.toISOString(),
    dueIsDateOnly: isDateOnly,
    dtstartDate: dtstartDate?.toISOString(),
    completedDate: vt.completed
      ? parseIcalDateTime(vt.completed, '')?.toISOString()
      : undefined,
    location: vt.location,
    percentComplete: vt.percentComplete
      ? parseInt(vt.percentComplete, 10)
      : undefined,
  };
};
