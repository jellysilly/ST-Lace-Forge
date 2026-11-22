/**
 * Moving documents between the Forge library and SillyTavern itself:
 * Chat Completion presets, characters, personas and World Info books.
 */
import { tNow } from '../i18n';
import { cardFromJson, cardFromPng, cardToPng, emptyPersona } from './card';
import { avatarFromFile, avatarPng } from './image';
import { lorebookFrom, toSTWorld } from './lorebook';
import { isPng } from './png';
import { importPreset, toSillyTavern } from './preset';
import { stCtx, stFetch } from './st';
import type { CharacterDoc, LoreBook, PersonaDoc, PresetDoc } from './types';
import { fmt, slugify } from './util';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type STKind = 'presets' | 'characters' | 'personas' | 'lorebooks';

export interface STItem {
  /** Preset / book name, or the avatar file of a character or persona. */
  id: string;
  name: string;
  img?: string;
}

function ctx() {
  const c = stCtx();
  if (!c) throw new Error('SillyTavern is not available');
  return c;
}

const confirmOverwrite = (name: string) => window.confirm(fmt(tNow().st.overwrite, { name }));

async function blobToDataUrl(blob: Blob): Promise<string> {
  return avatarFromFile(new File([blob], 'avatar.png', { type: blob.type || 'image/png' }));
}

async function fetchImage(url: string): Promise<string | undefined> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return undefined;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return undefined;
    return await blobToDataUrl(blob);
  } catch {
    return undefined;
  }
}

const thumb = (type: string, file: string) => {
  try {
    return String(stCtx()?.getThumbnailUrl?.(type, file) ?? '') || undefined;
  } catch {
    return undefined;
  }
};

/* ───────── presets ───────── */

function presetManager() {
  const pm = ctx().getPresetManager?.('openai');
  if (!pm) throw new Error('Preset manager is not available');
  return pm;
}

function presetNames(): string[] {
  const { preset_names } = presetManager().getPresetList();
  const names = Array.isArray(preset_names) ? preset_names : Object.keys(preset_names ?? {});
  return names.map(String);
}

function presetByName(name: string): Record<string, unknown> | undefined {
  const pm = presetManager();
  const direct = pm.getCompletionPresetByName?.(name);
  if (direct) return direct;
  const { presets, preset_names } = pm.getPresetList();
  const idx = Array.isArray(preset_names) ? preset_names.indexOf(name) : preset_names?.[name];
  return idx === undefined || idx < 0 ? undefined : presets?.[idx];
}

/* ───────── listing ───────── */

async function worldNames(): Promise<string[]> {
  try {
    const names = await Promise.resolve(stCtx()?.getWorldInfoNames?.());
    if (Array.isArray(names)) return names.map(String);
  } catch {
    /* try the server */
  }
  try {
    const list = await (await stFetch('/api/worldinfo/list', { method: 'POST', body: '{}' })).json();
    if (Array.isArray(list)) return list.map((x: any) => String(x?.name ?? x?.file_id ?? x)).filter(Boolean);
  } catch {
    /* older ST: names come with the settings */
  }
  const data = await (await stFetch('/api/settings/get', { method: 'POST', body: '{}' })).json();
  return Array.isArray(data?.world_names) ? data.world_names.map(String) : [];
}

export async function stList(kind: STKind): Promise<STItem[]> {
  const c = ctx();
  const byName = (a: STItem, b: STItem) => a.name.localeCompare(b.name);
  if (kind === 'presets') return presetNames().map((n) => ({ id: n, name: n })).sort(byName);
  if (kind === 'characters')
    return (c.characters ?? [])
      .filter((x: any) => x?.avatar)
      .map((x: any) => ({ id: String(x.avatar), name: String(x.name ?? x.avatar), img: thumb('avatar', x.avatar) }))
      .sort(byName);
  if (kind === 'personas') {
    const personas = c.powerUserSettings?.personas ?? {};
    return Object.entries(personas)
      .map(([id, name]) => ({ id, name: String(name || id), img: thumb('persona', id) }))
      .sort(byName);
  }
  return (await worldNames()).map((n) => ({ id: n, name: n })).sort(byName);
}

/* ───────── loading into the Forge ───────── */

export async function stLoadPreset(name: string): Promise<PresetDoc> {
  const data = presetByName(name);
  if (!data) throw new Error('not-preset');
  return { ...importPreset(JSON.stringify(data), name), name, stName: name };
}

export async function stLoadCharacter(avatar: string): Promise<CharacterDoc> {
  const c = ctx();
  // The PNG on disk is the full card that ST itself writes on every save.
  try {
    const res = await fetch('/characters/' + encodeURIComponent(avatar), { cache: 'no-store' });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (isPng(bytes)) return { ...cardFromPng(bytes), stAvatar: avatar };
    }
  } catch {
    /* fall back to the in-memory character */
  }
  const idx = (c.characters ?? []).findIndex((x: any) => x?.avatar === avatar);
  if (idx < 0) throw new Error('not-card');
  await c.unshallowCharacter?.(idx);
  const ch = c.characters[idx];
  const doc = cardFromJson(ch?.data ? { spec: ch.spec ?? 'chara_card_v2', spec_version: ch.spec_version ?? '2.0', data: ch.data } : ch);
  return { ...doc, avatar: await fetchImage(thumb('avatar', avatar) ?? ''), stAvatar: avatar };
}

