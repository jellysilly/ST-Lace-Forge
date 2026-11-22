import { useSyncExternalStore } from 'react';
import { idbGet, idbSet } from './idb';
import { inST, stLang } from './st';
import type { CharacterDoc, Connection, Lang, LoreBook, PersonaDoc, PlotDoc, PlotIdea, PresetDoc } from './types';
import type { PlotGenre, PlotTone } from './plot';
import type { CharStyle, LoreStyle, PresetStyle } from './styles';

export interface Settings {
  lang: Lang;
  conn: Connection;
  rememberKey: boolean;
  /** Model context size, used to warn about oversized requests. */
  ctxTokens: number;
  presetStyle: PresetStyle;
  charStyle: CharStyle;
  loreStyle: LoreStyle;
  /** Language the model writes in. */
  outLang: Lang;
  /** Added to every request on every page. */
  globalInstr: string;
  /** Set after a successful connection test or generation. */
  verified: boolean;
  /** Plots anvil: allow explicit adult content. */
  nsfw: boolean;
  /** The user confirmed they are 18+ once; the NSFW switch stops asking. */
  adultOk: boolean;
  plotGenres: PlotGenre[];
  plotTone: PlotTone;
}

export interface Data {
  presets: PresetDoc[];
  presetId: string;
  characters: CharacterDoc[];
  charId: string;
  personas: PersonaDoc[];
  personaId: string;
  lorebooks: LoreBook[];
  bookId: string;
  plots: PlotDoc[];
  plotId: string;
  ideas: PlotIdea[];
}

export interface AppState extends Settings, Data {}

const browserLang = (): Lang => {
  try {
    return /^ru|^uk|^be|^kk/i.test(stLang() || navigator.language) ? 'ru' : 'en';
  } catch {
    return 'ru';
  }
};

const DEFAULT_SETTINGS = (): Settings => {
  const lang = browserLang();
  return {
    lang,
    conn: {
      // Inside SillyTavern the app can generate through ST's own connection — no key needed.
      provider: inST() ? 'st' : 'openai',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiKey: '',
      model: '',
      stream: true,
      temperature: 0.9,
      maxTokens: 4000,
      stProfile: '',
    },
    rememberKey: true,
    ctxTokens: 32000,
    presetStyle: 'directive',
    charStyle: 'prose',
    loreStyle: 'atmo',
    outLang: lang,
    globalInstr: '',
    verified: false,
    nsfw: false,
    adultOk: false,
    plotGenres: [],
    plotTone: 'any',
  };
};

const EMPTY_DATA: Data = {
  presets: [],
  presetId: '',
  characters: [],
  charId: '',
  personas: [],
  personaId: '',
  lorebooks: [],
  bookId: '',
  plots: [],
  plotId: '',
  ideas: [],
};

const SETTINGS_KEY = 'lf.settings';
const KEY_KEY = 'lf.key';
const DATA_KEYS = ['presets', 'presetId', 'characters', 'charId', 'personas', 'personaId', 'lorebooks', 'bookId', 'plots', 'plotId', 'ideas'] as const;

function loadSettings(): Settings {
  const base = DEFAULT_SETTINGS();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return base;
    const s = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...base, ...s, conn: { ...base.conn, ...(s.conn ?? {}) } };
    if (!merged.rememberKey) merged.conn.apiKey = sessionStorage.getItem(KEY_KEY) ?? '';
    return merged;
  } catch {
    return base;
  }
}

const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS()) as (keyof Settings)[];

function saveSettings(s: Settings) {
  const toSave: Record<string, unknown> = {};
  for (const k of SETTING_KEYS) toSave[k] = s[k];
  toSave.conn = { ...s.conn, apiKey: s.rememberKey ? s.conn.apiKey : '' };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(toSave));
    if (s.rememberKey) sessionStorage.removeItem(KEY_KEY);
    else sessionStorage.setItem(KEY_KEY, s.conn.apiKey);
  } catch {
    /* storage blocked — keep working in memory */
  }
}

let state: AppState = { ...(typeof localStorage === 'undefined' ? DEFAULT_SETTINGS() : loadSettings()), ...EMPTY_DATA };
const listeners = new Set<() => void>();
let storageError = false;
const errorListeners = new Set<(failed: boolean) => void>();

/** Loads the documents from IndexedDB. Call once before rendering. */
export async function hydrate() {
  const entries = await Promise.all(DATA_KEYS.map(async (k) => [k, await idbGet(k)] as const));
  const data: Partial<Data> = {};
  for (const [k, v] of entries) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
  state = { ...state, ...data };
}

const pending = new Set<keyof Data>();
let timer: ReturnType<typeof setTimeout> | undefined;

function flush() {
  timer = undefined;
  const keys = [...pending];
  pending.clear();
  Promise.all(keys.map((k) => idbSet(k, state[k]))).then((res) => {
    const failed = res.some((ok) => !ok);
    if (failed !== storageError) {
      storageError = failed;
      errorListeners.forEach((l) => l(failed));
    }
  });
}

export function onStorageError(fn: (failed: boolean) => void) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

function persist(prev: AppState, next: AppState) {
  let settingsChanged = false;
  for (const k of Object.keys(next) as (keyof AppState)[]) {
    if (prev[k] === next[k]) continue;
    if ((DATA_KEYS as readonly string[]).includes(k)) pending.add(k as keyof Data);
    else settingsChanged = true;
  }
  if (settingsChanged) saveSettings(next);
  if (pending.size && !timer) timer = setTimeout(flush, 250);
}

if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    if (timer) {
      clearTimeout(timer);
      flush();
    }
  });

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const prev = state;
  const p = typeof patch === 'function' ? patch(prev) : patch;
  state = { ...prev, ...p };
  persist(prev, state);
  listeners.forEach((l) => l());
}

export const getState = () => state;

export function useStore<T>(sel: (s: AppState) => T): T {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => sel(state),
  );
}

export const setConn = (patch: Partial<Connection>) => setState((s) => ({ conn: { ...s.conn, ...patch }, verified: false }));

/* ───────── collection helpers ───────── */

type ListKey = 'presets' | 'characters' | 'personas' | 'lorebooks' | 'plots';
type Item<K extends ListKey> = AppState[K][number];

export function upsert<K extends ListKey>(key: K, item: Item<K>) {
  setState((s) => {
    const list = s[key] as Item<K>[];
    const stamped = { ...item, updatedAt: Date.now() };
    const exists = list.some((x) => x.id === item.id);
    return { [key]: exists ? list.map((x) => (x.id === item.id ? stamped : x)) : [stamped, ...list] } as Partial<AppState>;
  });
}

export function patchItem<K extends ListKey>(key: K, id: string, fn: (x: Item<K>) => Item<K>) {
  setState((s) => ({ [key]: (s[key] as Item<K>[]).map((x) => (x.id === id ? { ...fn(x), updatedAt: Date.now() } : x)) }) as Partial<AppState>);
}

export function removeItem<K extends ListKey>(key: K, id: string) {
  setState((s) => ({ [key]: (s[key] as Item<K>[]).filter((x) => x.id !== id) }) as Partial<AppState>);
}
