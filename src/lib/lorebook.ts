import { isObj, num, str, strArr } from './json';
import type { LoreBook, LoreEntry, LoreLogic } from './types';
import { uid } from './util';

export const POSITIONS = [0, 1, 2, 3, 4, 5, 6] as const;

export function newEntry(p: Partial<LoreEntry> = {}): LoreEntry {
  return {
    id: uid(),
    title: '',
    keys: [],
    secondary: [],
    logic: 0,
    constant: false,
    enabled: true,
    content: '',
    order: 100,
    position: 0,
    depth: 4,
    role: 0,
    probability: 100,
    wholeWords: null,
    ...p,
  };
}

export function emptyBook(name: string): LoreBook {
  return { id: uid(), name, entries: [], updatedAt: Date.now() };
}

export class LoreImportError extends Error {}

const logicOf = (v: unknown): LoreLogic => {
  const n = num(v, 0);
  return n === 1 || n === 2 || n === 3 ? n : 0;
};

const boolOrNull = (v: unknown) => (typeof v === 'boolean' ? v : null);

/** One ST World Info entry. */
function fromST(e: Record<string, unknown>): LoreEntry {
  return newEntry({
    title: str(e.comment),
    keys: strArr(e.key),
    secondary: strArr(e.keysecondary),
    logic: logicOf(e.selectiveLogic),
    constant: !!e.constant,
    enabled: !e.disable,
    content: str(e.content),
    order: num(e.order, 100),
    position: num(e.position, 0),
    depth: num(e.depth, 4),
    role: num(e.role, 0),
    probability: e.useProbability === false ? 100 : num(e.probability, 100),
    wholeWords: boolOrNull(e.matchWholeWords),
    raw: e,
  });
}

/** One Character Card V2/V3 `character_book` entry. */
function fromBook(e: Record<string, unknown>): LoreEntry {
  const ext = isObj(e.extensions) ? e.extensions : {};
  const pos = typeof ext.position === 'number' ? ext.position : e.position === 'after_char' ? 1 : 0;
  return newEntry({
    title: str(e.comment) || str(e.name),
    keys: strArr(e.keys),
    secondary: strArr(e.secondary_keys),
    logic: logicOf(ext.selectiveLogic),
    constant: !!e.constant,
    enabled: e.enabled !== false,
    content: str(e.content),
    order: num(e.insertion_order, 100),
    position: pos,
    depth: num(ext.depth, 4),
    role: num(ext.role, 0),
    probability: num(ext.probability, 100),
    wholeWords: boolOrNull(ext.match_whole_words),
  });
}

/** Accepts an ST World Info file, a bare character_book, or a character card that embeds one. */
export function importLorebook(text: string, fileName: string): LoreBook {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new LoreImportError('json');
  }
  return lorebookFrom(data, fileName.replace(/\.json$/i, ''));
}

export function lorebookFrom(data: unknown, fallbackName: string): LoreBook {
  if (!isObj(data)) throw new LoreImportError('not-lorebook');
  const inner = isObj(data.data) && isObj(data.data.character_book) ? data.data.character_book : isObj(data.character_book) ? data.character_book : data;
  const entriesRaw = inner.entries;
  let entries: LoreEntry[];
  if (Array.isArray(entriesRaw)) entries = entriesRaw.filter(isObj).map(fromBook);
  else if (isObj(entriesRaw))
    entries = Object.values(entriesRaw)
      .filter(isObj)
      .sort((a, b) => num(a.displayIndex ?? a.uid, 0) - num(b.displayIndex ?? b.uid, 0))
      .map(fromST);
  else throw new LoreImportError('not-lorebook');
  const { entries: _e, ...rest } = inner;
  const isST = isObj(entriesRaw);
  return {
    id: uid(),
    name: str(inner.name) || (isObj(data.data) ? str(data.data.name) : '') || fallbackName || 'Lorebook',
    entries,
    raw: isST ? rest : undefined,
    updatedAt: Date.now(),
  };
}

/** Fields SillyTavern writes for a fresh World Info entry. */
const ST_ENTRY_DEFAULTS = {
  key: [],
  keysecondary: [],
  comment: '',
  content: '',
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: true,
  order: 100,
  position: 0,
  disable: false,
  ignoreBudget: false,
  excludeRecursion: false,
  preventRecursion: false,
  delayUntilRecursion: false,
  probability: 100,
  useProbability: true,
  depth: 4,
  group: '',
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  role: 0,
  sticky: 0,
  cooldown: 0,
  delay: 0,
};

/** SillyTavern World Info JSON. */
export function toSTWorld(book: LoreBook) {
  const entries: Record<string, unknown> = {};
  book.entries.forEach((e, i) => {
    const raw = e.raw ?? {};
    entries[String(i)] = {
      ...ST_ENTRY_DEFAULTS,
      ...raw,
      uid: i,
      displayIndex: i,
      key: e.keys,
      keysecondary: e.secondary,
      comment: e.title,
      content: e.content,
      constant: e.constant,
      selective: e.secondary.length > 0 || raw.selective === true,
      selectiveLogic: e.logic,
      order: e.order,
      position: e.position,
      depth: e.depth,
      role: e.role,
      disable: !e.enabled,
      probability: e.probability,
      useProbability: e.probability < 100 || raw.useProbability === true,
      matchWholeWords: e.wholeWords,
    };
  });
  return { ...(book.raw ?? {}), entries };
}

/** Character Card V2 `character_book`, for embedding into a card. */
export function toCharacterBook(book: LoreBook) {
  return {
    name: book.name,
    extensions: {},
    entries: book.entries.map((e, i) => ({
      id: i,
      keys: e.keys,
      secondary_keys: e.secondary,
      comment: e.title,
      content: e.content,
      constant: e.constant,
      selective: e.secondary.length > 0,
      insertion_order: e.order,
      enabled: e.enabled,
      position: e.position === 1 ? 'after_char' : 'before_char',
      extensions: {
        position: e.position,
        depth: e.depth,
        role: e.role,
        probability: e.probability,
        useProbability: e.probability < 100,
        selectiveLogic: e.logic,
        match_whole_words: e.wholeWords,
        display_index: i,
      },
    })),
  };
}
