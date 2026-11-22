import { emptyCharacter } from './card';
import { isObj, str, strArr } from './json';
import type { CharacterDoc, PlotBeat, PlotDoc, PlotIdea } from './types';
import { uid } from './util';

/** Genres the user can pick. Names are model-facing, so they stay in English. */
export const PLOT_GENRES = ['fantasy', 'darkfantasy', 'scifi', 'cyberpunk', 'postapoc', 'horror', 'mystery', 'thriller', 'romance', 'adventure', 'historical', 'urban', 'slice', 'comedy'] as const;
/** Shown and sent only while the NSFW mode is on. */
export const NSFW_GENRES = ['erotica', 'darkromance', 'gore'] as const;
export type PlotGenre = (typeof PLOT_GENRES)[number] | (typeof NSFW_GENRES)[number];

export const GENRE_NAME: Record<PlotGenre, string> = {
  fantasy: 'fantasy',
  darkfantasy: 'dark fantasy',
  scifi: 'science fiction',
  cyberpunk: 'cyberpunk',
  postapoc: 'post-apocalypse',
  horror: 'horror',
  mystery: 'mystery / detective',
  thriller: 'thriller',
  romance: 'romance',
  adventure: 'adventure',
  historical: 'historical',
  urban: 'urban fantasy',
  slice: 'slice of life',
  comedy: 'comedy',
  erotica: 'erotica (explicit sex scenes are a central part of the story)',
  darkromance: 'dark romance (obsession, power imbalance, morally grey love interests)',
  gore: 'graphic horror / gore',
};

export const isNsfwGenre = (g: PlotGenre) => (NSFW_GENRES as readonly string[]).includes(g);

export const PLOT_TONES = ['any', 'light', 'cozy', 'dramatic', 'grim', 'humor', 'epic'] as const;
export type PlotTone = (typeof PLOT_TONES)[number];

export const TONE_GUIDE: Record<PlotTone, string> = {
  any: 'any — pick what suits the story',
  light: 'light and hopeful',
  cozy: 'cozy, warm, low stakes',
  dramatic: 'dramatic, emotionally intense',
  grim: 'grim and dark',
  humor: 'humorous, witty',
  epic: 'epic, high stakes',
};

/** Plain text fields of a plot, in display order. */
export const PLOT_FIELDS = ['logline', 'setting', 'cast', 'synopsis', 'twists', 'opening'] as const;
export type PlotField = (typeof PLOT_FIELDS)[number];
/** What "fill in" can ask the model for. */
export type PlotPart = 'title' | 'tags' | PlotField | 'beats';

export function emptyPlot(title = ''): PlotDoc {
  return { id: uid(), title, logline: '', tags: [], setting: '', cast: '', synopsis: '', beats: [], twists: '', opening: '', nsfw: false, updatedAt: Date.now() };
}

export const newBeat = (p: Partial<PlotBeat> = {}): PlotBeat => ({ id: uid(), title: '', text: '', ...p });

export function emptyPlotParts(p: PlotDoc): PlotPart[] {
  const out: PlotPart[] = [];
  if (!p.title.trim()) out.push('title');
  if (!p.tags.length) out.push('tags');
  for (const f of PLOT_FIELDS) if (!p[f].trim()) out.push(f);
  if (!p.beats.some((b) => b.text.trim())) out.push('beats');
  return out;
}

/** Models often answer a list where the schema asks for text: join it into lines. */
export function textOf(v: unknown): string {
  if (Array.isArray(v))
    return v
      .map((x) =>
        isObj(x)
          ? Object.values(x)
              .map((y) => str(y).trim())
              .filter(Boolean)
              .join(' — ')
          : str(x).trim(),
      )
      .filter(Boolean)
      .join('\n');
  return str(v).trim();
}

export function parseBeats(v: unknown): PlotBeat[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (isObj(x) ? newBeat({ title: str(x.title ?? x.name).trim(), text: textOf(x.text ?? x.content ?? x.description) }) : newBeat({ text: str(x).trim() })))
    .filter((b) => b.text || b.title);
}

/** Picks the requested plot parts out of a model reply. */
export function plotPatch(json: unknown, keys: readonly PlotPart[]): Partial<PlotDoc> {
  const out: Partial<PlotDoc> = {};
  if (!isObj(json)) return out;
  for (const k of keys) {
    if (k === 'beats') {
      const beats = parseBeats(json.beats ?? json.scenes);
      if (beats.length) out.beats = beats;
    } else if (k === 'tags') {
      const tags = strArr(json.tags);
      if (tags.length) out.tags = tags;
    } else {
      const v = textOf(json[k]);
      if (v) out[k] = v;
    }
  }
  return out;
}

export function parseIdeas(json: unknown, nsfw: boolean): PlotIdea[] {
  const arr = isObj(json) && Array.isArray(json.ideas) ? json.ideas : Array.isArray(json) ? json : [];
  return arr
    .map((x): PlotIdea | null => {
      if (typeof x === 'string') return x.trim() ? { id: uid(), title: '', logline: x.trim(), tags: [], nsfw } : null;
      if (!isObj(x)) return null;
      const logline = textOf(x.logline ?? x.pitch ?? x.description ?? x.text);
      return logline ? { id: uid(), title: str(x.title ?? x.name).trim(), logline, tags: strArr(x.tags), nsfw } : null;
    })
    .filter((x): x is PlotIdea => !!x);
}

export interface PlotLabels {
  tags: string;
  fields: Record<PlotField, string>;
  beats: string;
}

export function plotToMarkdown(p: PlotDoc, l: PlotLabels): string {
  const out = [`# ${p.title || '—'}`];
  if (p.logline.trim()) out.push('', ...p.logline.trim().split('\n').map((s) => '> ' + s));
  if (p.tags.length) out.push('', `**${l.tags}:** ${p.tags.join(', ')}`);
  const section = (f: PlotField) => p[f].trim() && out.push('', `## ${l.fields[f]}`, '', p[f].trim());
  section('setting');
  section('cast');
  section('synopsis');
  if (p.beats.length) {
    out.push('', `## ${l.beats}`);
    p.beats.forEach((b, i) => out.push('', `### ${i + 1}. ${b.title || '—'}`, '', b.text.trim()));
  }
  section('twists');
  section('opening');
  return out.join('\n') + '\n';
}

/** A narrator ("scenario") card for SillyTavern: the plan goes to the description, the opening scene becomes the first message. */
export function plotToCard(p: PlotDoc, l: PlotLabels): CharacterDoc {
  const c = emptyCharacter(p.title);
  const parts: string[] = [];
  const section = (title: string, body: string) => body.trim() && parts.push(`## ${title}\n${body.trim()}`);
  section(l.fields.setting, p.setting);
  section(l.fields.cast, p.cast);
  section(l.fields.synopsis, p.synopsis);
  section(l.beats, p.beats.map((b, i) => `${i + 1}. ${b.title ? b.title + ' — ' : ''}${b.text.trim()}`).join('\n'));
  section(l.fields.twists, p.twists);
  c.description = parts.join('\n\n');
  c.scenario = p.logline.trim();
  c.first_mes = p.opening.trim();
  c.creator_notes = p.logline.trim();
  c.tags = p.nsfw && !p.tags.includes('nsfw') ? [...p.tags, 'nsfw'] : [...p.tags];
  return c;
}