export async function stLoadPersona(avatarId: string): Promise<PersonaDoc> {
  const pu = ctx().powerUserSettings ?? {};
  const name = String(pu.personas?.[avatarId] ?? avatarId);
  const description = String(pu.persona_descriptions?.[avatarId]?.description ?? '');
  const avatar = (await fetchImage('/User Avatars/' + encodeURIComponent(avatarId))) ?? (await fetchImage(thumb('persona', avatarId) ?? ''));
  return { ...emptyPersona(name), description, avatar, stAvatar: avatarId };
}

export async function stLoadLorebook(name: string): Promise<LoreBook> {
  const c = ctx();
  let data: unknown;
  if (typeof c.loadWorldInfo === 'function') data = await c.loadWorldInfo(name);
  else data = await (await stFetch('/api/worldinfo/get', { method: 'POST', body: JSON.stringify({ name }) })).json();
  if (!data) throw new Error('not-lorebook');
  return { ...lorebookFrom(data, name), name, stName: name };
}

/* ───────── saving into SillyTavern ───────── */

/** Returns the ST name, or null when the user cancelled. */
export async function stSendPreset(doc: PresetDoc): Promise<string | null> {
  const pm = presetManager();
  const name = (doc.stName || doc.name).trim() || 'Lace Forge';
  if (presetNames().includes(name) && !confirmOverwrite(name)) return null;
  await pm.savePreset(name, toSillyTavern(doc));
  return name;
}

export async function stSendCharacter(doc: CharacterDoc): Promise<string | null> {
  const c = ctx();
  const linked = !!doc.stAvatar && (c.characters ?? []).some((x: any) => x?.avatar === doc.stAvatar);
  const overwrite = linked && window.confirm(fmt(tNow().st.updateChar, { name: doc.name || tNow().c.untitled }));
  const png = cardToPng(doc, await avatarPng(doc.avatar, doc.name));
  const fd = new FormData();
  fd.append('avatar', new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }), `${slugify(doc.name, 'character')}.png`);
  fd.append('file_type', 'png');
  if (overwrite && doc.stAvatar) fd.append('preserved_name', doc.stAvatar);
  const data = await (await stFetch('/api/characters/import', { method: 'POST', body: fd })).json();
  if (!data || data.error || !data.file_name) throw new Error('import');
  await c.getCharacters?.();
  const file = String(data.file_name);
  return /\.png$/i.test(file) ? file : file + '.png';
}

export async function stSendPersona(doc: PersonaDoc): Promise<string | null> {
  const c = ctx();
  const pu = c.powerUserSettings;
  if (!pu) throw new Error('power_user');
  pu.personas ??= {};
  pu.persona_descriptions ??= {};
  const name = doc.name.trim() || tNow().c.untitled;
  const linked = !!doc.stAvatar && doc.stAvatar in pu.personas;
  const overwrite = linked && window.confirm(fmt(tNow().st.updatePersona, { name }));
  const avatarId = overwrite && doc.stAvatar ? doc.stAvatar : `${Date.now()}-${slugify(name, 'persona')}.png`;

  const png = await avatarPng(doc.avatar, name);
  const fd = new FormData();
  fd.append('avatar', new Blob([png.slice().buffer as ArrayBuffer], { type: 'image/png' }), 'avatar.png');
  fd.append('overwrite_name', avatarId);
  const up = await (await stFetch('/api/avatars/upload', { method: 'POST', body: fd })).json();
  const id = String(up?.path || avatarId);

  const api = await (window.parent as any).laceForge?.personaApi?.().catch(() => null);
  if (!overwrite && typeof api?.initPersona === 'function') {
    await api.initPersona(id, name, doc.description, '');
  } else {
    pu.personas[id] = name;
    pu.persona_descriptions[id] = { position: 0, depth: 2, role: 0, lorebook: '', ...(pu.persona_descriptions[id] ?? {}), description: doc.description };
    c.saveSettingsDebounced?.();
  }
  try {
    await api?.getUserAvatars?.(true);
  } catch {
    /* the list refreshes next time Persona Management opens */
  }
  return id;
}

export async function stSendLorebook(book: LoreBook): Promise<string | null> {
  const c = ctx();
  const name = (book.stName || book.name).trim() || 'Lace Forge';
  const exists = (await worldNames()).includes(name);
  if (exists && !confirmOverwrite(name)) return null;
  const data = toSTWorld(book);
  if (typeof c.saveWorldInfo === 'function') await c.saveWorldInfo(name, data, true);
  else await stFetch('/api/worldinfo/edit', { method: 'POST', body: JSON.stringify({ name, data }) });
  try {
    await c.updateWorldInfoList?.();
    if (exists) c.reloadWorldInfoEditor?.(name);
  } catch {
    /* the list refreshes on reload */
  }
  return name;
}

/** Whether the preset is the one selected in SillyTavern right now (it needs re-selecting to apply). */
export function stPresetSelected(name: string) {
  try {
    return presetManager().getSelectedPresetName?.() === name;
  } catch {
    return false;
  }
}
