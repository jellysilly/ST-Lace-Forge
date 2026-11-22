import { isObj, str, strArr } from './json';
import { isPng, readTextChunks, writeTextChunks } from './png';
import type { CharacterDoc, PersonaDoc } from './types';
import { base64ToBytes, bytesToBase64, bytesToDataUrl, uid, utf8 } from './util';

export const CARD_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'alternate_greetings',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'tags',
  'creator',
  'character_version',
] as const;

/** Text fields the editor and the AI work with. */
export type TextField = 'description' | 'personality' | 'scenario' | 'first_mes' | 'mes_example' | 'creator_notes' | 'system_prompt' | 'post_history_instructions';

export function emptyCharacter(name = ''): CharacterDoc {
  return {
    id: uid(),
    name,
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    alternate_greetings: [],
    creator_notes: '',
    system_prompt: '',
    post_history_instructions: '',
    tags: [],
    creator: '',
    character_version: '',
    spec: 'new',
    updatedAt: Date.now(),
  };
}

export function emptyPersona(name = ''): PersonaDoc {
  return { id: uid(), name, description: '', updatedAt: Date.now() };
}

export class CardImportError extends Error {}

/** Builds a character from any V1 / V2 / V3 card object. */
export function cardFromJson(obj: unknown): CharacterDoc {
  if (!isObj(obj)) throw new CardImportError('not-card');
  const spec = str(obj.spec);
  const isV3 = spec === 'chara_card_v3';
  const isV2 = spec === 'chara_card_v2';
  const data = (isV2 || isV3) && isObj(obj.data) ? obj.data : obj;
  if (typeof data.name !== 'string' && typeof data.description !== 'string' && typeof data.first_mes !== 'string') throw new CardImportError('not-card');
  const raw: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (!(CARD_FIELDS as readonly string[]).includes(k)) raw[k] = v;
  // V1 cards keep the creator comment at the top level.
  const notes = str(data.creator_notes) || str((obj as Record<string, unknown>).creatorcomment);
  return {
    ...emptyCharacter(),
    name: str(data.name),
    description: str(data.description),
    personality: str(data.personality),
    scenario: str(data.scenario),
    first_mes: str(data.first_mes),
    mes_example: str(data.mes_example),
    alternate_greetings: strArr(data.alternate_greetings),
    creator_notes: notes,
    system_prompt: str(data.system_prompt),
    post_history_instructions: str(data.post_history_instructions),
    tags: strArr(data.tags),
    creator: str(data.creator),
    character_version: str(data.character_version),
    raw: isV2 || isV3 ? raw : undefined,
    spec: isV3 ? 'v3' : isV2 ? 'v2' : 'v1',
  };
}

function decodeChunk(b64: string): unknown {
  return JSON.parse(utf8.decode(base64ToBytes(b64)));
}

/** Reads a character from PNG bytes (ccv3 preferred, then chara). */
export function cardFromPng(bytes: Uint8Array): CharacterDoc {
  const chunks = readTextChunks(bytes);
  const src = chunks.ccv3 ?? chunks.chara;
  if (!src) throw new CardImportError('no-card-in-png');
  let obj: unknown;
  try {
    obj = decodeChunk(src);
  } catch {
    if (!chunks.chara || src === chunks.chara) throw new CardImportError('bad-png-card');
    obj = decodeChunk(chunks.chara);
  }
  return { ...cardFromJson(obj), avatar: bytesToDataUrl(bytes, 'image/png') };
}

const V3_ONLY = ['group_only_greetings', 'assets', 'nickname', 'creator_notes_multilingual', 'source', 'creation_date', 'modification_date'];

