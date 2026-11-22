export type Lang = 'ru' | 'en';
export type Role = 'system' | 'user' | 'assistant';

/** `st` = generate through SillyTavern itself (its current connection or a Connection Manager profile). */
export type ProviderKind = 'openai' | 'anthropic' | 'gemini' | 'st';

export interface Connection {
  provider: ProviderKind;
  /** Base URL up to the version segment, e.g. https://openrouter.ai/api/v1 */
  baseUrl: string;
  apiKey: string;
  model: string;
  stream: boolean;
  temperature: number;
  maxTokens: number;
  /** For provider `st`: Connection Manager profile id; empty = ST's current connection. */
  stProfile: string;
}

/* ───────────── Presets (SillyTavern Chat Completion) ───────────── */

export interface Mini {
  id: string;
  text: string;
}

export interface PresetBlock {
  id: string;
  /** SillyTavern prompt identifier (main, chatHistory, a uuid…). */
  identifier: string;
  name: string;
  /** ST built-in marker (chat history, char description…): position only, no text. */
  marker: boolean;
  role: Role;
  content: string;
  enabled: boolean;
  /** 0 = relative (in the prompt order), 1 = in chat at depth. */
  position: 0 | 1;
  depth: number;
  order: number;
  /** Short points the block was split into; when present they are sent instead of `content`. */
  minis: Mini[];
  /** Untouched original ST prompt object, so unknown fields survive export. */
  raw?: Record<string, unknown>;
}

export interface PresetDoc {
  id: string;
  name: string;
  /** SillyTavern preset this one came from or was sent to. */
  stName?: string;
  blocks: PresetBlock[];
  /** Original preset JSON without prompts / prompt_order (samplers etc.). */
  raw?: Record<string, unknown>;
  /** Which prompt_order character_id the order came from. */
  orderId?: number;
  updatedAt: number;
}

/* ───────────── Characters & personas ───────────── */

export interface CharacterDoc {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  alternate_greetings: string[];
  creator_notes: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  creator: string;
  character_version: string;
  /** data: URL of the avatar image. */
  avatar?: string;
  /** Original card `data` object (extensions, character_book…) kept for export. */
  raw?: Record<string, unknown>;
  /** Avatar file name of the SillyTavern character this card came from or was sent to. */
  stAvatar?: string;
  /** Spec the card came from, for the library label. */
  spec?: 'v1' | 'v2' | 'v3' | 'new';
  updatedAt: number;
}

export interface PersonaDoc {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  /** SillyTavern persona avatar id this persona came from or was sent to. */
  stAvatar?: string;
  updatedAt: number;
}

/* ───────────── Lorebooks (SillyTavern World Info) ───────────── */

/** ST selectiveLogic: 0 AND ANY, 1 NOT ALL, 2 NOT ANY, 3 AND ALL. */
export type LoreLogic = 0 | 1 | 2 | 3;

export interface LoreEntry {
  id: string;
  title: string;
  keys: string[];
  secondary: string[];
  logic: LoreLogic;
  constant: boolean;
  enabled: boolean;
  content: string;
  order: number;
  /** ST world_info_position: 0 before char, 1 after char, 2 AN top, 3 AN bottom, 4 at depth, 5 EM top, 6 EM bottom. */
  position: number;
  depth: number;
  /** 0 system, 1 user, 2 assistant — used with position 4. */
  role: number;
  probability: number;
  /** null = use the global setting. */
  wholeWords: boolean | null;
  raw?: Record<string, unknown>;
}

export interface LoreBook {
  id: string;
  name: string;
  /** SillyTavern World Info file this book came from or was sent to. */
  stName?: string;
  entries: LoreEntry[];
  raw?: Record<string, unknown>;
  updatedAt: number;
}

/* ───────────── Plots ───────────── */

/** A short story idea from the ideas board. */
export interface PlotIdea {
  id: string;
  title: string;
  logline: string;
  tags: string[];
  /** Generated with the NSFW mode on. */
  nsfw: boolean;
}

export interface PlotBeat {
  id: string;
  title: string;
  text: string;
}

export interface PlotDoc {
  id: string;
  title: string;
  logline: string;
  tags: string[];
  setting: string;
  /** Key characters, one per line. */
  cast: string;
  synopsis: string;
  beats: PlotBeat[];
  twists: string;
  /** Opening scene to start the roleplay with. */
  opening: string;
  nsfw: boolean;
  updatedAt: number;
}
