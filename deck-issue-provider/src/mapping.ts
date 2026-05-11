import type { PluginIssue, PluginSearchResult } from '../../shared/src/plugin-api-types';
import type { DeckCard } from './deck-client';

export const mapDeckCardToSearchResult = (
  card: DeckCard,
): PluginSearchResult => ({
  id: String(card.id),
  title: card.title,
  status: card.done ? 'done' : 'open',
  assignee: card.assignedUsers?.[0]?.participant?.displayname,
});

export const mapDeckCardToIssue = (card: DeckCard): PluginIssue => ({
  id: String(card.id),
  title: card.title,
  body: card.description || '',
  state: card.done ? 'done' : 'open',
  lastUpdated: card.lastModified,
  labels: (card.labels || []).map((l) => l.title),
  assignee: card.assignedUsers?.[0]?.participant?.displayname,
  duedate: card.duedate,
});
