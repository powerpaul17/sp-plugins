import type { PluginHttp } from '../../shared/src/plugin-api-types';

export interface DeckConfig {
  serverUrl: string;
  username: string;
  password: string;
  boardId: string;
  importStackIds?: string[];
  defaultStackId?: string;
}

export interface DeckBoard {
  id: number;
  title: string;
  archived: boolean;
}

export interface DeckLabel {
  id: number;
  title: string;
  color: string;
}

export interface DeckUser {
  participant: { uid: string; displayname: string };
}

export interface DeckCard {
  id: number;
  title: string;
  description: string;
  duedate: string | null;
  lastModified: number;
  archived: boolean;
  done: boolean;
  order: number;
  labels: DeckLabel[];
  assignedUsers: DeckUser[];
}

export interface DeckStack {
  id: number;
  title: string;
  boardId: number;
  cards: DeckCard[];
}

export const getBaseUrl = (cfg: DeckConfig): string => {
  const url = (cfg.serverUrl || '').replace(/\/+$/, '');
  return `${url}/index.php/apps/deck/api/v1.0`;
};

export async function getAllCards(
  cfg: DeckConfig,
  http: PluginHttp,
): Promise<{ card: DeckCard; stackTitle: string }[]> {
  const boardId = parseInt(cfg.boardId, 10);
  const stacks = await http.get<DeckStack[]>(
    `${getBaseUrl(cfg)}/boards/${boardId}/stacks`,
  );

  const importStackIds: number[] = cfg.importStackIds
    ? cfg.importStackIds.map(Number).filter(Boolean)
    : [];

  const results: { card: DeckCard; stackTitle: string }[] = [];
  for (const stack of stacks) {
    if (importStackIds.length > 0 && !importStackIds.includes(stack.id)) continue;
    if (!stack.cards) continue;
    for (const card of stack.cards) {
      if (card.archived) continue;
      results.push({ card, stackTitle: stack.title });
    }
  }
  return results;
}

export async function findCardStack(
  cfg: DeckConfig,
  http: PluginHttp,
  boardId: number,
  cardId: number,
): Promise<DeckStack | null> {
  const stacks = await http.get<DeckStack[]>(
    `${getBaseUrl(cfg)}/boards/${boardId}/stacks`,
  );
  for (const stack of stacks) {
    if (stack.cards?.some((c) => c.id === cardId)) return stack;
  }
  return null;
}