function cardData(c: CharacterDoc, v3: boolean) {
  const raw = { ...(c.raw ?? {}) };
  if (!v3) for (const k of V3_ONLY) delete raw[k];
  const data: Record<string, unknown> = {
    ...raw,
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.first_mes,
    mes_example: c.mes_example,
    creator_notes: c.creator_notes,
    system_prompt: c.system_prompt,
    post_history_instructions: c.post_history_instructions,
    alternate_greetings: c.alternate_greetings,
    tags: c.tags,
    creator: c.creator,
    character_version: c.character_version,
    extensions: isObj(raw.extensions) ? raw.extensions : {},
  };
  if (v3) {
    data.group_only_greetings = Array.isArray(raw.group_only_greetings) ? raw.group_only_greetings : [];
    data.modification_date = Math.floor(Date.now() / 1000);
    if (typeof raw.creation_date !== 'number') data.creation_date = Math.floor(Date.now() / 1000);
  }
  return data;
}

export function toV3(c: CharacterDoc) {
  return { spec: 'chara_card_v3', spec_version: '3.0', data: cardData(c, true) };
}

/** V2 card with V1 fields mirrored at the top level, the way SillyTavern writes it. */
export function toV2(c: CharacterDoc) {
  return {
    name: c.name,
    description: c.description,
    personality: c.personality,
    scenario: c.scenario,
    first_mes: c.first_mes,
    mes_example: c.mes_example,
    creatorcomment: c.creator_notes,
    tags: c.tags,
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: cardData(c, false),
  };
}

const b64json = (o: unknown) => bytesToBase64(utf8.encode(JSON.stringify(o)));

/** Embeds the card into a PNG: `chara` (V2) for older apps and `ccv3` (V3). */
export function cardToPng(c: CharacterDoc, png: Uint8Array) {
  return writeTextChunks(png, { chara: b64json(toV2(c)), ccv3: b64json(toV3(c)) });
}

/* ───────── personas ───────── */

/** SillyTavern "Backup personas" format; restore it in ST → Persona Management. */
export function personasToST(list: PersonaDoc[]) {
  const personas: Record<string, string> = {};
  const persona_descriptions: Record<string, unknown> = {};
  for (const p of list) {
    const file = `lf-${p.id.slice(0, 8)}.png`;
    personas[file] = p.name;
    persona_descriptions[file] = { description: p.description, position: 0, depth: 2, role: 0, lorebook: '' };
  }
  return { personas, persona_descriptions, default_persona: null };
}

export function personaToPng(p: PersonaDoc, png: Uint8Array) {
  return writeTextChunks(png, { lf_persona: b64json({ name: p.name, description: p.description }) });
}

/** Accepts an ST persona backup, a Lace Forge persona PNG, or any character card. */
export function personasFrom(bytes: Uint8Array, fileName: string): PersonaDoc[] {
  const base = fileName.replace(/\.[a-z0-9]+$/i, '');
  if (isPng(bytes)) {
    const chunks = readTextChunks(bytes);
    const avatar = bytesToDataUrl(bytes, 'image/png');
    if (chunks.lf_persona) {
      const o = decodeChunk(chunks.lf_persona) as Record<string, unknown>;
      return [{ ...emptyPersona(str(o.name) || base), description: str(o.description), avatar }];
    }
    if (chunks.ccv3 || chunks.chara) {
      const c = cardFromPng(bytes);
      return [{ ...emptyPersona(c.name || base), description: c.description, avatar }];
    }
    return [{ ...emptyPersona(base), avatar }];
  }
  const text = utf8.decode(bytes);
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return [{ ...emptyPersona(base), description: text.trim() }];
  }
  if (isObj(obj) && isObj(obj.personas)) {
    const descs = isObj(obj.persona_descriptions) ? obj.persona_descriptions : {};
    return Object.entries(obj.personas).map(([file, name]) => {
      const d = descs[file];
      return { ...emptyPersona(str(name) || file), description: isObj(d) ? str(d.description) : '' };
    });
  }
  const c = cardFromJson(obj);
  return [{ ...emptyPersona(c.name || base), description: c.description }];
}

export function personaToText(p: PersonaDoc) {
  return `${p.name}\n\n${p.description}\n`;
}
